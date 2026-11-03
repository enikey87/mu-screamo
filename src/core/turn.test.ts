import { describe, expect, it } from 'vitest'
import { STAGES } from './championship'
import { breathAt, type DailyBull } from './daily'
import { createRound, push } from './round'
import { ROUND_MS } from './timing'
import { startWith, tossStarter } from './turn'

const fixture = (): DailyBull => ({ dateKey: 'test', label: 'test', pitch: 110, fury: 2, segments: [
  { kind: 'voice', ms: 2000 }, { kind: 'inhale', ms: 1000 },
  { kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 4000 },
] })

describe('first moo', () => {
  it.each([[0, 'you'], [0.499999, 'you'], [0.5, 'bull'], [0.999999, 'bull']] as const)('assigns coin sample %s to %s', (chance, expected) => {
    expect(tossStarter(chance)).toBe(expected)
  })

  it.each([-1, 1, NaN, Infinity, -Infinity])('rejects invalid coin sample %s', chance => {
    expect(() => tossStarter(chance)).toThrow(RangeError)
  })

  it('rotates the existing cycle to the player opening without changing a preset', () => {
    const bull = fixture()
    const original = structuredClone(bull)
    bull.segments.forEach(Object.freeze)
    Object.freeze(bull.segments)
    const scheduled = startWith(bull, 'you')
    expect(scheduled).toEqual({ ...original, segments: [
      { kind: 'inhale', ms: 1000 }, { kind: 'voice', ms: 1000 },
      { kind: 'inhale', ms: 4000 }, { kind: 'voice', ms: 2000 },
    ] })
    expect(bull).toEqual(original)
    expect(scheduled).not.toBe(bull)
    expect(scheduled.segments).not.toBe(bull.segments)
    expect(startWith(scheduled, 'bull')).toEqual({ ...original, segments: [
      { kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 4000 },
      { kind: 'voice', ms: 2000 }, { kind: 'inhale', ms: 1000 },
    ] })
  })

  it('keeps a matching opening and rejects an impossible opening', () => {
    expect(startWith(fixture(), 'bull')).toEqual(fixture())
    for (const first of ['you', 'bull'] as const) {
      expect(() => startWith({ ...fixture(), segments: [] }, first)).toThrow(RangeError)
      const kind = first === 'you' ? 'voice' : 'inhale'
      expect(() => startWith({ ...fixture(), segments: [{ kind, ms: 8000 }] }, first)).toThrow(RangeError)
    }
  })

  it.each(STAGES.map((stage, index) => [index, stage] as const))('keeps stage %i winnable with either opening and preserves its voice/air budgets', (_, stage) => {
    for (const first of ['you', 'bull'] as const) {
      const bull = startWith(stage.bull, first)
      expect(bull.segments.reduce((sum, segment) => sum + segment.ms, 0)).toBe(8000)
      expect(bull.segments.filter(segment => segment.kind === 'voice').map(segment => segment.ms).sort()).toEqual(stage.bull.segments.filter(segment => segment.kind === 'voice').map(segment => segment.ms).sort())
      expect(bull.segments[0].kind).toBe(first === 'you' ? 'inhale' : 'voice')
      const round = createRound(bull.segments, stage.rules)
      let view = push(round, { t: 0, db: -60, moo: false, hold: false })
      for (let t = 10; t <= ROUND_MS && view.phase !== 'done'; t += 10) {
        const hold = t >= 2550 && breathAt(bull.segments, t - 2550) === 'inhale'
        view = push(round, { t, db: -60, moo: false, hold })
      }
      expect(view.pleased).toBe(true)
    }
  })
})
