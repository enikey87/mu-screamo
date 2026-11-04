import { describe, expect, it } from 'vitest'
import { pickChampionshipBull, STAGES } from './championship'
import { breathAt } from './daily'
import { createRound, push } from './round'
import { startWith } from './turn'
import { HUSH_MS, INVITE_MS, ROUND_MS } from './timing'

const budgets = [[1600, 6400], [3200, 4800], [3300, 4700], [4000, 4000], [4000, 4000]]

describe('championship rhythm catalog', () => {
  it.each([0, 1, 2, 3, 4])('gives stage %i three distinct schedules with its original time budgets', index => {
    const { rhythms } = STAGES[index]
    expect(rhythms).toHaveLength(3)
    expect(new Set(rhythms.map(pattern => JSON.stringify(pattern))).size).toBe(3)
    for (const pattern of rhythms) {
      expect(pattern.reduce((sum, segment) => sum + segment.ms, 0)).toBe(8000)
      expect(pattern.map(segment => segment.kind)).toEqual(pattern.map((_, i) => i % 2 ? 'inhale' : 'voice'))
      expect(pattern.every(segment => Number.isInteger(segment.ms) && segment.ms >= 400)).toBe(true)
      expect(['voice', 'inhale'].map(kind => pattern.filter(segment => segment.kind === kind).reduce((sum, segment) => sum + segment.ms, 0))).toEqual(budgets[index])
    }
  })

  it('keeps the tutorial spacious, the stubborn bull repetitive and the finale accelerating', () => {
    for (const pattern of STAGES[0].rhythms) {
      expect(pattern.filter(segment => segment.kind === 'inhale').every(segment => segment.ms >= 1800)).toBe(true)
      expect(pattern.filter(segment => segment.kind === 'voice').every(segment => segment.ms <= 600)).toBe(true)
    }
    for (const pattern of STAGES[1].rhythms) expect(pattern.slice(0, 4)).toEqual(pattern.slice(4))
    for (const pattern of STAGES[4].rhythms) {
      const voices = pattern.filter(segment => segment.kind === 'voice')
      expect(voices.slice(0, 2).every(segment => segment.ms >= 1100)).toBe(true)
      expect(voices.slice(2).every(segment => segment.ms <= 800)).toBe(true)
    }
  })
})

describe('rhythm selection', () => {
  it.each([[0, 0], [1 / 3 - .000001, 0], [1 / 3, 1], [2 / 3 - .000001, 1], [2 / 3, 2], [.999999, 2]])('maps first sample %s to pattern %i', (sample, expected) => {
    const selected = pickChampionshipBull(2, sample)
    expect(selected.rhythm).toBe(expected)
    expect(selected.bull.segments).toEqual(STAGES[2].rhythms[expected])
    expect(selected.bull.pitch).toBe(110)
    expect(selected.bull.fury).toBe(2)
  })

  it.each([0, 1, 2])('excludes previous pattern %i while leaving both alternatives available', previous => {
    const expected = [0, 1, 2].filter(index => index !== previous)
    const results = [0, .499999, .5, .999999].map(sample => pickChampionshipBull(4, sample, previous).rhythm)
    expect(results).toEqual([expected[0], expected[0], expected[1], expected[1]])
  })

  it('returns an isolated schedule without changing a previously selected round', () => {
    const before = structuredClone(STAGES)
    const first = pickChampionshipBull(2, .1), snapshot = structuredClone(first)
    const next = pickChampionshipBull(2, .9, first.rhythm)
    expect(first).toEqual(snapshot)
    expect(next.rhythm).not.toBe(first.rhythm)
    next.bull.segments[0].ms = 1
    expect(STAGES).toEqual(before)
    expect(pickChampionshipBull(2, .1)).toEqual(snapshot)
  })

  it.each([-1, 1, NaN, Infinity, -Infinity])('rejects invalid random sample %s', sample => {
    expect(() => pickChampionshipBull(0, sample)).toThrow(RangeError)
  })
  it.each([-1, 3, .5, NaN, Infinity])('rejects invalid previous pattern %s', previous => {
    expect(() => pickChampionshipBull(0, .5, previous)).toThrow(RangeError)
  })
  it.each([-1, 5, .5, NaN])('rejects invalid stage %s', stage => {
    expect(() => pickChampionshipBull(stage, .5)).toThrow(RangeError)
  })
})

describe('rhythm fairness', () => {
  for (const stage of [0, 1, 2, 3, 4]) for (const rhythm of [0, 1, 2]) {
    it(`keeps stage ${stage}, pattern ${rhythm} winnable with a delayed response from either opening`, () => {
      for (const first of ['you', 'bull'] as const) for (const behavior of ['timed', 'continuous', 'silent']) {
        const bull = startWith(pickChampionshipBull(stage, (rhythm + .5) / 3).bull, first)
        const round = createRound(bull.segments, STAGES[stage].rules)
        let view = push(round, { t: 0, db: -60, moo: false, hold: false })
        for (let t = 10; t <= ROUND_MS && view.phase !== 'done'; t += 10) {
          const delayed = t - HUSH_MS - INVITE_MS - 150
          const hold = behavior === 'continuous' || behavior === 'timed' && delayed >= 0 && breathAt(bull.segments, delayed) === 'inhale'
          view = push(round, { t, db: -60, moo: false, hold })
        }
        if (behavior === 'timed') expect(view.pleased, `${first}: delayed input must win`).toBe(true)
        if (behavior === 'silent') {
          expect(view.puzzled).toBe(true)
          if (stage >= 3) expect(view.finish).toBe('knockout')
        }
        if (behavior === 'continuous' && stage >= 3) expect(view.puzzled).toBe(true)
      }
    })
  }
})
