import { describe, expect, it } from 'vitest'
import { breathAt, type Segment } from './daily'
import { STAGES } from './championship'
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
    expect(view.shout).toBe('Нокаут!')
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
    [-289, 'Раунд за Быничем.', false, true],
    [-288, 'Ничья.', false, false],
    [0, 'Ничья.', false, false],
    [288, 'Ничья.', false, false],
    [289, 'Луг за тобой.', true, false],
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


describe('championship air', () => {
  function champion(airMs = 1000, segments: Segment[] = [{ kind: 'inhale', ms: 8000 }]): Round {
    const round = createRound(segments, { airMs, recoveryRate: 2, recoverAt: 0.4, bullForce: 0.8 })
    walk(round, 0, 2400, {})
    return round
  }

  it('keeps daily rounds unlimited and starts championship air full after countdown', () => {
    expect(push(createRound([{ kind: 'voice', ms: 8000 }]), room).air).toBeNull()
    const round = champion()
    expect(push(round, { ...room, t: 2400 }).air).toBe(1)
    expect(push(round, { ...room, t: 2400 }).exhausted).toBe(false)
  })

  it('exhausts on continuous input and requires a real pause to recover', () => {
    const round = champion()
    walk(round, 2500, 3400, { hold: true })
    const empty = push(round, { ...room, t: 3400, hold: true })
    expect(empty.air).toBe(0)
    expect(empty.exhausted).toBe(true)
    expect(empty.youHot).toBe(false)
    walk(round, 3500, 4000, { hold: true })
    expect(push(round, { ...room, t: 4000, hold: true }).air).toBe(0)
    const early = push(round, { ...room, t: 4100 })
    expect(early.air).toBeCloseTo(0.2)
    expect(early.exhausted).toBe(true)
    const recovered = push(round, { ...room, t: 4200 })
    expect(recovered.air).toBeCloseTo(0.4)
    expect(recovered.exhausted).toBe(false)
    const resumed = push(round, { ...room, t: 4300, hold: true })
    expect(resumed.youHot).toBe(true)
    expect(resumed.air).toBeCloseTo(0.3)
  })

  it('counts only available air when depletion falls inside a frame', () => {
    const round = champion(250)
    walk(round, 2500, 2700, { hold: true })
    expect(round.pull).toBeCloseTo(308.7)
    expect(push(round, { ...room, t: 2700, hold: true }).air).toBe(0)
  })

  it('cannot refill by shouting a non-moo', () => {
    const round = champion()
    walk(round, 2500, 3400, { db: -8 })
    const view = push(round, { ...room, t: 3400, db: -8 })
    expect(view.air).toBe(0)
    expect(view.youHot).toBe(false)
    expect(round.pull).toBeCloseTo(-96)
    walk(round, 3500, 4000, { db: -8 })
    expect(push(round, { ...room, t: 4000, db: -8 }).air).toBe(0)
  })

  it('treats a recognized microphone moo and holding identically', () => {
    const mic = champion()
    const button = champion()
    walk(mic, 2500, 3000, { db: -20, moo: true })
    walk(button, 2500, 3000, { hold: true })
    expect(mic.pull).toBeCloseTo(button.pull)
    expect(push(mic, { ...room, t: 3000, db: -20, moo: true }).air).toBeCloseTo(0.4)
  })

  it('caps recovery and does not drain air during the countdown or a suspended frame', () => {
    const round = createRound([{ kind: 'inhale', ms: 8000 }], { airMs: 1000, recoveryRate: 2, recoverAt: 0.4, bullForce: 0.8 })
    walk(round, 0, 2300, { hold: true })
    expect(push(round, { ...room, t: 2300, hold: true }).air).toBe(1)
    expect(push(round, { ...room, t: 3000, hold: true }).air).toBe(1)
    walk(round, 3100, 3500, {})
    expect(push(round, { ...room, t: 3500 }).air).toBe(1)
  })

  it('is independent of frame partitioning through a breath boundary', () => {
    const results = [10, 25, 100].map(step => {
      const round = champion(750, [{ kind: 'voice', ms: 425 }, { kind: 'inhale', ms: 7575 }])
      for (let t = 2400 + step; t <= 4400; t += step) push(round, { ...room, t, hold: true })
      return { pull: round.pull, air: push(round, { ...room, t: 4400, hold: true }).air }
    })
    expect(results[0].air).toBe(0)
    for (const result of results) {
      expect(result.pull).toBeCloseTo(results[0].pull, 6)
      expect(result.air).toBe(0)
    }
  })

  it.each(STAGES.map((stage, index) => [index, stage] as const))('stage %i is winnable with a delayed rhythm; later stages defeat continuous input', (index, stage) => {
    function play(timed: boolean) {
      const round = createRound(stage.bull.segments, stage.rules)
      let view = push(round, room)
      for (let t = 10; t <= ROUND_MS; t += 10) {
        const hold = t >= 2400 && (!timed || t >= 2550 && breathAt(stage.bull.segments, t - 2550) === 'inhale')
        view = push(round, { ...room, t, hold })
        if (view.phase === 'done') break
      }
      return view
    }
    expect(play(true).tug).toBeGreaterThan(0.08)
    if (index >= 3) expect(play(false).tug).toBeLessThan(-0.08)
  })
})

