import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_MODEL, DEFAULT_SETTINGS, TARGET_LANGUAGES, downloadTranscript } from './core'
import type { AudioSource, DisplayMode, Settings, TranscriptLine } from './core'
import { Icon } from './components/Icon'
import { Field, Select, Segmented, FOCUS_RING } from './components/controls'
import { StatusPill, Step } from './components/StatusPill'
import { SubtitleView } from './components/SubtitleView'
import { useLocalStorage } from './hooks/useLocalStorage'
import { usePictureInPicture } from './hooks/usePictureInPicture'
import { useTranslator } from './hooks/useTranslator'

/* ================================================================== *
 * App — composition root. UI is split into ./components/* and ./hooks/*.
 *
 * Font: fixed to Noto Sans TC (思源黑體) via index.css `body`. No in-app
 * font switcher — chosen deliberately (users don't change fonts).
 * ================================================================== */

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

function validateApiKey(key: string): string | null {
  const trimmed = key.trim()
  if (!trimmed) return '請先貼上 Gemini API Key 才能開始。'
  // internal whitespace / newline almost always means a broken paste
  if (/\s/.test(trimmed)) {
    return '金鑰格式看起來不正確（請檢查是否夾帶空格或換行）。正確金鑰多為 AIza… 開頭。'
  }
  // light prefix heuristic — known Gemini key prefixes are AIza / AQ
  if (!/^AIza/.test(trimmed) && !/^AQ/.test(trimmed)) {
    return '金鑰格式看起來不正確（請確認貼的是 Gemini API 金鑰，正確金鑰多為 AIza… 開頭）。'
  }
  return null
}

