/**
 * Manual soak test (not part of `npm test`): runs a real GeminiLiveSession for
 * 12 minutes against Google's sample WAV to check the hot-swap reconnect keeps
 * transcripts flowing past the Live API connection cap.
 *
 * Requires: Node 22+ (global WebSocket), ffmpeg on PATH, network access, and a
 * Gemini API key saved in /tmp/gk.  Run:  npx tsx test-disconnect.ts
 */
import { GeminiLiveSession } from './src/core'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'

const KEY_FILE = '/tmp/gk'
let apiKey = ''
try { apiKey = readFileSync(KEY_FILE, 'utf8').trim() } catch {}
if (!apiKey) { console.log('NO_KEY: 請先建立 ' + KEY_FILE); process.exit(0) }
console.log('key loaded: ' + apiKey.length + ' chars; starting 12-min real test...')

const SAMPLE = 'https://storage.googleapis.com/generativeai-downloads/gemini-cookbook/audio/gemini-live-translate-sample.wav'
const TEST_MS = 12 * 60 * 1000
const startAt = Date.now()
const t = () => new Date().toISOString().slice(11, 19)

let hotSwaps = 0, goAways = 0, hardReconnects = 0
const origInfo = console.info.bind(console)
console.info = (...a: unknown[]) => {
  const s = a.map(String).join(' ')
  if (s.includes('hot-swap 開始')) hotSwaps++
  if (s.includes('goAway')) goAways++
  if (s.includes('硬重連')) hardReconnects++
  origInfo(t(), ...a)
}

let transcriptCount = 0, lastTranscriptAt = Date.now(), connected = false, lastStatus = ''
const session = new GeminiLiveSession(
  { apiKey, targetLang: 'zh-TW', reconnectSeconds: 90 },
  {
    onTranscript: (d) => { if (d.translation || d.original) { transcriptCount++; lastTranscriptAt = Date.now() } },
    onStatus: (msg, isC) => { connected = isC; lastStatus = msg },
    onError: (msg) => console.log(t(), '[ERROR]', msg),
    onFatal: (msg) => console.log(t(), '[FATAL]', msg),
  },
)
session.start()

let ff: ChildProcess | null = null
function feed() {
  if (Date.now() - startAt >= TEST_MS) return
  ff = spawn('ffmpeg', ['-re', '-i', SAMPLE, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-'], { stdio: ['ignore', 'pipe', 'ignore'] })
  ff.stdout?.on('data', (buf: Buffer) => session.sendAudio(buf.toString('base64')))
  ff.on('close', () => { if (Date.now() - startAt < TEST_MS) feed() })
  ff.on('error', (e) => console.log(t(), '[ffmpeg error]', String(e)))
}
feed()

const hb = setInterval(() => {
  const elapsed = Math.round((Date.now() - startAt) / 1000)
  const gap = Math.round((Date.now() - lastTranscriptAt) / 1000)
  console.log('[HB +' + elapsed + 's] transcripts=' + transcriptCount + ' gapSinceLast=' + gap + 's | hotSwaps=' + hotSwaps + ' goAways=' + goAways + ' hardReconnects=' + hardReconnects + ' | connected=' + connected + ' "' + lastStatus + '"')
}, 30000)

setTimeout(() => {
  clearInterval(hb)
  if (ff) { try { ff.kill() } catch {} }
  session.stop()
  const mins = ((Date.now() - startAt) / 60000).toFixed(1)
  console.log('==== SUMMARY ====')
  console.log('ran ' + mins + ' min | transcripts=' + transcriptCount + ' | hotSwaps=' + hotSwaps + ' | goAways=' + goAways + ' | hardReconnects=' + hardReconnects)
  console.log((hardReconnects === 0 && transcriptCount > 0) ? 'RESULT: PASS — 撐過 12 分鐘無硬斷線（熱切換有效）' : 'RESULT: 見上方數據判讀')
  process.exit(0)
}, TEST_MS + 5000)
