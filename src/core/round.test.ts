import { describe, expect, it } from 'vitest'
import type { Segment } from './daily'
import { createRound, push, type Round, type Sample } from './round'
import { KO_PULL_MS, ROUND_MS } from './timing'

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
    expect(push(inhale, { ...room, t: 4_000, hold: true }).shout).toBe('Тяни му-у-у!')
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
    expect(view.shout).toBe('Луг за тобой.')
  })
})


describe('championship copy', () => {
  it.each([
    [0, 'hush', '3'],
    [799, 'invite', '3'],
    [800, 'invite', '2'],
    [1599, 'invite', '2'],
    [1600, 'invite', '1'],
    [2399, 'invite', '1'],
  ])('keeps the countdown at %i ms clear', (t, phase, shout) => {
    const view = push(createRound([{ kind: 'inhale', ms: 8000 }]), { ...room, t })
    expect(view.phase).toBe(phase)
    expect(view.shout).toBe(shout)
    expect(view.hint).toBe('Тихо. Мычим после сигнала.')
  })

  it('changes the cue as the bull moves from voice to inhale', () => {
    const round = ready([{ kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 7000 }])
    walk(round, 500, 3300, {})
    const voice = push(round, { ...room, t: 3399 })
    expect(voice.shout).toBe('Бынич тянет.')
    expect(voice.hint).toBe('Лови его вдох — тогда твоё мычание сильнее.')
    const inhale = push(round, { ...room, t: 3400, hold: true })
    expect(inhale.shout).toBe('Тяни му-у-у!')
    expect(inhale.hint).toBe('Он на вдохе. Твой выход!')
  })

  it.each([
    [-KO_PULL_MS, 'Раунд за Быничем.', false, true],
    [-353, 'Раунд за Быничем.', false, true],
    [-352, 'Ничья.', false, false],
    [0, 'Ничья.', false, false],
    [352, 'Ничья.', false, false],
    [353, 'Луг за тобой.', true, false],
    [KO_PULL_MS, 'Луг за тобой.', true, false],
  ])('announces the result at pull %i consistently with the fighters', (pull, shout, pleased, puzzled) => {
    const round = ready([{ kind: 'inhale', ms: 8000 }])
    round.pull = pull
    const view = push(round, { ...room, t: ROUND_MS })
    expect(view.phase).toBe('done')
    expect(view.shout).toBe(shout)
    expect(view.pleased).toBe(pleased)
    expect(view.puzzled).toBe(puzzled)
    expect(view.hint).toBe(pleased
      ? 'Бынич просит реванш.'
      : puzzled
        ? 'Его вдох — твой шанс. Попробуем ещё?'
        : 'Никто не уступил. Ещё раунд?')
    expect(push(round, { ...room, t: ROUND_MS + 100, hold: true })).toEqual(view)
  })
})