export default function App() {
  const [apiKey, setApiKey] = useLocalStorage<string>('gemini_api_key', '')
  const [storedSettings, setSettings] = useLocalStorage<Settings>(
    'lt_settings',
    DEFAULT_SETTINGS,
  )
  const settings = useMemo<Settings>(() => {
    const merged = { ...DEFAULT_SETTINGS, ...storedSettings }
    return { ...merged, maxLines: Math.min(merged.maxLines, 3) }
  }, [storedSettings])
  const translator = useTranslator()
  const pip = usePictureInPicture()
  const [showKey, setShowKey] = useState(false)
  const [showKeyHelp, setShowKeyHelp] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const keyInputRef = useRef<HTMLInputElement>(null)
  const immersiveTriggerRef = useRef<HTMLButtonElement>(null)
  const immersiveCloseRef = useRef<HTMLButtonElement>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const running = translator.capturing
  const connecting = translator.capturing && !translator.connected

  const patch = useCallback(
    (part: Partial<Settings>) => setSettings({ ...settings, ...part }),
    [settings, setSettings],
  )

  const finals = useMemo<TranscriptLine[]>(
    () => translator.lines.slice(-settings.maxLines),
    [translator.lines, settings.maxLines],
  )
  const interimLine = useMemo<TranscriptLine | null>(() => {
    const il = translator.interim
    return il && (il.original || il.translation)
      ? {
          id: 0,
          original: il.original,
          translation: il.translation,
          sourceLang: il.sourceLang,
          isFinal: false,
        }
      : null
  }, [translator.interim])

  const onToggle = useCallback(() => {
    if (running) {
      translator.stop()
      return
    }
    const issue = validateApiKey(apiKey)
    if (issue) {
      setKeyError(issue)
      return
    }
    setKeyError(null)
    if (settings.audioSource === 'display') {
      const ready = window.confirm(
        '重要：彈出分享視窗時，務必勾選「分享分頁音訊 / Share tab audio」，否則會沒有聲音。（macOS Chrome 只能抓單一分頁音訊，無法抓整台電腦的聲音。）',
      )
      if (!ready) return
    }
    void translator.start({
      apiKey,
      targetLang: settings.targetLang,
      audioSource: settings.audioSource,
      reconnectSeconds: settings.reconnectSeconds,
    })
  }, [running, translator, apiKey, settings])

  const onToggleFloat = useCallback(async () => {
    setUiError(null)
    if (pip.pipWindow) {
      pip.close()
      return
    }
    try {
      await pip.open()
    } catch (e) {
      setUiError(e instanceof Error ? e.message : '無法開啟浮動字幕')
    }
  }, [pip])

  // Esc exits focus (immersive) mode
  useEffect(() => {
    if (!focusMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusMode(false)
    }
    window.addEventListener('keydown', onKey)
    immersiveCloseRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      // Intentional: read the trigger at cleanup time. focusMode early-returns the
      // immersive overlay, so the trigger button is unmounted while focusMode is true
      // and only remounts after focusMode→false — reading .current here (post-commit)
      // is what restores focus to it on exit (D-4). Capturing it in the effect body
      // would read null.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      immersiveTriggerRef.current?.focus()
    }
  }, [focusMode])

  // Warn before leaving while capturing or with un-saved subtitles on screen.
  useEffect(() => {
    const dirty = translator.capturing || translator.lines.length > 0
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [translator.capturing, translator.lines])

  const requestFullscreen = useCallback(() => {
    const el = document.documentElement
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void el.requestFullscreen?.()
  }, [])

  const [downloaded, setDownloaded] = useState(false)
  const downloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onDownload = useCallback(() => {
    const lines = [...translator.getHistory()]
    if (interimLine) lines.push(interimLine)
    if (lines.length === 0) return
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate(),
    )}-${pad(now.getHours())}${pad(now.getMinutes())}`
    downloadTranscript(lines, `transcript-${stamp}.txt`)
    setDownloaded(true)
    if (downloadTimer.current) clearTimeout(downloadTimer.current)
    downloadTimer.current = setTimeout(() => setDownloaded(false), 1500)
  }, [translator, interimLine])

  useEffect(
    () => () => {
      if (downloadTimer.current) clearTimeout(downloadTimer.current)
    },
    [],
  )

  const errorMsg = translator.error ?? uiError
  const isKeyIssue = !!translator.error && translator.error.includes('金鑰')
  const hasContent = translator.lines.length > 0 || !!translator.interim

  const subtitle = (
    <SubtitleView
      lines={finals}
      interim={interimLine}
      displayMode={settings.displayMode}
      fontSize={settings.fontSize}
      centered={settings.centered}
      colorTheme={settings.subtitleColor}
      targetLang={settings.targetLang}
      waiting={running}
    />
  )

  /* ---------- immersive / focus overlay ---------- */
  if (focusMode) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="immersive-title"
        className="fixed inset-0 z-50 flex flex-col bg-black"
      >
        <h2 id="immersive-title" className="sr-only">沉浸字幕模式</h2>
        <div className="flex items-center gap-3 px-4 py-3">
          <StatusPill
            connected={translator.connected}
            connecting={connecting}
            running={running}
            status={translator.status}
          />
          <span className="ml-auto mr-1 text-xs text-gray-400">按 Esc 離開</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={requestFullscreen}
              aria-label="切換全螢幕"
              className={`flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-gray-200 hover:bg-white/5 ${FOCUS_RING}`}
            >
              <Icon name="maximize" />
            </button>
            <button
              ref={immersiveCloseRef}
              type="button"
              onClick={() => setFocusMode(false)}
              aria-label="退出沉浸模式"
              className={`flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-gray-200 hover:bg-white/5 ${FOCUS_RING}`}
            >
              <Icon name="x" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">{subtitle}</div>
        <div className="flex justify-center px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            className={`flex min-h-[44px] items-center gap-2 rounded-xl px-6 py-3 text-base font-semibold transition ${FOCUS_RING} ${
              !running
                ? 'bg-sky-500 text-white hover:bg-sky-400'
                : connecting
                  ? 'bg-amber-500/90 text-white hover:bg-amber-500'
                  : 'bg-red-500/90 text-white hover:bg-red-500'
            }`}
          >
            {running ? (
              connecting ? (
                <>
                  <Icon name="loader" className="animate-spin" /> 連線中…（點擊取消）
                </>
              ) : (
                <>
                  <Icon name="square" filled /> 停止擷取
                </>
              )
            ) : (
              <>
                <Icon name="circle" filled /> 開始擷取並翻譯
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  /* ---------- normal layout ---------- */
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-5 px-4 py-6 [touch-action:manipulation]">
      {/* header */}
      <header className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300">
          <Icon name="mic" size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Live Translate</h1>
          <p className="text-sm text-gray-400">
            即時把現場或分頁裡的語音，邊聽邊翻成字幕（使用你自己的 Gemini 金鑰）
          </p>
          <div className="mt-1.5">
            <span
              className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-gray-400"
              title={DEFAULT_MODEL}
            >
              模型：{DEFAULT_MODEL}
            </span>
          </div>
        </div>
        <div className="ml-auto">
          <StatusPill
            connected={translator.connected}
            connecting={connecting}
            running={running}
            status={translator.status}
          />
        </div>
      </header>

      {/* API key */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-300">Gemini API Key</h2>
          <button
            type="button"
            onClick={() => setShowKeyHelp((v) => !v)}
            aria-expanded={showKeyHelp}
            className={`rounded text-xs text-sky-400 hover:underline ${FOCUS_RING}`}
          >
            沒有金鑰？點我看 30 秒取得教學
          </button>
        </div>
        <div className="flex gap-2">
          <input
            ref={keyInputRef}
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => {
              const next = e.target.value.trim()
              setApiKey(next)
              setKeyError(next ? validateApiKey(next) : null)
            }}
            disabled={running}
            placeholder="在這裡貼上你的 Gemini 金鑰（通常以 AIza 開頭）"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!keyError}
            className={`min-h-[44px] flex-1 rounded-lg border bg-black/30 px-3 py-2 text-base text-gray-100 outline-none focus:border-sky-400 disabled:opacity-50 ${FOCUS_RING} ${
              keyError ? 'border-red-500/60' : 'border-white/10'
            }`}
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? '隱藏金鑰' : '顯示金鑰'}
            className={`flex min-h-[44px] w-12 items-center justify-center rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 ${FOCUS_RING}`}
          >
            <Icon name={showKey ? 'eye-off' : 'eye'} />
          </button>
        </div>
        {keyError ? (
          <p className="mt-2 text-xs text-red-300" role="alert">
            {keyError}
          </p>
        ) : (
          <p className="mt-2 text-xs text-gray-400">
            你的金鑰只會存在這台電腦的瀏覽器，並直接傳給 Google；本網站不會、也無法看到或保存你的金鑰。建議申請一組「不綁信用卡」的免費金鑰專門給這個工具。第一次用請點右上角「沒有金鑰？點我看 30 秒取得教學」。
          </p>
        )}
        {showKeyHelp && (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-gray-300">
            <p className="mb-2 font-medium text-gray-200">30 秒取得免費金鑰：</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>用 Google 帳號登入 Google AI Studio。</li>
              <li>
                點{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className={`text-sky-400 hover:underline ${FOCUS_RING}`}
                >
                  建立 API 金鑰（Create API key）
                </a>
                ，建議選「不綁信用卡」的免費專案。
              </li>
              <li>複製產生的金鑰，貼回上面的輸入框即可。</li>
            </ol>
          </div>
        )}
      </section>

      {/* basic settings */}
      <section aria-label="基本設定" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="音訊來源">
          <Segmented<AudioSource>
            value={settings.audioSource}
            disabled={running}
            onChange={(v) => patch({ audioSource: v })}
            options={[
              {
                value: 'mic',
                label: (
                  <>
                    <Icon name="mic" size={16} /> 麥克風
                  </>
                ),
              },
              {
                value: 'display',
                label: (
                  <>
                    <Icon name="monitor" size={16} /> 擷取分頁
                  </>
                ),
              },
            ]}
          />
          <p className="text-xs text-gray-400">
            {settings.audioSource === 'mic'
              ? '翻譯現場講的話（上課、會議發言）'
              : '翻譯另一個分頁的線上會議／影片聲音'}
          </p>
          {settings.audioSource === 'display' && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200">
              <Icon name="monitor" size={14} className="mt-0.5 shrink-0" />
              <span>
                重要：彈出分享視窗時，務必勾選「分享分頁音訊 / Share tab audio」，否則會沒有聲音。（macOS Chrome 只能抓單一分頁音訊，無法抓整台電腦的聲音。）
              </span>
            </p>
          )}
        </Field>

        <Field label="目標語言（字幕顯示）">
          <Select
            value={settings.targetLang}
            disabled={running}
            onChange={(v) => patch({ targetLang: v })}
          >
            {TARGET_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      {/* advanced settings (progressive disclosure) */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className={`flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-gray-300 ${FOCUS_RING}`}
        >
          <Icon name="sliders" size={18} />
          進階設定
          <Icon
            name="chevron"
            size={18}
            className={`ml-auto transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
          />
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-1 gap-4 border-t border-white/10 p-4 sm:grid-cols-2">
            <Field label="顯示模式">
              <Select
                value={settings.displayMode}
                onChange={(v) => patch({ displayMode: v as DisplayMode })}
              >
                <option value="both">原文 + 譯文</option>
                <option value="translation">僅譯文</option>
                <option value="original">僅原文</option>
              </Select>
            </Field>

            <Field label="字幕配色">
              <Select
                value={settings.subtitleColor}
                onChange={(v) =>
                  patch({ subtitleColor: v as Settings['subtitleColor'] })
                }
              >
                <option value="soft">柔黃（護眼）</option>
                <option value="white">純白</option>
                <option value="bright">亮黃（高對比）</option>
              </Select>
            </Field>

            <Field label="自動重新連線間隔（一般不需更改）">
              <Select
                value={settings.reconnectSeconds}
                disabled={running}
                onChange={(v) => patch({ reconnectSeconds: Number(v) })}
              >
                <option value={60}>60 秒（說話非常密集時）</option>
                <option value={90}>90 秒（建議，預設）</option>
                <option value={120}>120 秒（說話較少時）</option>
                <option value={150}>150 秒（間隔最長）</option>
              </Select>
              <p className="text-xs text-gray-400">
                為了讓字幕長時間不中斷，系統會每隔一段時間在背景自動換一條新連線。除非常常斷線，否則維持預設即可。
              </p>
            </Field>

            <Field label={`顯示行數：${settings.maxLines}`}>
              <input
                type="range"
                min={1}
                max={3}
                value={settings.maxLines}
                onChange={(e) => patch({ maxLines: Number(e.target.value) })}
                className={`min-h-[44px] accent-sky-400 ${FOCUS_RING}`}
              />
            </Field>

            <Field label="字幕文字大小">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">小</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.25}
                  value={settings.fontSize}
                  onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                  className={`min-h-[44px] flex-1 accent-sky-400 ${FOCUS_RING}`}
                  aria-label="字幕文字大小"
                />
                <span className="text-xs text-gray-500">大</span>
              </div>
            </Field>

            <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={settings.centered}
                onChange={(e) => patch({ centered: e.target.checked })}
                className={`h-4 w-4 accent-sky-400 ${FOCUS_RING}`}
              />
              字幕置中對齊
            </label>
          </div>
        )}
      </section>

      {/* actions */}
      <section aria-label="操作" className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold shadow-lg transition ${FOCUS_RING} ${
            !running
              ? 'bg-sky-500 text-white shadow-sky-500/30 hover:bg-sky-400'
              : connecting
                ? 'bg-amber-500/90 text-white shadow-amber-500/20 hover:bg-amber-500'
                : 'bg-red-500/90 text-white shadow-red-500/20 hover:bg-red-500'
          }`}
        >
          {running ? (
            connecting ? (
              <>
                <Icon name="loader" className="animate-spin" /> 連線中…（點擊取消）
              </>
            ) : (
              <>
                <Icon name="square" filled /> 停止擷取
              </>
            )
          ) : (
            <>
              <Icon name="circle" filled /> 開始擷取並翻譯
            </>
          )}
        </button>
        <button
          ref={immersiveTriggerRef}
          type="button"
          onClick={() => setFocusMode(true)}
          aria-label="沉浸模式"
          title="沉浸模式（字幕放大）"
          className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm text-gray-200 hover:bg-white/5 ${FOCUS_RING}`}
        >
          <Icon name="maximize" size={18} /> 沉浸
        </button>
        <button
          type="button"
          onClick={onToggleFloat}
          disabled={!pip.supported}
          aria-label="浮動字幕"
          title={
            pip.supported
              ? '浮動字幕：把字幕變成可拖曳、永遠顯示在最上層的小視窗，方便邊看其他畫面邊看字幕（需 Chrome／Edge 116 以上）'
              : '浮動字幕需 Chrome 或 Edge 116 以上版本才能使用。'
          }
          className={`flex min-h-[44px] items-center justify-center rounded-xl border border-white/10 px-4 py-3 text-gray-200 hover:bg-white/5 disabled:opacity-40 ${FOCUS_RING}`}
        >
          <Icon name="pip" size={18} />
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={translator.getHistory().length === 0 && !translator.interim}
          aria-label="下載字幕 .txt"
          title={
            translator.getHistory().length === 0 && !translator.interim
              ? '尚無字幕可下載（開始翻譯後就能下載）'
              : '下載逐字稿：把目前全部字幕存成 .txt 文字檔'
          }
          className={`flex min-h-[44px] items-center justify-center rounded-xl border border-white/10 px-4 py-3 hover:bg-white/5 disabled:opacity-40 ${FOCUS_RING} ${
            downloaded ? 'text-emerald-300' : 'text-gray-200'
          }`}
        >
          <Icon name={downloaded ? 'check' : 'download'} size={18} />
        </button>
        {confirmClear ? (
          <div className="flex min-h-[44px] basis-full items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 sm:basis-auto">
            <Icon name="alert" size={16} className="shrink-0 text-red-300" />
            <span className="flex-1 text-xs text-red-200">
              確定清除全部字幕？清除後無法復原，建議先按「下載」保存。
            </span>
            <button
              type="button"
              onClick={() => {
                translator.clear()
                setConfirmClear(false)
              }}
              className={`shrink-0 rounded-lg bg-red-500/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 ${FOCUS_RING}`}
            >
              確定清除
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10 ${FOCUS_RING}`}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={!hasContent}
            aria-label="清除字幕"
            title="清除字幕：清空畫面上目前所有字幕"
            className={`flex min-h-[44px] items-center justify-center rounded-xl border border-white/10 px-4 py-3 text-gray-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40 ${FOCUS_RING}`}
          >
            <Icon name="trash" size={18} />
          </button>
        )}
        <span className="sr-only" role="status">
          {downloaded ? '已下載字幕檔' : ''}
        </span>
      </section>

      {errorMsg && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1 whitespace-pre-line">{errorMsg}</span>
          {isKeyIssue ? (
            <span className="flex shrink-0 flex-col items-end gap-1">
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className={`rounded px-2 py-0.5 text-xs font-semibold text-red-200 underline hover:text-white ${FOCUS_RING}`}
              >
                前往 AI Studio
              </a>
              <button
                type="button"
                onClick={() => {
                  setShowKey(true)
                  keyInputRef.current?.focus()
                }}
                className={`rounded px-2 py-0.5 text-xs font-semibold text-red-200 underline hover:text-white ${FOCUS_RING}`}
              >
                重新輸入金鑰
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (uiError) void onToggleFloat()
                else onToggle()
              }}
              className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold text-red-200 underline hover:text-white ${FOCUS_RING}`}
            >
              重試
            </button>
          )}
        </div>
      )}

      {/* inline subtitle preview / first-run guide */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-400">字幕預覽</h2>
        <div className="relative h-64 overflow-hidden rounded-2xl border border-white/10">
          {subtitle}
          {!running && translator.lines.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
              <p className="text-sm font-medium text-gray-200">三步開始：</p>
              <ol className="space-y-1.5 text-sm text-gray-300">
                <li className="flex items-center gap-2">
                  <Step n={1} done={!!apiKey.trim()} /> 貼上 Gemini API Key
                </li>
                <li className="flex items-center gap-2">
                  <Step n={2} done /> 選音訊來源（麥克風 / 擷取分頁）
                </li>
                <li className="flex items-center gap-2">
                  <Step n={3} done={false} /> 按「開始擷取並翻譯」
                </li>
              </ol>
            </div>
          )}
        </div>
      </section>

      {/* floating subtitle (Document Picture-in-Picture) */}
      {pip.pipWindow && createPortal(subtitle, pip.pipWindow.document.body)}
    </div>
  )
}
