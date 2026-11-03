import { describe, expect, it } from 'vitest'
import type { Segment } from './daily'
import { createRound, push, type Round, type Sample } from './round'
import { ROUND_MS } from './timing'

const room: Sample = { t: 0, db: -60, moo: false, hold: false }

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
  it('gives an inhale more rope than a moo over his voice', () => {
    const inhale = ready([{ kind: 'inhale', ms: 8000 }])
    walk(inhale, 2_400, 4_000, { hold: true })
    const over = ready([{ kind: 'voice', ms: 8000 }])
    walk(over, 2_400, 4_000, { hold: true })
    const inhaleTug = push(inhale, { ...room, t: 4_000, hold: true }).tug
    const overTug = push(over, { ...room, t: 4_000, hold: true }).tug
    expect(inhaleTug).toBeGreaterThan(0.3)
    expect(overTug).toBeLessThan(0)
    expect(inhaleTug).toBeGreaterThan(overTug)
  })

  it('lets a scream during the invite leave the rope where it was', () => {
    const round = ready([{ kind: 'inhale', ms: 8000 }])
    walk(round, 500, 2_300, { db: -8 })
    const invited = push(round, { ...room, t: 2_300, db: -8 })
    expect(invited.phase).toBe('invite')
    expect(invited.shout).toBe('1')
    expect(invited.tug).toBe(0)
    expect(invited.proximity).toBeGreaterThan(0.6)
    walk(round, 2_400, 4_000, { db: -8, moo: false })
    const yelled = push(round, { ...room, t: 4_000, db: -8 })
    expect(yelled.tug).toBeGreaterThan(-0.15)
    expect(yelled.tug).toBeLessThan(0.05)
  })

  it('ignores a loud non-moo while the bull himself is mooing', () => {
    const yelled = ready([{ kind: 'voice', ms: 8000 }])
    walk(yelled, 2_400, 4_000, { db: -8, moo: false })
    const quiet = ready([{ kind: 'voice', ms: 8000 }])
    walk(quiet, 2_400, 4_000, { db: -60 })
    const yelledTug = push(yelled, { ...room, t: 4_000, db: -8 }).tug
    const quietTug = push(quiet, { ...room, t: 4_000, db: -60 }).tug
    expect(yelledTug).toBeCloseTo(quietTug, 2)
    expect(yelledTug).toBeLessThan(0)
  })

  it('drags the rope toward a moo and toward the bull when you stay quiet', () => {
    const yours = ready([{ kind: 'inhale', ms: 8000 }])
    walk(yours, 2_400, 4_000, { hold: true })
    expect(push(yours, { ...room, t: 4_000, hold: true }).tug).toBeGreaterThan(0.3)

    const his = ready([{ kind: 'voice', ms: 8000 }])
    walk(his, 2_400, 4_000, { db: -60 })
    expect(push(his, { ...room, t: 4_000, db: -60 }).tug).toBeLessThan(-0.2)
  })

  it('ends the round when the inhale moo reaches the far edge', () => {
    const round = ready([{ kind: 'inhale', ms: 8000 }])
    walk(round, 2_400, ROUND_MS, { hold: true })
    const view = push(round, { ...room, t: ROUND_MS, hold: true })
    expect(view.phase).toBe('done')
    expect(view.pleased).toBe(true)
    expect(view.shout).toBe('Ко')
  })
})
