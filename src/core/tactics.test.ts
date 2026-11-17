import { describe, expect, it } from 'vitest'
import { applyTactic } from './tactics'
import { STAGES, pickChampionshipBull } from './championship'
import { startWith } from './turn'
import { createRound, push } from './round'
import type { Segment } from './daily'

const pattern: Segment[] = [
  { kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 1000 },
  { kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 1000 },
  { kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 3000 },
]

describe('championship tactics', () => {
  it('keeps daily rules and the source schedule unchanged', () => {
    const before = structuredClone(pattern)
    expect(applyTactic(pattern)).toEqual(pattern)
    applyTactic(pattern, 4)
    expect(pattern).toEqual(before)
  })

  it('gives each opponent a distinct observable opening or voice pattern', () => {
    expect(applyTactic(pattern, 0)[1].opening).toBe(1.12)
    expect(applyTactic(pattern, 1)[0].pressure).toEqual([.6, 1.4])
    const alternating = applyTactic(pattern, 2)
    expect(alternating[0].pressure).toEqual([.7, .7])
    expect(alternating[2].pressure).toEqual([1.3, 1.3])
    expect(alternating[3].opening).toBe(1.25)
    expect(applyTactic(pattern, 3)[0].pressure).toEqual([1.45, .55])
    expect(applyTactic(pattern, 3)[1].opening).toBe(1.2)
    const final = applyTactic(pattern, 4)
    expect(final[0].pressure).toEqual([.6, 1.4])
    expect(final[4].pressure).toEqual([1.45, .55])
  })

  it.each(['you', 'bull'] as const)('keeps the finale switch tied to fight time when %s starts', first => {
    const bull = startWith(pickChampionshipBull(4, .1).bull, first)
    let elapsed = 0
    for (const segment of bull.segments) {
      if (segment.kind === 'voice') expect(segment.pressure).toEqual(elapsed < 4000 ? [.6, 1.4] : [1.45, .55])
      elapsed += segment.ms
    }
    expect(elapsed).toBe(8000)
  })

  it('changes physical and visible force at the same halfway boundary without frame-size drift', () => {
    for (const step of [10, 25, 100]) {
      const round = createRound(applyTactic([{ kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 7000 }], 1))
      let view = push(round, { t: 0, db: -60, moo: false, hold: false })
      for (let t = step; t <= 4900; t += step) view = push(round, { t, db: -60, moo: false, hold: false })
      expect(round.pull).toBeCloseTo(-300)
      expect(view.bullPower).toBe(1.4)
      for (let t = 4900 + step; t <= 5400; t += step) push(round, { t, db: -60, moo: false, hold: false })
      expect(round.pull).toBeCloseTo(-1000)
    }
  })

  it('makes the hothead recovery more vulnerable without changing timing or air costs', () => {
    const stage = STAGES[3]
    const pattern = applyTactic([{ kind: 'inhale', ms: 8000 }], 3)
    const round = createRound(pattern, stage.rules)
    for (let t = 0; t <= 5400; t += 100) push(round, { t, db: -60, moo: false, hold: t > 4400 })
    expect(round.pull).toBeCloseTo(1518)
    expect(round.airMs).toBe(1100)
  })
})
