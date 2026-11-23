import type { CSSProperties } from 'react'
import type { DisplayMode, Settings, TranscriptLine } from '../core'

const SUBTITLE_THEMES: Record<
  Settings['subtitleColor'],
  { translation: string; original: string }
> = {
  soft: { translation: '#f0d9a8', original: '#a7adb5' },
  white: { translation: '#f5f5f4', original: '#a7adb5' },
  bright: { translation: '#fde047', original: '#d1d5db' },
}

/* ------------------------------------------------------------------ *
 * Bidirectional script adaptation — pure helpers (no React).
 * Applied PER element so `both` mode renders two independent scripts.
 * RTL_LANGS is the single source of truth shared by isRtl + scriptOf.
 * ------------------------------------------------------------------ */

const RTL_LANGS = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv'])

type ScriptKind = 'latin' | 'cjk' | 'korean' | 'rtl' | 'thai' | 'indic'

interface ScriptStyle {
  maxInlineSize: string
  lineHeight: number
  letterSpacing: string
  wordBreak?: string
  lineBreak?: string
  overflowWrap?: string
  hyphens?: string
}

/** Lowercased primary subtag; e.g. zh-Hant / zh-Hans collapse to zh. */
function primarySubtag(lang?: string): string {
  return lang ? lang.toLowerCase().split('-')[0] : ''
}

function isRtl(lang?: string): 'rtl' | 'ltr' {
  return RTL_LANGS.has(primarySubtag(lang)) ? 'rtl' : 'ltr'
}

function scriptOf(lang?: string): ScriptKind {
  const p = primarySubtag(lang)
  if (RTL_LANGS.has(p)) return 'rtl'
  if (p === 'zh' || p === 'ja') return 'cjk'
  if (p === 'ko') return 'korean'
  if (p === 'th') return 'thai'
  if (p === 'hi' || p === 'bn' || p === 'ta' || p === 'te') return 'indic'
  return 'latin'
}

function styleForScript(s: ScriptKind): ScriptStyle {
  switch (s) {
    case 'cjk':
      return { maxInlineSize: '16em', lineHeight: 1.35, letterSpacing: '0', lineBreak: 'strict', overflowWrap: 'anywhere' }
    case 'korean':
      return { maxInlineSize: '18em', lineHeight: 1.4, letterSpacing: '0', wordBreak: 'keep-all' }
    case 'rtl':
      return { maxInlineSize: '38ch', lineHeight: 1.45, letterSpacing: '0' }
    case 'thai':
      return { maxInlineSize: '32ch', lineHeight: 1.55, letterSpacing: '0', lineBreak: 'auto' }
    case 'indic':
      return { maxInlineSize: '34ch', lineHeight: 1.55, letterSpacing: '0' }
    case 'latin':
    default:
      return { maxInlineSize: '38ch', lineHeight: 1.4, letterSpacing: '0.005em', overflowWrap: 'break-word', hyphens: 'none' }
  }
}

/** Per-line opacity by recency (distance from the bottom/newest line). */
const RECENCY_OPACITY = [1, 0.72, 0.5] as const