describe('inhale animation timing', () => {
  const segments: Segment[] = [
    { kind: 'voice', ms: 1000 },
    { kind: 'inhale', ms: 1200 },
    { kind: 'voice', ms: 800 },
    { kind: 'inhale', ms: 5000 },
  ]

  it.each([
    [0, null], [2300, null], [2400, null], [3399, null],
    [3400, 0], [4000, 0.5], [4599, 1199 / 1200],
    [4600, null], [5399, null], [5400, 0], [7900, 0.5],
    [10399, 4999 / 5000], [10400, null],
  ])('reports inhale progress at %i ms without leaking into other phases', (t, expected) => {
    const round = createRound(segments)
    walk(round, 0, Math.floor(t / 100) * 100, {})
    const view = push(round, { ...room, t })
    if (expected === null) expect(view.inhale).toBeNull()
    else expect(view.inhale).toBeCloseTo(expected, 6)
  })

  it('does not animate a nonexistent inhale in an empty schedule', () => {
    const round = createRound([])
    expect(push(round, { ...room, t: 3000 }).inhale).toBeNull()
  })
})

describe('voice pressure and knockout', () => {
  it.each(['voice', 'inhale'] as const)('uses recognized moo loudness during %s without rewarding other loud sounds', kind => {
    const play = (db: number, moo: boolean) => {
      const round = ready([{ kind, ms: 8000 }])
      walk(round, 500, 2400, {})
      walk(round, 2500, 3000, { db, moo })
      return push(round, { ...room, t: 3000, db, moo })
    }
    const quiet = play(-60, false)
    const soft = play(-35, true)
    const normal = play(-20, true)
    const strong = play(-8, true)
    expect(soft.tug).toBeGreaterThan(quiet.tug)
    expect(normal.tug).toBeGreaterThan(soft.tug)
    expect(strong.tug).toBeGreaterThan(normal.tug)
    expect(play(0, true).tug).toBeCloseTo(strong.tug)
    expect(play(-8, false).tug).toBe(quiet.tug)
    expect(soft.youPower).toBeCloseTo(0.61)
    expect(normal.youPower).toBe(1)
    expect(strong.youPower).toBe(1.5)
    expect(quiet.youPower).toBe(0)
  })

  it('requires the extra voice gate while allowing a softer moo on an inhale', () => {
    for (const kind of ['voice', 'inhale'] as const) {
      const round = ready([{ kind, ms: 8000 }])
      walk(round, 500, 2400, {})
      const below = push(round, { ...room, t: 2500, db: -38, moo: true })
      expect(below.youHot).toBe(kind === 'inhale')
      const boundary = push(round, { ...room, t: 2600, db: -37, moo: true })
      expect(boundary.youHot).toBe(true)
      expect(boundary.youPower).toBeCloseTo(0.558)
    }
  })

  it.each([1, -1])('announces a knockout on side %i at the crossing, then freezes the result', side => {
    const round = createRound([{ kind: side > 0 ? 'inhale' : 'voice', ms: 8000 }])
    walk(round, 0, 2400, {})
    round.pull = side * (KO_PULL_MS - 12.3)
    const view = push(round, { ...room, t: 2500, hold: side > 0 })
    expect(view.finish).toBe('knockout')
    expect(view.phase).toBe('done')
    expect(view.shout).toBe('Нокаут!')
    expect(view.tug).toBe(side)
    expect(view.elapsed).toBeCloseTo(2400 + 12.3 / (side > 0 ? 1.23 : 1))
    expect(view.youPower).toBe(0)
    expect(view.bullPower).toBe(0)
    expect(push(round, { ...room, t: ROUND_MS, hold: true })).toEqual(view)
    const fresh = push(createRound(round.segments), room)
    expect(fresh.finish).toBeNull()
    expect(fresh.tug).toBe(0)
  })

  it('distinguishes a timed win from knockout and does not simulate force across a suspended frame', () => {
    const round = ready([{ kind: 'voice', ms: 8000 }])
    round.pull = 1000
    const view = push(round, { ...room, t: ROUND_MS, db: -8, moo: true })
    expect(view.finish).toBe('time')
    expect(view.shout).toBe('Луг за тобой.')
    expect(view.tug).toBeCloseTo(1000 / KO_PULL_MS)
    expect(view.elapsed).toBe(ROUND_MS)
  })

  it('uses bull loudness for both opposing pull and the visible voice level', () => {
    const results = [0.6, 0.9].map(bullForce => {
      const round = createRound([{ kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 7000 }], { airMs: 1000, recoveryRate: 2, recoverAt: 0.4, bullForce })
      walk(round, 0, 3000, {})
      const voice = push(round, { ...room, t: 3000 })
      walk(round, 3100, 3400, {})
      expect(push(round, { ...room, t: 3400 }).bullPower).toBe(0)
      return voice
    })
    expect(results[0].tug).toBeCloseTo(-360 / KO_PULL_MS)
    expect(results[1].tug).toBeCloseTo(-540 / KO_PULL_MS)
    expect(results.map(view => view.bullPower)).toEqual([0.6, 0.9])
  })

  it('keeps knockout timing identical when frames split across air depletion', () => {
    const results = [10, 25, 100].map(step => {
      const round = createRound([{ kind: 'voice', ms: 8000 }], { airMs: 125, recoveryRate: 2, recoverAt: 0.4, bullForce: 1 })
      walk(round, 0, 2400, {})
      round.pull = -KO_PULL_MS + 300
      let view = push(round, { ...room, t: 2400 })
      for (let t = 2400 + step; t <= 3400 && view.phase !== 'done'; t += step) view = push(round, { ...room, t, hold: true })
      expect(view.finish).toBe('knockout')
      expect(view.air).toBe(0)
      expect(view.elapsed).toBeCloseTo(2790, 6)
      return { tug: view.tug, air: view.air, finish: view.finish }
    })
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })

  it('stops air consumption at a knockout inside a frame', () => {
    const round = createRound([{ kind: 'inhale', ms: 8000 }], { airMs: 1000, recoveryRate: 2, recoverAt: 0.4, bullForce: 1 })
    walk(round, 0, 2400, {})
    round.pull = KO_PULL_MS - 12.3
    const view = push(round, { ...room, t: 2500, hold: true })
    expect(view.air).toBeCloseTo(0.99)
    expect(view.elapsed).toBeCloseTo(2410)
  })
})


