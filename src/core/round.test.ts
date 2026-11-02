import { describe, expect, it } from 'vitest'
import type { Segment } from './daily'
import { createRound, push, type Round, type Sample } from './round'
import { ROUND_MS } from './timing'

const room: Sample = { t: 0, db: -60, moo: false, f0: 0, hold: false }

function walk(round: Round, from: number, to: number, patch: Partial<Sample>): void {
  for (let t = from; t <= to; t += 100) {
    push(round, { ...room, ...patch, t })
  }
}

function ready(segments: Segment[]): Round {
  const round = createRound(segments)
  walk(round, 0, 400, { db: -60 })
  return round
}

describe('push', () => {
  const balanced: Segment[] = [
    { kind: 'voice', ms: 1000 },
    { kind: 'inhale', ms: 1000 },
    { kind: 'voice', ms: 1000 },
    { kind: 'inhale', ms: 5000 },
  ]

  it('scores an inhale in full and the bull voice at a third', () => {
    const round = ready(balanced)
    walk(round, 500, 2_300, { db: -10 })
    walk(round, 2_400, 4_400, { hold: true })
    const view = push(round, { ...room, t: 4_400, hold: true })
    expect(view.weightedMs).toBeCloseTo(1_350, 0)
    expect(view.mooMs).toBeCloseTo(2_000, 0)
  })

  it('lets a scream pull the bull closer and still write nothing', () => {
    const round = ready([{ kind: 'inhale', ms: 8000 }])
    walk(round, 500, 2_300, { db: -8 })
    const invited = push(round, { ...room, t: 2_300, db: -8 })
    expect(invited.phase).toBe('invite')
    expect(invited.shout).toBe('1')
    expect(invited.tug).toBe(0)
    expect(invited.line).toBe('')
    expect(invited.proximity).toBeGreaterThan(0.6)
    walk(round, 2_400, 4_000, { db: -8, moo: false })
    const yelled = push(round, { ...room, t: 4_000, db: -8 })
    expect(yelled.weightedMs).toBe(0)
    expect(yelled.screamMs).toBeGreaterThan(1_000)
    expect(yelled.phraseId).toBe('wait')
  })

  it('ignores a loud non-moo while the bull himself is mooing', () => {
    const round = ready([{ kind: 'voice', ms: 8000 }])
    walk(round, 2_400, 4_000, { db: -8, moo: false })
    const view = push(round, { ...room, t: 4_000, db: -8 })
    expect(view.screamMs).toBe(0)
    expect(view.weightedMs).toBe(0)
  })

  it('drags the rope toward a moo and toward the bull when you stay quiet', () => {
    const yours = ready([{ kind: 'inhale', ms: 8000 }])
    walk(yours, 2_400, 4_000, { hold: true })
    expect(push(yours, { ...room, t: 4_000, hold: true }).tug).toBeGreaterThan(0.3)

    const his = ready([{ kind: 'voice', ms: 8000 }])
    walk(his, 2_400, 4_000, { db: -60 })
    expect(push(his, { ...room, t: 4_000, db: -60 }).tug).toBeLessThan(-0.2)
  })

  it('closes the protocol at the end of the round', () => {
    const round = ready([{ kind: 'inhale', ms: 8000 }])
    walk(round, 2_400, ROUND_MS, { hold: true })
    const view = push(round, { ...room, t: ROUND_MS, hold: true })
    expect(view.phase).toBe('done')
    expect(view.pleased).toBe(true)
    expect(view.text.length).toBeGreaterThan(10)
    expect(view.waveform).toHaveLength(64)
  })
})
