/**
 * core.ts — all non-React logic for the live-translate app.
 *
 * Sections:
 *   1. Types & defaults
 *   2. Target languages (BCP-47)
 *   3. AudioCapture  — mic / tab-system audio → 16k PCM → base64 chunks
 *   4. GeminiLiveSession — browser WebSocket to the Gemini Live API + hot-swap reconnect
 *   5. downloadTranscript — export accumulated lines as .txt
 *
 * Consolidated into one module to keep file-creation minimal; each section is
 * self-contained and can be split out later.
 */

/* ------------------------------------------------------------------ *
 * 1. Types & defaults
 * ------------------------------------------------------------------ */

export type AudioSource = 'mic' | 'display'
export type DisplayMode = 'translation' | 'original' | 'both'

export interface TranscriptLine {
  id: number
  original: string
  translation: string
  sourceLang?: string
  isFinal: boolean
}

export interface Settings {
  targetLang: string
  audioSource: AudioSource
  displayMode: DisplayMode
  maxLines: number
  /** Subtitle font size in rem for the translated line. */
  fontSize: number
  centered: boolean
  /** Subtitle color theme: soft (eye-friendly) / white / bright (high-contrast). */
  subtitleColor: 'soft' | 'white' | 'bright'
  /** Hot-swap reconnect cadence in seconds (defeats the Live API session cap). */
  reconnectSeconds: number
}

export const DEFAULT_SETTINGS: Settings = {
  targetLang: 'zh-TW',
  audioSource: 'mic',
  displayMode: 'both',
  maxLines: 2,
  fontSize: 1.75,
  centered: false,
  subtitleColor: 'soft',
  reconnectSeconds: 90,
}

/* ------------------------------------------------------------------ *
 * 2. Target languages — gemini-3.5-live-translate-preview (source auto-detected)
 * ------------------------------------------------------------------ */

export interface Language {
  code: string
  label: string
}

export const TARGET_LANGUAGES: Language[] = [
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'pt-PT', label: 'Português (Portugal)' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'th', label: 'ไทย' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'pl', label: 'Polski' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'uk', label: 'Українська' },
  { code: 'fil', label: 'Filipino' },
  { code: 'fa', label: 'فارسی' },
  { code: 'he', label: 'עברית' },
  { code: 'sv', label: 'Svenska' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'cs', label: 'Čeština' },
  { code: 'ro', label: 'Română' },
  { code: 'hu', label: 'Magyar' },
  { code: 'fi', label: 'Suomi' },
  { code: 'da', label: 'Dansk' },
  { code: 'nb', label: 'Norsk Bokmål' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
]

/* ------------------------------------------------------------------ *
 * 3. AudioCapture
 * ------------------------------------------------------------------ */

export type PcmChunkHandler = (base64Pcm: string) => void

/**
 * Inlined AudioWorklet: buffers mono Float32 input into 512-sample frames
 * (~32ms @16k) and posts each frame to the main thread. Loaded via a Blob URL
 * so there is no separate static asset to deploy. The AudioContext runs at
 * 16000 Hz, so any input source is resampled to 16k before it reaches here.
 */