export function SubtitleView({
  lines,
  interim,
  displayMode,
  fontSize,
  centered,
  colorTheme,
  targetLang,
  waiting,
}: {
  lines: TranscriptLine[]
  interim?: TranscriptLine | null
  displayMode: DisplayMode
  fontSize: number
  centered: boolean
  colorTheme: Settings['subtitleColor']
  targetLang: string
  waiting?: boolean
}) {
  const showTranslation = displayMode !== 'original'
  const showOriginal = displayMode !== 'translation'
  const theme = SUBTITLE_THEMES[colorTheme] ?? SUBTITLE_THEMES.soft
  const shadow = '0 2px 10px rgba(0,0,0,0.85)'
  return (
    <>
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions text"
      >
        {lines.map((line) => (
          <p key={line.id}>
            {[
              showTranslation ? line.translation : '',
              showOriginal ? line.original : '',
            ]
              .filter(Boolean)
              .join('。')}
          </p>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="flex h-full w-full flex-col justify-end overflow-hidden bg-black/85 py-5"
        style={{
          containerType: 'inline-size',
          paddingInline: '1.5rem',
          maskImage:
            'linear-gradient(to bottom, transparent 0, #000 3rem, #000 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0, #000 3rem, #000 100%)',
        }}
      >
        <div
          className={`flex flex-col gap-3 ${
            centered ? 'items-center text-center' : 'items-start text-start'
          }`}
          style={{ width: 'fit-content', maxWidth: '100%', marginInline: 'auto' }}
        >
          {lines.length === 0 && !interim ? (
            <div
              className={`flex items-center gap-3 ${centered ? 'mx-auto' : ''}`}
              style={{
                color: '#9ca3af',
                fontSize: `${Math.min(fontSize, 1.5)}rem`,
              }}
            >
              <span>{waiting ? '聆聽中' : '等待語音'}</span>
              <span className="flex gap-1" aria-hidden="true">
                <span
                  className="typing-dot h-2 w-2 rounded-full bg-gray-500"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="typing-dot h-2 w-2 rounded-full bg-gray-500"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="typing-dot h-2 w-2 rounded-full bg-gray-500"
                  style={{ animationDelay: '300ms' }}
                />
              </span>
            </div>
          ) : (
            <>
              {lines.map((line, index) => {
                  const fromBottom = lines.length - 1 - index
                  const opacity = RECENCY_OPACITY[Math.min(fromBottom, 2)]
                  return (
                    <div
                      key={line.id}
                      className={`sub-line ${fromBottom === 0 ? 'line-in' : ''} flex flex-col gap-0.5 ${
                        centered ? 'items-center' : 'items-start'
                      }`}
                      style={{ opacity }}
                    >
                      {showTranslation && line.translation && (
                        <span
                          lang={targetLang}
                          dir={isRtl(targetLang)}
                          style={{
                            color: theme.translation,
                            fontSize: `clamp(${fontSize}rem, 4.5cqi, ${fontSize * 2.5}rem)`,
                            fontWeight: 600,
                            textShadow: shadow,
                            textWrap: 'balance',
                            ...styleForScript(scriptOf(targetLang)),
                          } as CSSProperties}
                        >
                          {line.translation}
                        </span>
                      )}
                      {showOriginal && line.original && (
                        <span
                          lang={line.sourceLang}
                          dir={line.sourceLang ? isRtl(line.sourceLang) : 'auto'}
                          style={{
                            color: theme.original,
                            fontSize: `${Math.max(fontSize * 0.7, 1.05)}rem`,
                            fontWeight: 400,
                            textShadow: shadow,
                            textWrap: 'balance',
                            ...styleForScript(scriptOf(line.sourceLang)),
                          } as CSSProperties}
                        >
                          {line.original}
                        </span>
                      )}
                    </div>
                  )
                })}
              {interim && (interim.translation || interim.original) && (
                <div
                  key="live"
                  className={`sub-line flex flex-col gap-0.5 ${centered ? 'items-center' : 'items-start'}`}
                  style={{ opacity: 0.85 }}
                >
                  {showTranslation && interim.translation && (
                    <span
                      lang={targetLang}
                      dir={isRtl(targetLang)}
                      style={{
                        color: theme.translation,
                        fontSize: `clamp(${fontSize}rem, 4.5cqi, ${fontSize * 2.5}rem)`,
                        fontWeight: 600,
                        textShadow: shadow,
                        textWrap: 'pretty',
                        ...styleForScript(scriptOf(targetLang)),
                      } as CSSProperties}
                    >
                      {interim.translation}
                      {!(showOriginal && interim.original) && (
                        <span className="sub-caret" aria-hidden="true" />
                      )}
                    </span>
                  )}
                  {showOriginal && interim.original && (
                    <span
                      lang={interim.sourceLang}
                      dir={interim.sourceLang ? isRtl(interim.sourceLang) : 'auto'}
                      style={{
                        color: theme.original,
                        fontSize: `${Math.max(fontSize * 0.7, 1.05)}rem`,
                        fontWeight: 400,
                        textShadow: shadow,
                        textWrap: 'pretty',
                        ...styleForScript(scriptOf(interim.sourceLang)),
                      } as CSSProperties}
                    >
                      {interim.original}
                      <span className="sub-caret" aria-hidden="true" />
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