describe('late championship knockout threat', () => {
  it.each([3, 4])('stage %i knocks out a silent player before time runs out', index => {
    const stage = STAGES[index]
    const round = createRound(stage.bull.segments, stage.rules)
    let view = push(round, room)
    for (let t = 10; t <= ROUND_MS && view.phase !== 'done'; t += 10) view = push(round, { ...room, t })
    expect(view.finish).toBe('knockout')
    expect(view.tug).toBe(-1)
    expect(view.elapsed).toBeLessThan(ROUND_MS)
  })
})

describe('remaining bull inhale time', () => {
  const segments: Segment[] = [{ kind: 'voice', ms: 1000 }, { kind: 'inhale', ms: 1200 }, { kind: 'voice', ms: 800 }, { kind: 'inhale', ms: 5000 }]

  it.each([[0, null], [2399, null], [2400, null], [3399, null], [3400, 1200], [4000, 600], [4599, 1], [4600, null], [5400, 5000], [10399, 1], [10400, null]] as const)('reports the real remaining window at %i ms', (t, expected) => {
    const round = createRound(segments)
    walk(round, 0, Math.floor(t / 100) * 100, {})
    const view = push(round, { ...room, t })
    expect(view.inhaleRemaining).toBe(expected)
  })

  it('has no pending inhale after knockout or for an empty schedule', () => {
    const round = ready([{ kind: 'inhale', ms: 8000 }])
    walk(round, 500, 2400, {})
    round.pull = KO_PULL_MS - 10
    expect(push(round, { ...room, t: 2500, hold: true }).inhaleRemaining).toBeNull()
    expect(push(createRound([]), { ...room, t: 3000 }).inhaleRemaining).toBeNull()
  })
})