const CAPTURE_WORKLET_SRC = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 512;
    this.frame = new Float32Array(this.frameSize);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0]) {
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) {
        this.frame[this.offset++] = ch[i];
        if (this.offset >= this.frameSize) {
          this.port.postMessage(this.frame.slice());
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('audio-capture-processor', AudioCaptureProcessor);
`

export class AudioCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null

  async start(
    source: AudioSource,
    onChunk: PcmChunkHandler,
    onEnded?: () => void,
  ): Promise<void> {
    const stream =
      source === 'mic' ? await this.getMicStream() : await this.getDisplayStream()
    this.stream = stream

    const ctx = new AudioContext({ sampleRate: 16000 })
    this.ctx = ctx
    if (ctx.state === 'suspended') await ctx.resume()

    const blob = new Blob([CAPTURE_WORKLET_SRC], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }

    const src = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'audio-capture-processor')
    node.port.onmessage = (e: MessageEvent) => {
      onChunk(floatToPcm16Base64(e.data as Float32Array))
    }
    src.connect(node)
    node.connect(ctx.destination) // keep the worklet pulled; it emits silence
    this.source = src
    this.node = node

    // If the user stops sharing the tab/screen, the audio track ends → notify.
    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => onEnded?.())
    })
  }

  private async getMicStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  }

  private async getDisplayStream(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    })
    stream.getVideoTracks().forEach((track) => {
      track.enabled = false
    })
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error(
        '沒有取得音訊軌。請在分享畫面/分頁時勾選「分享分頁音訊 / Share tab audio」。',
      )
    }
    return stream
  }

  stop(): void {
    try {
      this.node?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      this.source?.disconnect()
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close()
    this.node = null
    this.source = null
    this.stream = null
    this.ctx = null
  }
}

function floatToPcm16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const bytes = new Uint8Array(int16.buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/* ------------------------------------------------------------------ *
 * 4. GeminiLiveSession — browser WebSocket + hot-swap reconnect
 * ------------------------------------------------------------------ */

export interface TranscriptDelta {
  original: string
  translation: string
  isFinal: boolean
  sourceLang?: string
  targetLang?: string
}

interface SessionListeners {
  onTranscript: (delta: TranscriptDelta) => void
  onStatus: (message: string, connected: boolean) => void
  onError: (message: string) => void
  onFatal: (message: string) => void
}

interface ServerMessage {
  setupComplete?: unknown
  goAway?: { timeLeft?: string }
  error?: { message?: string }
  serverContent?: {
    modelTurn?: { parts?: Array<{ text?: string }> }
    inputTranscription?: { text?: string; languageCode?: string }
    outputTranscription?: { text?: string; languageCode?: string }
    turnComplete?: boolean
  }
}

export const DEFAULT_MODEL = 'gemini-3.5-live-translate-preview'
const HOT_SWAP_SETUP_TIMEOUT_MS = 8000
const OVERLAP_MS = 800
const HARD_RECONNECT_DELAY_MS = 1500

const MAX_RECONNECT_ATTEMPTS = 3

const KEY_ERROR_MESSAGE =
  'Gemini 連線發生問題。最常見原因是 API 金鑰貼錯、已過期或免費額度用完。請確認金鑰是否正確，或到 Google AI Studio 重新產生一組再試一次。'
const QUOTA_ERROR_MESSAGE = '今日免費額度已用罄，請明日再試或更換金鑰。'

type ErrorKind = 'key' | 'quota' | 'other'

function classifyError(raw: string): ErrorKind {
  const m = raw.toLowerCase()
  if (
    m.includes('quota') ||
    m.includes('resource_exhausted') ||
    m.includes('429')
  ) {
    return 'quota'
  }
  if (
    m.includes('api key not valid') ||
    m.includes('api_key_invalid') ||
    m.includes('permission_denied') ||
    m.includes('unauthenticated') ||
    m.includes('400') ||
    m.includes('401') ||
    m.includes('403')
  ) {
    return 'key'
  }
  return 'other'
}

function wsUrl(apiKey: string): string {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(
    apiKey,
  )}`
}

export class GeminiLiveSession {
  private readonly apiKey: string
  private readonly targetLang: string
  private readonly model: string
  private readonly reconnectMs: number
  private readonly listeners: SessionListeners

  private active: WebSocket | null = null
  private standby: WebSocket | null = null
  private readonly ready = new Set<WebSocket>()
  private readonly closingByUs = new Set<WebSocket>()

  private stopped = false
  private reconnectAttempts = 0
  private swapTimer: ReturnType<typeof setTimeout> | null = null
  private standbyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    opts: { apiKey: string; targetLang: string; reconnectSeconds: number; model?: string },
    listeners: SessionListeners,
  ) {
    this.apiKey = opts.apiKey
    this.targetLang = opts.targetLang
    this.reconnectMs = Math.max(20, opts.reconnectSeconds) * 1000
    this.model = opts.model ?? DEFAULT_MODEL
    this.listeners = listeners
  }

  start(): void {
    this.stopped = false
    this.listeners.onStatus('連線中…', false)
    this.active = this.createSocket((ws) => this.promoteInitial(ws))
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    if (this.standby) this.forceClose(this.standby)
    if (this.active) this.forceClose(this.active)
    this.active = null
    this.standby = null
    this.ready.clear()
    this.listeners.onStatus('已停止', false)
  }

  private fail(message: string): void {
    this.listeners.onFatal(message)
    this.stop()
  }

  sendAudio(base64Pcm: string): void {
    if (this.stopped) return
    const msg = JSON.stringify({
      realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: base64Pcm } },
    })
    this.ready.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg)
    })
  }

  private setupMessage(): string {
    return JSON.stringify({
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          translationConfig: { targetLanguageCode: this.targetLang },
        },
      },
    })
  }

  private createSocket(onReady: (ws: WebSocket) => void): WebSocket {
    const ws = new WebSocket(wsUrl(this.apiKey))
    ws.onopen = () => {
      try {
        ws.send(this.setupMessage())
      } catch {
        /* socket closed before setup; close handler will recover */
      }
    }
    ws.onmessage = (ev) => {
      void this.handleMessage(ws, ev, onReady)
    }
    ws.onclose = (ev) => this.handleClose(ws, ev)
    ws.onerror = () => {
      /* errors are followed by a close event; handle there */
    }
    return ws
  }

  private async handleMessage(
    ws: WebSocket,
    ev: MessageEvent,
    onReady: (ws: WebSocket) => void,
  ): Promise<void> {
    let text: string
    if (typeof ev.data === 'string') text = ev.data
    else if (ev.data instanceof Blob) text = await ev.data.text()
    else return

    let data: ServerMessage
    try {
      data = JSON.parse(text) as ServerMessage
    } catch {
      return
    }

    if (data.setupComplete) {
      this.ready.add(ws)
      onReady(ws)
      return
    }
    if (data.goAway) {
      // The server is about to close this connection (≈10-min connection
      // lifetime cap). Pre-empt it with a hot-swap so the switch is seamless
      // instead of waiting for the socket to drop.
      if (ws === this.active && !this.standby) {
        console.info('[live] goAway 收到 → 提前熱切換')
        if (this.swapTimer) {
          clearTimeout(this.swapTimer)
          this.swapTimer = null
        }
        this.startHotSwap()
      }
      return
    }
    if (data.error) {
      // Classify BEFORE the standby guard: auth/quota errors can surface on
      // the standby socket during a hot-swap and must not be silently dropped.
      const raw = data.error.message ?? JSON.stringify(data.error)
      const kind = classifyError(raw)
      if (kind === 'key') {
        // Friendly 繁中 message + the raw technical detail appended (小字技術訊息,
        // rendered via whitespace-pre-line in the A-3 banner).
        this.fail(`${KEY_ERROR_MESSAGE}\n技術訊息：${raw}`)
        return
      }
      if (kind === 'quota') {
        this.fail(QUOTA_ERROR_MESSAGE)
        return
      }
      // Non-fatal API error: keep the "only the active socket speaks" contract.
      if (ws === this.active) {
        this.listeners.onError(`API 錯誤: ${raw}`)
      }
      return
    }
    if (ws !== this.active) return // standby stays silent until promoted
    this.emitTranscript(data)
  }

  private emitTranscript(data: ServerMessage): void {
    const sc = data.serverContent
    if (!sc) return
    let original = ''
    let translation = ''
    let isFinal = false
    let sourceLang: string | undefined
    let targetLang: string | undefined

    const parts = sc.modelTurn?.parts
    if (Array.isArray(parts)) {
      translation += parts
        .filter((p) => typeof p.text === 'string')
        .map((p) => p.text)
        .join('')
    }
    const ot = sc.outputTranscription
    if (ot) {
      translation += ot.text ?? ''
      targetLang = ot.languageCode
    }
    const it = sc.inputTranscription
    if (it) {
      original += it.text ?? ''
      sourceLang = it.languageCode
    }
    // Gemini Live 的 transcription wire schema 只有 text、沒有 per-segment
    // finished 旗標；連續 live-translate 也幾乎不送 turnComplete。逐行定稿因此
    // 由 app 層處理（useTranslator + segment.ts 的句末/長度自分段）。turnComplete
    // 若真的出現仍視為一行結束。
    if (sc.turnComplete) isFinal = true

    if (original || translation || isFinal) {
      this.listeners.onTranscript({ original, translation, isFinal, sourceLang, targetLang })
    }
  }

  private promoteInitial(ws: WebSocket): void {
    this.active = ws
    this.reconnectAttempts = 0
    this.listeners.onStatus('已連線,等待語音輸入…', true)
    this.scheduleHotSwap()
  }

  private scheduleHotSwap(): void {
    if (this.swapTimer) clearTimeout(this.swapTimer)
    this.swapTimer = setTimeout(() => this.startHotSwap(), this.reconnectMs)
  }

  private startHotSwap(): void {
    if (this.stopped || !this.active) return
    console.info('[live] hot-swap 開始（背景建立新連線）')
    this.listeners.onStatus('正在背景更新連線，字幕不會中斷', true)

    this.standbyTimer = setTimeout(() => {
      // Standby never completed setup → drop it and cycle the active socket;
      // its close event triggers a hard reconnect.
      if (this.standby) {
        this.forceClose(this.standby)
        this.standby = null
      }
      if (this.active) this.active.close()
    }, HOT_SWAP_SETUP_TIMEOUT_MS)

    this.standby = this.createSocket((ws) => {
      if (this.standbyTimer) {
        clearTimeout(this.standbyTimer)
        this.standbyTimer = null
      }
      // Overlap: both active and ws now receive audio; promote after a beat so
      // the new socket has produced its first transcript before we drop the old.
      setTimeout(() => {
        if (this.stopped) return
        const old = this.active
        this.active = ws
        this.standby = null
        if (old && old !== ws && old.readyState !== WebSocket.CLOSED) {
          this.closingByUs.add(old)
          this.ready.delete(old)
          old.close()
        }
        this.listeners.onStatus('已連線,等待語音輸入…', true)
        this.scheduleHotSwap()
      }, OVERLAP_MS)
    })
  }

  private handleClose(ws: WebSocket, ev?: CloseEvent): void {
    this.ready.delete(ws)
    if (this.closingByUs.has(ws)) {
      this.closingByUs.delete(ws)
      return
    }
    if (this.stopped) return

    // An invalid key / exhausted quota is reported as a close frame (e.g. code
    // 1007, reason "API key not valid…"), not as a JSON `error` message.
    // Retrying cannot fix those, so fail fast with the actionable message
    // instead of burning reconnect attempts and blaming the network.
    const reason = ev?.reason ?? ''
    if (reason) {
      const kind = classifyError(reason)
      if (kind === 'key') {
        this.fail(`${KEY_ERROR_MESSAGE}\n技術訊息：${reason}`)
        return
      }
      if (kind === 'quota') {
        this.fail(QUOTA_ERROR_MESSAGE)
        return
      }
    }

    if (ws === this.active) {
      this.active = null
      if (this.standby) {
        // A standby is already in flight → promote it immediately.
        if (this.standbyTimer) {
          clearTimeout(this.standbyTimer)
          this.standbyTimer = null
        }
        this.active = this.standby
        this.standby = null
        this.listeners.onStatus('已切換備援連線…', true)
        this.scheduleHotSwap()
        return
      }
      console.info('[live] 連線中斷，硬重連')
      this.reconnectAttempts += 1
      if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.info('[live] 連續重連失敗，停止 session')
        this.fail('連線中斷且多次自動重連失敗，請檢查網路後再按一次「開始」。')
        return
      }
      this.listeners.onStatus('連線中斷,自動重連中…', false)
      if (this.swapTimer) {
        clearTimeout(this.swapTimer)
        this.swapTimer = null
      }
      setTimeout(() => {
        if (this.stopped) return
        this.active = this.createSocket((s) => this.promoteInitial(s))
      }, HARD_RECONNECT_DELAY_MS)
      return
    }
    if (ws === this.standby) this.standby = null
  }

  private forceClose(ws: WebSocket): void {
    this.closingByUs.add(ws)
    this.ready.delete(ws)
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }

  private clearTimers(): void {
    if (this.swapTimer) {
      clearTimeout(this.swapTimer)
      this.swapTimer = null
    }
    if (this.standbyTimer) {
      clearTimeout(this.standbyTimer)
      this.standbyTimer = null
    }
  }
}

