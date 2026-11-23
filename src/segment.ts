import type { TranscriptDelta, TranscriptLine } from './core'

export interface InterimBuffer {
  original: string
  translation: string
  sourceLang?: string
}

export interface SegmentResult {
  committed: InterimBuffer[]
  remainder: InterimBuffer
}

const DEFAULT_MAX_CHARS = 160
const DEFAULT_MIN_COMMIT_CHARS = 12

const isWs = (ch: string | undefined) =>
  ch === undefined || ch === ' ' || ch === '\n' || ch === '\t'

/**
 * Index (exclusive) at which to peel a finalized segment off the FRONT of
 * `text`, or 0 if the whole thing should stay as remainder.
 * - Sentence boundary: CJK/full-width enders (。！？…) immediately, or ASCII
 *   .!? followed by whitespace/end (so "8.5" mid-number is not a boundary).
 *   Must land at or after minCommitChars, else keep scanning (no tiny shards).
 * - Length fallback: if no boundary and length > maxChars, break at the last
 *   space before maxChars; if there is none (CJK run-on), hard-cut maxChars.
 */
function nextCut(text: string, maxChars: number, minCommitChars: number): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const cjkEnd = ch === '。' || ch === '！' || ch === '？' || ch === '…'
    const asciiEnd = (ch === '!' || ch === '?' || ch === '.') && isWs(text[i + 1])
    if ((cjkEnd || asciiEnd) && i + 1 >= minCommitChars) return i + 1
  }
  if (text.length > maxChars) {
    const lastSpace = text.lastIndexOf(' ', maxChars)
    if (lastSpace >= minCommitChars) return lastSpace
    return maxChars
  }
  return 0
}

export function segmentBuffer(
  buf: InterimBuffer,
  opts?: { maxChars?: number; minCommitChars?: number },
): SegmentResult {
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS
  const minCommitChars = opts?.minCommitChars ?? DEFAULT_MIN_COMMIT_CHARS

  const committed: InterimBuffer[] = []
  let rest = buf.translation
  let firstOriginal = buf.original
  const sourceLang = buf.sourceLang

  for (;;) {
    const cut = nextCut(rest, maxChars, minCommitChars)
    if (cut <= 0) break
    committed.push({
      original: firstOriginal,
      translation: rest.slice(0, cut).trimEnd(),
      sourceLang,
    })
    firstOriginal = ''
    rest = rest.slice(cut)
    if (rest.startsWith(' ')) rest = rest.slice(1)
  }

  return {
    committed,
    remainder: { original: firstOriginal, translation: rest, sourceLang },
  }
}

export interface DeltaResult {
  interim: InterimBuffer
  committed: TranscriptLine[]
  nextId: number
}

/**
 * Accumulate a delta into the interim buffer and finalize any complete
 * segments. A real turnComplete (delta.isFinal) finalizes the whole buffer;
 * otherwise segmentBuffer peels off complete sentences / over-length chunks.
 * Returns ONLY the lines finalized by THIS delta (with ids assigned); the
 * caller appends them to its history. Immutable — does not mutate `interim`.
 */
export function reduceDelta(
  interim: InterimBuffer,
  nextId: number,
  delta: TranscriptDelta,
  opts?: { maxChars?: number; minCommitChars?: number },
): DeltaResult {
  const acc: InterimBuffer = {
    original: interim.original + delta.original,
    translation: interim.translation + delta.translation,
    sourceLang: delta.sourceLang || interim.sourceLang,
  }

  if (delta.isFinal && (acc.original || acc.translation)) {
    const id = nextId + 1
    const line: TranscriptLine = {
      id,
      original: acc.original,
      translation: acc.translation,
      sourceLang: acc.sourceLang,
      isFinal: true,
    }
    return {
      interim: { original: '', translation: '', sourceLang: acc.sourceLang },
      committed: [line],
      nextId: id,
    }
  }

  const { committed: segs, remainder } = segmentBuffer(acc, opts)
  const lines: TranscriptLine[] = []
  let id = nextId
  for (const s of segs) {
    if (!s.original && !s.translation) continue
    id += 1
    lines.push({
      id,
      original: s.original,
      translation: s.translation,
      sourceLang: s.sourceLang,
      isFinal: true,
    })
  }
  return { interim: remainder, committed: lines, nextId: id }
}

/** Finalize whatever remains in the interim buffer (stop / pause-flush). */
export function flushInterim(
  interim: InterimBuffer,
  nextId: number,
): { committed: TranscriptLine[]; nextId: number } {
  if (!interim.original && !interim.translation) {
    return { committed: [], nextId }
  }
  const id = nextId + 1
  return {
    committed: [
      {
        id,
        original: interim.original,
        translation: interim.translation,
        sourceLang: interim.sourceLang,
        isFinal: true,
      },
    ],
    nextId: id,
  }
}
