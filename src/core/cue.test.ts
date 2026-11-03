import { describe, expect, it } from 'vitest'
import { createRound, push, type Round, type Sample } from './round'
import { KO_PULL_MS } from './timing'

const quiet: Sample = { t: 0, db: -60, moo: false, hold: false }
const schedule = () => createRound([
  { kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 1200 },
  { kind: 'voice', ms: 800 }, { kind: 'inhale', ms: 5000 },
])

function at(round: Round, t: number) {
  for (let time = 0; time < t; time += 100) push(round, { ...quiet, t: time })
  return push(round, { ...quiet, t })
}

describe('player instructions', () => {
  it.each([0, 399, 400, 2000, 2399, 10400])('shows no playing window at %i ms', t => {
    expect(at(schedule(), t).cue).toBeNull()
  })

  it('changes from pause to preparation, moo and pause at exact breath boundaries', () => {
    const round = schedule()
    expect(at(round, 2999).shout).toBe('ПАУЗА')
    let view = push(round, { ...quiet, t: 3000 })
    expect(view.shout).toBe('Приготовься…')
    expect(view.cue).toEqual({ kind: 'ready', remaining: null, fraction: null })
    view = push(round, { ...quiet, t: 3400 })
    expect(view.shout).toBe('МЫЧИ')
    expect(view.cue).toEqual({ kind: 'moo', remaining: 1200, fraction: 1 })
    view = at(schedule(), 4000)
    expect(view.cue).toEqual({ kind: 'moo', remaining: 600, fraction: .5 })
    expect(at(schedule(), 4599).cue?.remaining).toBe(1)
    view = at(schedule(), 4600)
    expect(view.shout).toBe('ПАУЗА')
    expect(view.cue).toEqual({ kind: 'pause', remaining: null, fraction: null })
  })

  it('confirms only recognized input, including fallback holding', () => {
    const round = schedule()
    at(round, 3400)
    expect(push(round, { ...quiet, t: 3450, db: -8, moo: true }).shout).toBe('Держи!')
    expect(push(round, { ...quiet, t: 3500, db: -8 }).shout).toBe('МЫЧИ')
    expect(push(round, { ...quiet, t: 3550, moo: true }).shout).toBe('МЫЧИ')
    expect(push(round, { ...quiet, t: 3600, hold: true }).shout).toBe('Держи!')
  })

  it('bounds the instruction by actual remaining air and waits for recovery before resuming', () => {
    const round = createRound([{ kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 7000 }], { airMs: 600, recoveryRate: 1.5, recoverAt: .4, bullForce: .6 })
    expect(at(round, 3400).cue).toEqual({ kind: 'moo', remaining: 600, fraction: 1 })
    let view = push(round, { ...quiet, t: 3500, hold: true })
    expect(view.cue?.remaining).toBe(500)
    expect(view.cue?.fraction).toBeCloseTo(5 / 6)
    for (let t = 3600; t <= 4000; t += 100) view = push(round, { ...quiet, t, hold: true })
    expect(view.exhausted).toBe(true)
    expect(view.shout).toBe('ПАУЗА')
    expect(view.hint).toContain('воздух')
    expect(view.cue?.remaining).toBeNull()
    expect(push(round, { ...quiet, t: 4100 }).shout).toBe('ПАУЗА')
    view = push(round, { ...quiet, t: 4200 })
    expect(view.exhausted).toBe(false)
    expect(view.shout).toBe('МЫЧИ')
    expect(view.cue).toEqual({ kind: 'moo', remaining: 300, fraction: .5 })
  })

  it('does not advertise more time for a loud rejected vowel or an empty air budget', () => {
    const round = createRound([{ kind: 'inhale', ms: 8000 }], { airMs: 500, recoveryRate: 1, recoverAt: .4, bullForce: .6 })
    at(round, 2400)
    const view = push(round, { ...quiet, t: 2500, db: -8 })
    expect(view.shout).toBe('МЫЧИ')
    expect(view.cue?.remaining).toBe(400)
    round.airMs = 0
    expect(push(round, { ...quiet, t: 2500 }).cue?.kind).toBe('pause')
  })

  it('retains simultaneous pulling while recommending a pause', () => {
    const speaking = schedule(), silent = schedule()
    at(speaking, 2400); at(silent, 2400)
    const view = push(speaking, { ...quiet, t: 2500, hold: true })
    expect(view.cue?.kind).toBe('pause')
    expect(view.youHot && view.bullHot).toBe(true)
    expect(view.tug).toBeGreaterThan(push(silent, { ...quiet, t: 2500 }).tug)
  })

  it('gives no false preparation at the final voice and clears the cue after knockout', () => {
    const round = createRound([{ kind: 'inhale', ms: 7000 }, { kind: 'voice', ms: 1000 }])
    expect(at(round, 10399).cue?.kind).toBe('pause')
    const knockout = createRound([{ kind: 'inhale', ms: 8000 }])
    at(knockout, 2400)
    knockout.pull = KO_PULL_MS - 10
    const view = push(knockout, { ...quiet, t: 2500, hold: true })
    expect(view.finish).toBe('knockout')
    expect(view.cue).toBeNull()
    expect(view.shout).toBe('Нокаут!')
    expect(push(knockout, { ...quiet, t: 2600 }).cue).toBeNull()
    expect(at(createRound([]), 2500).cue?.kind).toBe('pause')
  })
})
