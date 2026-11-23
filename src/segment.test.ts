import { describe, it, expect } from 'vitest'
import { segmentBuffer } from './segment'

const buf = (translation: string, original = '', sourceLang?: string) => ({
  original,
  translation,
  sourceLang,
})

describe('segmentBuffer', () => {
  it('no punctuation over maxChars breaks at last space', () => {
    const r = segmentBuffer(buf('one two three four five six'), {
      maxChars: 20,
      minCommitChars: 4,
    })
    expect(r.committed).toHaveLength(1)
    expect(r.committed[0].translation).toBe('one two three four')
    expect(r.remainder.translation).toBe('five six')
  })

  it('commits multiple complete sentences and keeps the trailing partial', () => {
    const r = segmentBuffer(buf('Hello there. How are you? I am fine'))
    expect(r.committed.map((c) => c.translation)).toEqual([
      'Hello there.',
      'How are you?',
    ])
    expect(r.remainder.translation).toBe('I am fine')
  })

  it('does not split a decimal like 8.5', () => {
    const r = segmentBuffer(buf('The score was 8.5 today'))
    expect(r.committed).toHaveLength(0)
    expect(r.remainder.translation).toBe('The score was 8.5 today')
  })

  it('does not commit a tiny fragment from a stray early period', () => {
    const r = segmentBuffer(buf('Hi. This sentence is long enough.'))
    expect(r.committed).toHaveLength(1)
    expect(r.committed[0].translation).toBe('Hi. This sentence is long enough.')
    expect(r.remainder.translation).toBe('')
  })

  it('hard-cuts CJK with no spaces at maxChars', () => {
    const r = segmentBuffer(buf('一二三四五六七八九十十一十二'), {
      maxChars: 10,
      minCommitChars: 4,
    })
    expect(r.committed).toHaveLength(1)
    expect([...r.committed[0].translation].length).toBe(10)
    expect(r.remainder.translation).toBe('十一十二')
  })

  it('returns no committed for an empty buffer', () => {
    const r = segmentBuffer(buf(''))
    expect(r.committed).toHaveLength(0)
    expect(r.remainder.translation).toBe('')
  })

  it('attaches original only to the first committed segment', () => {
    const r = segmentBuffer(buf('First sentence here. And now the second sentence. tail', 'SRC'))
    expect(r.committed[0].original).toBe('SRC')
    expect(r.committed[1].original).toBe('')
    expect(r.remainder.original).toBe('')
  })
})

import { reduceDelta, flushInterim } from './segment'
import type { TranscriptDelta } from './core'

const delta = (
  translation: string,
  isFinal = false,
  original = '',
  sourceLang?: string,
): TranscriptDelta => ({ original, translation, isFinal, sourceLang })

describe('reduceDelta / flushInterim', () => {
  it('reproduces the bug fix: continuous non-final deltas DO produce committed lines', () => {
    let interim = { original: '', translation: '' }
    let nextId = 0
    const all: { translation: string }[] = []
    for (const c of ['Hello ', 'there. ', 'How ', 'are ', 'you? ', 'I am ', 'fine.']) {
      const r = reduceDelta(interim, nextId, delta(c, false))
      interim = r.interim
      nextId = r.nextId
      all.push(...r.committed)
    }
    expect(all.length).toBeGreaterThan(0)
    expect(all[0].translation).toBe('Hello there.')
  })

  it('flushInterim emits the leftover interim as one final line', () => {
    const r = flushInterim({ original: '', translation: 'trailing words no period' }, 5)
    expect(r.committed).toHaveLength(1)
    expect(r.committed[0].translation).toBe('trailing words no period')
    expect(r.committed[0].id).toBe(6)
    expect(r.committed[0].isFinal).toBe(true)
    expect(r.nextId).toBe(6)
  })

  it('flushInterim on empty interim commits nothing', () => {
    const r = flushInterim({ original: '', translation: '' }, 5)
    expect(r.committed).toHaveLength(0)
    expect(r.nextId).toBe(5)
  })

  it('assigns strictly increasing, unique ids across reduce + flush', () => {
    let interim = { original: '', translation: '' }
    let nextId = 0
    const ids: number[] = []
    for (const c of ['First sentence here. ', 'Second sentence here. ', 'tail']) {
      const r = reduceDelta(interim, nextId, delta(c, false))
      interim = r.interim
      nextId = r.nextId
      r.committed.forEach((l) => ids.push(l.id))
    }
    const f = flushInterim(interim, nextId)
    f.committed.forEach((l) => ids.push(l.id))
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('isFinal delta finalizes the whole buffer immediately', () => {
    const r = reduceDelta({ original: '', translation: 'partial sentence no end' }, 0, delta(' more', true))
    expect(r.committed).toHaveLength(1)
    expect(r.committed[0].translation).toBe('partial sentence no end more')
    expect(r.committed[0].isFinal).toBe(true)
    expect(r.interim.translation).toBe('')
  })
})
