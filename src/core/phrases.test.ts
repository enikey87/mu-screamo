import { describe, expect, it } from 'vitest'
import { PHRASES, revealedLine, selectPhrase, type Score } from './phrases'

const quiet: Score = { weightedMs: 0, mooMs: 0, screamMs: 0, stability: 0 }

describe('selectPhrase', () => {
  it('keeps twelve rungs', () => {
    expect(PHRASES).toHaveLength(12)
    expect(PHRASES[6].stamp).toBe('опись')
  })

  it('leaves a scream as waiting', () => {
    const phrase = selectPhrase({ weightedMs: 5_000, mooMs: 200, screamMs: 3_000, stability: 1 })
    expect(phrase.text).toBe('Я подожду.')
  })

  it('writes the inventory line after four seconds of weight', () => {
    const phrase = selectPhrase({ ...quiet, weightedMs: 3_400, mooMs: 3_400, stability: 0.2 })
    expect(phrase.stamp).toBe('опись')
  })

  it('adds the next bureaucratic line when the pitch stays put', () => {
    const phrase = selectPhrase({ ...quiet, weightedMs: 3_400, mooMs: 3_400, stability: 0.9 })
    expect(phrase.stamp).toBe('рога')
  })

  it('types the current line and shows it whole when the round ends', () => {
    const score = { ...quiet, weightedMs: 500, mooMs: 500 }
    expect(revealedLine(score, false).length).toBeGreaterThan(0)
    expect(revealedLine(score, false).length).toBeLessThan(selectPhrase(score).text.length)
    expect(revealedLine(score, true)).toBe('Му.')
  })
})
