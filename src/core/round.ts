import { breathAt, segmentEndOffset, type Segment } from './daily'
import {
  HUSH_MS,
  INHALE_BULL,
  INHALE_PLAYER,
  INVITE_MS,
  KO_PULL_MS,
  ROUND_MS,
  VOICE_BULL,
  VOICE_GATE_DB,
  VOICE_PLAYER,
} from './timing'

const LISTEN_START = HUSH_MS + INVITE_MS
const LOUD_MARGIN_DB = 12
const MIN_LOUD_DB = -45
const MAX_LOUD_DB = -14
const MAX_STEP_MS = 250

export interface Sample {
  t: number
  db: number
  moo: boolean
  hold: boolean
}

export interface View {
  phase: 'hush' | 'invite' | 'listen' | 'done'
  breath: 'hush' | 'bait' | 'voice' | 'inhale'
  shout: string
  youHot: boolean
  bullHot: boolean
  hint: string
  /** −1 бык забрал канат, +1 забрал игрок */
  tug: number
  elapsed: number
  proximity: number
  cheeks: number
  pleased: boolean
  puzzled: boolean
}

export interface Round {
  segments: Segment[]
  ambient: number[]
  threshold: number
  calibrated: boolean
  lastT: number
  proximity: number
  pull: number
  youHot: boolean
  bullHot: boolean
  finished: boolean
}

export function createRound(segments: Segment[]): Round {
  return {
    segments,
    ambient: [],
    threshold: -36,
    calibrated: false,
    lastT: 0,
    proximity: 0.12,
    pull: 0,
    youHot: false,
    bullHot: false,
    finished: false,
  }
}

export function push(round: Round, sample: Sample): View {
  if (round.finished) return viewOf(round, ROUND_MS)
  const from = round.lastT
  const to = Math.max(from, sample.t)
  if (to - from > MAX_STEP_MS) {
    round.lastT = to
    if (to >= ROUND_MS) round.finished = true
    touchFaces(round, sample)
    return viewOf(round, to)
  }

  if (from < HUSH_MS && !sample.hold) {
    const overlap = Math.min(to, HUSH_MS) - from
    if (overlap > 0) round.ambient.push(sample.db)
  }
  if (!round.calibrated && to >= HUSH_MS) {
    round.threshold = clamp(median(round.ambient) + LOUD_MARGIN_DB, MIN_LOUD_DB, MAX_LOUD_DB)
    round.calibrated = true
  }

  const dt = to - from
  if (sample.t >= HUSH_MS && sample.t < LISTEN_START) {
    const pulling = sample.hold || sample.db >= round.threshold
    round.proximity = damp(round.proximity, pulling ? 1 : 0.12, dt)
  } else if (sample.t >= LISTEN_START) {
    round.proximity = damp(round.proximity, 0.18, dt)
  }

  let cursor = Math.max(from, LISTEN_START)
  const end = Math.min(to, ROUND_MS)
  while (cursor < end) {
    const offset = cursor - LISTEN_START
    const kind = breathAt(round.segments, offset)
    const segEnd = LISTEN_START + segmentEndOffset(round.segments, offset)
    const sliceEnd = Math.min(end, segEnd)
    const slice = sliceEnd - cursor
    if (slice <= 0) break
    const loud = sample.db >= round.threshold
    const gated = sample.db >= round.threshold + VOICE_GATE_DB
    const counts = sample.hold || (kind === 'inhale' ? sample.moo && loud : sample.moo && gated)
    const player = counts ? (kind === 'inhale' ? INHALE_PLAYER : VOICE_PLAYER) : 0
    const bull = kind === 'inhale' ? INHALE_BULL : VOICE_BULL
    round.pull += (player - bull) * slice
    cursor = sliceEnd
    if (round.pull >= KO_PULL_MS || round.pull <= -KO_PULL_MS) {
      round.pull = clamp(round.pull, -KO_PULL_MS, KO_PULL_MS)
      round.finished = true
      break
    }
  }

  round.lastT = to
  if (to >= ROUND_MS) round.finished = true
  touchFaces(round, sample)
  return viewOf(round, to)
}

function viewOf(round: Round, t: number): View {
  const phase = round.finished ? 'done' : phaseOf(t)
  const breath = breathOf(round, phase, t)
  const done = phase === 'done'
  const yours = round.pull > 80
  return {
    phase,
    breath,
    shout: shoutOf(phase, breath, t),
    youHot: round.youHot,
    bullHot: round.bullHot,
    hint: hintOf(phase, breath),
    proximity: round.proximity,
    cheeks: cheeksOf(phase, breath, round.proximity),
    pleased: done && yours,
    puzzled: done && round.pull < -80,
    tug: clamp(round.pull / KO_PULL_MS, -1, 1),
    elapsed: Math.min(Math.max(t, 0), ROUND_MS),
  }
}

function phaseOf(t: number): View['phase'] {
  if (t >= ROUND_MS) return 'done'
  if (t < HUSH_MS) return 'hush'
  if (t < LISTEN_START) return 'invite'
  return 'listen'
}

function breathOf(round: Round, phase: View['phase'], t: number): View['breath'] {
  if (phase === 'hush') return 'hush'
  if (phase === 'invite') return 'bait'
  if (phase === 'listen') return breathAt(round.segments, t - LISTEN_START)
  return 'inhale'
}

function shoutOf(phase: View['phase'], breath: View['breath'], t: number): string {
  if (phase === 'hush' || phase === 'invite') {
    if (t < 800) return '3'
    if (t < 1600) return '2'
    return '1'
  }
  if (phase === 'listen' && breath === 'inhale') return 'Мычи: мууу'
  if (phase === 'listen') return 'Бынич'
  return 'Ко'
}

function hintOf(phase: View['phase'], breath: View['breath']): string {
  if (phase === 'hush' || phase === 'invite') return 'Тихо до сигнала.'
  if (phase === 'listen' && breath === 'inhale') return 'Он набирает воздух.'
  if (phase === 'listen') return 'Шкала идёт к нему.'
  return 'Можно ещё раз.'
}

function touchFaces(round: Round, sample: Sample): void {
  if (round.finished) {
    round.youHot = false
    round.bullHot = false
    return
  }
  const loud = sample.hold || sample.db >= round.threshold
  if (sample.t < LISTEN_START) {
    round.youHot = sample.t >= HUSH_MS && loud
    round.bullHot = false
    return
  }
  const kind = breathAt(round.segments, sample.t - LISTEN_START)
  const gated = sample.db >= round.threshold + VOICE_GATE_DB
  const counts = sample.hold || (kind === 'inhale' ? sample.moo && loud : sample.moo && gated)
  round.youHot = counts
  round.bullHot = kind === 'voice'
}

function cheeksOf(phase: View['phase'], breath: View['breath'], proximity: number): number {
  if (phase === 'invite') return 0.25 + proximity * 0.75
  if (phase === 'listen' && breath === 'voice') return 0.95
  if (phase === 'listen') return 0.2
  if (phase === 'done') return 0.55
  return 0.25
}

function median(values: number[]): number {
  if (values.length === 0) return -50
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function damp(current: number, target: number, dt: number): number {
  const k = 1 - Math.exp(-dt / 140)
  return current + (target - current) * k
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}
