import { describe, expect, it } from 'vitest'
import { createRound, push, type Round, type Sample } from './round'
import { HUSH_MS, INVITE_MS, KO_PULL_MS } from './timing'

const start = HUSH_MS + INVITE_MS
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
  it.each([0, 399, 400, 2000, start - 1, start + 8000])('shows no playing window at %i ms', t => {
    expect(at(schedule(), t).cue).toBeNull()
  })

  it('changes from pause to preparation, moo and pause at exact breath boundaries', () => {
    const round = schedule()
    expect(at(round, start + 599).shout).toBe('ПАУЗА')
    let view = push(round, { ...quiet, t: start + 600 })
    expect(view.shout).toBe('ЖДИ')
    expect(view.cue).toEqual({ kind: 'ready', remaining: null, fraction: null })
    view = push(round, { ...quiet, t: start + 1000 })
    expect(view.shout).toBe('МЫЧИ')
    expect(view.cue).toEqual({ kind: 'moo', remaining: 1200, fraction: 1 })
    view = at(schedule(), start + 1600)
    expect(view.cue).toEqual({ kind: 'moo', remaining: 600, fraction: .5 })
    expect(at(schedule(), start + 2199).cue?.remaining).toBe(1)
    view = at(schedule(), start + 2200)
    expect(view.shout).toBe('ПАУЗА')
    expect(view.cue).toEqual({ kind: 'pause', remaining: null, fraction: null })
  })

  it('confirms only recognized input, including fallback holding', () => {
    const round = schedule()
    at(round, start + 1000)
    expect(push(round, { ...quiet, t: start + 1050, db: -8, moo: true }).shout).toBe('Держи!')
    expect(push(round, { ...quiet, t: start + 1100, db: -8 }).shout).toBe('МЫЧИ')
    expect(push(round, { ...quiet, t: start + 1150, moo: true }).shout).toBe('МЫЧИ')
    expect(push(round, { ...quiet, t: start + 1200, hold: true }).shout).toBe('Держи!')
  })

  it('bounds the instruction by actual remaining air and waits for recovery before resuming', () => {
    const round = createRound([{ kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 7000 }], { airMs: 600, recoveryRate: 1.5, recoverAt: .4, bullForce: .6 })
    expect(at(round, start + 1000).cue).toEqual({ kind: 'moo', remaining: 600, fraction: 1 })
    let view = push(round, { ...quiet, t: start + 1100, hold: true })
    expect(view.cue?.remaining).toBe(500)
    expect(view.cue?.fraction).toBeCloseTo(5 / 6)
    for (let t = start + 1200; t <= start + 1600; t += 100) view = push(round, { ...quiet, t, hold: true })
    expect(view.exhausted).toBe(true)
    expect(view.shout).toBe('ПАУЗА')
    expect(view.hint).toContain('воздух')
    expect(view.cue?.remaining).toBeNull()
    expect(push(round, { ...quiet, t: start + 1700 }).shout).toBe('ПАУЗА')
    view = push(round, { ...quiet, t: start + 1800 })
    expect(view.exhausted).toBe(false)
    expect(view.shout).toBe('МЫЧИ')
    expect(view.cue).toEqual({ kind: 'moo', remaining: 300, fraction: .5 })
  })

  it('does not advertise more time for a loud rejected vowel or an empty air budget', () => {
    const round = createRound([{ kind: 'inhale', ms: 8000 }], { airMs: 500, recoveryRate: 1, recoverAt: .4, bullForce: .6 })
    at(round, start)
    const view = push(round, { ...quiet, t: start + 100, db: -8 })
    expect(view.shout).toBe('МЫЧИ')
    expect(view.cue?.remaining).toBe(400)
    round.airMs = 0
    expect(push(round, { ...quiet, t: start + 100 }).cue?.kind).toBe('pause')
  })

  it('retains simultaneous pulling while recommending a pause', () => {
    const speaking = schedule(), silent = schedule()
    at(speaking, start); at(silent, start)
    const view = push(speaking, { ...quiet, t: start + 100, hold: true })
    expect(view.cue?.kind).toBe('pause')
    expect(view.youHot && view.bullHot).toBe(true)
    expect(view.tug).toBeGreaterThan(push(silent, { ...quiet, t: start + 100 }).tug)
  })

  it('gives no false preparation at the final voice and clears the cue after knockout', () => {
    const round = createRound([{ kind: 'inhale', ms: 7000 }, { kind: 'voice', ms: 1000 }])
    expect(at(round, start + 7999).cue?.kind).toBe('pause')
    const knockout = createRound([{ kind: 'inhale', ms: 8000 }])
    at(knockout, start)
    knockout.pull = KO_PULL_MS - 10
    const view = push(knockout, { ...quiet, t: start + 100, hold: true })
    expect(view.finish).toBe('knockout')
    expect(view.cue).toBeNull()
    expect(view.shout).toBe('Нокаут!')
    expect(push(knockout, { ...quiet, t: start + 200 }).cue).toBeNull()
    expect(at(createRound([]), start + 100).cue?.kind).toBe('pause')
  })
})
