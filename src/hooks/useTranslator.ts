import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioCapture, GeminiLiveSession, mediaErrorMessage } from '../core'
import type { AudioSource, TranscriptDelta, TranscriptLine } from '../core'
import { reduceDelta, flushInterim } from '../segment'

interface InterimLine {
  original: string
  translation: string
  sourceLang?: string
}

interface StartOpts {
  apiKey: string
  targetLang: string
  audioSource: AudioSource
  reconnectSeconds: number
}

const MAX_RENDER_LINES = 200
const PAUSE_FLUSH_MS = 1300

export function useTranslator() {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [interim, setInterim] = useState<InterimLine | null>(null)
  const [status, setStatus] = useState('尚未開始')
  const [connected, setConnected] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionRef = useRef<GeminiLiveSession | null>(null)
  const captureRef = useRef<AudioCapture | null>(null)
  const interimRef = useRef<InterimLine>({ original: '', translation: '' })
  const historyRef = useRef<TranscriptLine[]>([])
  const idRef = useRef(0)
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const commitFlush = useCallback(() => {
    const { committed, nextId } = flushInterim(interimRef.current, idRef.current)
    if (!committed.length) return
    idRef.current = nextId
    committed.forEach((l) => historyRef.current.push(l))
    setLines((prev) => {
      const next = [...prev, ...committed]
      return next.length > MAX_RENDER_LINES ? next.slice(-MAX_RENDER_LINES) : next
    })
    interimRef.current = { original: '', translation: '' }
    setInterim(null)
  }, [])

  const schedulePauseFlush = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = setTimeout(() => {
      pauseTimerRef.current = null
      commitFlush()
    }, PAUSE_FLUSH_MS)
  }, [commitFlush])

  const handleDelta = useCallback(
    (delta: TranscriptDelta) => {
      const { interim: nextInterim, committed, nextId } = reduceDelta(
        interimRef.current,
        idRef.current,
        delta,
      )
      idRef.current = nextId
      interimRef.current = nextInterim
      if (committed.length) {
        committed.forEach((l) => historyRef.current.push(l))
        setLines((prev) => {
          const next = [...prev, ...committed]
          return next.length > MAX_RENDER_LINES ? next.slice(-MAX_RENDER_LINES) : next
        })
      }
      setInterim(
        nextInterim.translation || nextInterim.original
          ? {
              original: nextInterim.original,
              translation: nextInterim.translation,
              sourceLang: nextInterim.sourceLang,
            }
          : null,
      )
      schedulePauseFlush()
    },
    [schedulePauseFlush],
  )

  const stop = useCallback(() => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current)
      pauseTimerRef.current = null
    }
    commitFlush()
    sessionRef.current?.stop()
    captureRef.current?.stop()
    sessionRef.current = null
    captureRef.current = null
    interimRef.current = { original: '', translation: '' }
    setInterim(null)
    setCapturing(false)
    setConnected(false)
    setStatus('已停止')
  }, [commitFlush])

  const start = useCallback(
    async (opts: StartOpts) => {
      setError(null)
      if (!opts.apiKey.trim()) {
        setError('請先貼上 Gemini API Key')
        return
      }
      sessionRef.current?.stop()
      captureRef.current?.stop()

      const session = new GeminiLiveSession(
        {
          apiKey: opts.apiKey.trim(),
          targetLang: opts.targetLang,
          reconnectSeconds: opts.reconnectSeconds,
        },
        {
          onTranscript: handleDelta,
          onStatus: (message, isConnected) => {
            setStatus(message)
            setConnected(isConnected)
          },
          onError: (message) => setError(message),
          onFatal: (message) => {
            // Fatal (invalid key / quota / reconnect exhausted): the core session
            // has already stopped its own sockets. Run the SAME full cleanup as
            // stop() (stop capture, null refs, setCapturing(false),
            // setConnected(false)) then surface the message.
            stop()
            setError(message)
          },
        },
      )
      sessionRef.current = session

      const capture = new AudioCapture()
      captureRef.current = capture
      try {
        session.start()
        setCapturing(true)
        await capture.start(
          opts.audioSource,
          (b64) => session.sendAudio(b64),
          () => stop(),
        )
        // stop() (cancel click, or onFatal) may have run while the mic prompt /
        // tab picker was open. The stream only exists now, so release it here or
        // the mic stays live while the UI shows "stopped".
        if (captureRef.current !== capture) capture.stop()
      } catch (e) {
        if (captureRef.current !== capture) {
          // Superseded by stop()/a newer start(): just clean up, keep its UI state.
          capture.stop()
          return
        }
        session.stop()
        capture.stop()
        sessionRef.current = null
        captureRef.current = null
        setCapturing(false)
        setConnected(false)
        setStatus('啟動失敗')
        setError(mediaErrorMessage(e, opts.audioSource))
      }
    },
    [handleDelta, stop],
  )

  const clear = useCallback(() => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current)
      pauseTimerRef.current = null
    }
    historyRef.current = []
    idRef.current = 0
    interimRef.current = { original: '', translation: '' }
    setLines([])
    setInterim(null)
  }, [])

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    }
  }, [])

  const getHistory = useCallback(() => historyRef.current, [])

  return {
    lines,
    interim,
    status,
    connected,
    capturing,
    error,
    start,
    stop,
    clear,
    getHistory,
  }
}