/* ------------------------------------------------------------------ *
 * 5. downloadTranscript
 * ------------------------------------------------------------------ */

export function downloadTranscript(lines: TranscriptLine[], filename = 'transcript.txt'): void {
  const body = lines
    .map((line) => {
      const rows: string[] = []
      if (line.original) {
        rows.push(`[原文${line.sourceLang ? ` ${line.sourceLang}` : ''}] ${line.original}`)
      }
      if (line.translation) rows.push(`[譯文] ${line.translation}`)
      return rows.join('\n')
    })
    .join('\n\n')

  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Revoke on the next tick: some browsers start the download asynchronously
  // and fail if the blob URL is already gone.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/* ------------------------------------------------------------------ *
 * 6. mediaErrorMessage — DOMException.name → actionable 繁中 message
 * ------------------------------------------------------------------ */

export function mediaErrorMessage(e: unknown, source: AudioSource): string {
  const name = e instanceof DOMException ? e.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      // getUserMedia (permission denied) and getDisplayMedia (user cancelled
      // the picker) both throw NotAllowedError — disambiguate by source.
      return source === 'display'
        ? '已取消畫面分享，請再按一次開始。'
        : '麥克風權限被拒。請點網址列左側的鎖頭圖示 → 將「麥克風」設為允許 → 重新整理後再試一次。'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '找不到可用的麥克風，請確認已接上麥克風或耳機後再試。'
    case 'NotReadableError':
    case 'TrackStartError':
      return '麥克風被其他程式佔用（如 Zoom/Teams），請先關閉再試。'
    default:
      // Plain Errors keep their own message (e.g. the getDisplayStream
      // 「沒有取得音訊軌…」 no-audio-track guard); otherwise a generic fallback.
      return e instanceof Error ? e.message : '無法啟動音訊擷取'
  }
}
