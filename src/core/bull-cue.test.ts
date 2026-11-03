import { describe, expect, it } from 'vitest'
import { createRound, push, type Round } from './round'
import { HUSH_MS, INVITE_MS, KO_PULL_MS, ROUND_MS } from './timing'

const start = HUSH_MS + INVITE_MS
const quiet = { db: -60, moo: false, hold: false }
const schedule = [{ kind: 'inhale', ms: 1200 }, { kind: 'voice', ms: 800 }, { kind: 'inhale', ms: 6000 }] as const

function at(round: Round, t: number) {
  for (let time = 0; time < t; time += 100) push(round, { ...quiet, t: time })
  return push(round, { ...quiet, t })
}

describe('bull anticipation', () => {
  it.each([0, start - 1, ROUND_MS])('has no attack indicator outside the fight at %i', t => {
    expect(at(createRound([...schedule]), t).bullCue).toBeNull()
  })

  it('fills the inhale until the exact audible attack and resets after the voice', () => {
    const round = createRound([...schedule])
    expect(at(round, start).bullCue).toEqual({ kind: 'inhale', remaining: 1200, fraction: 0 })
    expect(at(createRound([...schedule]), start + 600).bullCue).toEqual({ kind: 'inhale', remaining: 600, fraction: .5 })
    const last = at(createRound([...schedule]), start + 1199).bullCue
    expect(last?.remaining).toBe(1)
    expect(last?.fraction).toBeCloseTo(1199 / 1200)
    expect(at(createRound([...schedule]), start + 1200).bullCue).toEqual({ kind: 'voice', remaining: 800, fraction: 1 })
    expect(at(createRound([...schedule]), start + 1999).bullCue?.kind).toBe('voice')
    expect(at(createRound([...schedule]), start + 2000).bullCue).toEqual({ kind: 'rest', remaining: 0, fraction: 0 })
  })

  it('keeps the enemy deadline independent of player air and exhaustion', () => {
    const round = createRound([...schedule], { airMs: 300, recoveryRate: 1, recoverAt: .4, bullForce: .6 })
    at(round, start)
    for (let t = start + 100; t <= start + 400; t += 100) push(round, { ...quiet, hold: true, t })
    const view = push(round, { ...quiet, hold: true, t: start + 500 })
    expect(view.exhausted).toBe(true)
    expect(view.cue?.kind).toBe('pause')
    expect(view.bullCue?.remaining).toBe(700)
    expect(view.bullCue?.fraction).toBeCloseTo(500 / 1200)
  })

  it('shows an opening voice immediately and clears on knockout and empty schedules', () => {
    const round = createRound([{ kind: 'voice', ms: 8000 }])
    expect(at(round, start).bullCue).toEqual({ kind: 'voice', remaining: 8000, fraction: 1 })
    round.pull = -KO_PULL_MS + 1
    expect(push(round, { ...quiet, t: start + 100 }).bullCue).toBeNull()
    expect(at(createRound([]), start).bullCue).toBeNull()
  })
})
