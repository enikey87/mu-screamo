import { breathAt, segmentEndOffset, type Segment } from './daily'
import { PHRASES, revealedLine, selectPhrase, type Score } from './phrases'
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
  VOICE_WEIGHT,
} from './timing'

const LISTEN_START = HUSH_MS + INVITE_MS
const LOUD_MARGIN_DB = 12
const MIN_LOUD_DB = -45
const MAX_LOUD_DB = -14
const HOLD_F0 = 110
const MAX_STEP_MS = 250

export interface Sample {
  t: number
  db: number
  moo: boolean
  f0: number
  hold: boolean
}

export interface View {
  phase: 'hush' | 'invite' | 'listen' | 'done'
  breath: 'hush' | 'bait' | 'voice' | 'inhale'
  shout: string
  hint: string
  line: string
  /** −1 бык забрал канат, +1 забрал игрок */
  tug: number
  elapsed: number
  phraseId: string
  stamp: string
  text: string
  proximity: number
  cheeks: number
  pleased: boolean
  puzzled: boolean
  mooMs: number
  weightedMs: number
  screamMs: number
  stability: number
  meter: number
  waveform: number[]
}

export interface Round {
  segments: Segment[]
  ambient: number[]
  threshold: number
  calibrated: boolean
  lastT: number
  mooMs: number
  screamMs: number
  weightedMs: number
  pitches: number[]
  wave: number[]
  proximity: number
  lastDb: number
  pull: number
  finished: boolean
}

export function createRound(segments: Segment[]): Round {
  return {
    segments,
    ambient: [],
    threshold: -36,
    calibrated: false,
    lastT: 0,
    mooMs: 0,
    screamMs: 0,
    weightedMs: 0,
    pitches: [],
    wave: [],
    proximity: 0.12,
    lastDb: -90,
    pull: 0,
    finished: false,
  }
}

export function push(round: Round, sample: Sample): View {
  if (round.finished) return viewOf(round, ROUND_MS)
  round.lastDb = sample.db
  const from = round.lastT
  const to = Math.max(from, sample.t)
  if (to - from > MAX_STEP_MS) {
    round.lastT = to
    if (to >= ROUND_MS) round.finished = true
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
    if (counts) {
      round.weightedMs += slice * (kind === 'inhale' ? 1 : VOICE_WEIGHT)
      round.mooMs += slice
      round.pitches.push(sample.hold ? HOLD_F0 : sample.f0)
    } else if (kind === 'inhale' && loud) {
      round.screamMs += slice
    }
    const player = counts ? (kind === 'inhale' ? INHALE_PLAYER : VOICE_PLAYER) : 0
    const bull = kind === 'inhale' ? INHALE_BULL : VOICE_BULL
    round.pull += (player - bull) * slice
    round.wave.push(meterOf(sample.db, round.threshold))
    cursor = sliceEnd
    if (round.pull >= KO_PULL_MS || round.pull <= -KO_PULL_MS) {
      round.pull = clamp(round.pull, -KO_PULL_MS, KO_PULL_MS)
      round.finished = true
      break
    }
  }

  round.lastT = to
  if (to >= ROUND_MS) round.finished = true
  return viewOf(round, to)
}

function viewOf(round: Round, t: number): View {
  const phase = round.finished ? 'done' : phaseOf(t)
  const score = scoreOf(round)
  const phrase = selectPhrase(score)
  const breath = breathOf(round, phase, t)
  const done = phase === 'done'
  const index = Math.max(0, PHRASES.findIndex((item) => item.id === phrase.id))
  const yours = round.pull > 80
  return {
    phase,
    breath,
    shout: shoutOf(phase, breath, yours),
    hint: hintOf(phase, breath),
    line: phase === 'hush' || phase === 'invite' ? '' : revealedLine(score, done),
    phraseId: phrase.id,
    stamp: phrase.stamp,
    text: phrase.text,
    proximity: round.proximity,
    cheeks: cheeksOf(phase, breath, round.proximity, index),
    pleased: done && yours,
    puzzled: done && round.pull < -80,
    tug: clamp(round.pull / KO_PULL_MS, -1, 1),
    elapsed: Math.min(Math.max(t, 0), ROUND_MS),
    mooMs: round.mooMs,
    weightedMs: round.weightedMs,
    screamMs: round.screamMs,
    stability: score.stability,
    meter: meterOf(round.lastDb, round.threshold),
    waveform: downsample(round.wave, 64),
  }
}

function scoreOf(round: Round): Score {
  return {
    weightedMs: round.weightedMs,
    mooMs: round.mooMs,
    screamMs: round.screamMs,
    stability: stabilityOf(round.pitches),
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

function shoutOf(phase: View['phase'], breath: View['breath'], yours: boolean): string {
  if (phase === 'hush') return 'Тихо'
  if (phase === 'invite') return 'Ори'
  if (phase === 'listen' && breath === 'inhale') return 'Муу'
  if (phase === 'listen') return 'Держись'
  return yours ? 'Забрал' : 'Его'
}

function hintOf(phase: View['phase'], breath: View['breath']): string {
  if (phase === 'hush') return 'Комната запоминается.'
  if (phase === 'invite') return 'Канат от крика не едет.'
  if (phase === 'listen' && breath === 'inhale') return 'Его вдох. Тяни.'
  if (phase === 'listen') return 'Он тянет своё.'
  return 'Протокол готов.'
}

function cheeksOf(phase: View['phase'], breath: View['breath'], proximity: number, index: number): number {
  if (phase === 'invite') return 0.25 + proximity * 0.75
  if (phase === 'listen' && breath === 'voice') return 0.95
  if (phase === 'listen') return 0.2
  if (phase === 'done') return index >= 6 ? 0.7 : 0.35
  return 0.25
}

function stabilityOf(pitches: number[]): number {
  const usable = pitches.filter((p) => p > 0)
  if (usable.length < 4) return 0
  const mean = usable.reduce((acc, p) => acc + p, 0) / usable.length
  let variance = 0
  for (const p of usable) {
    const d = p - mean
    variance += d * d
  }
  const cv = Math.sqrt(variance / usable.length) / mean
  return clamp01(1 - cv / 0.12)
}

function meterOf(db: number, threshold: number): number {
  return clamp01((db - (threshold - 8)) / 24)
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

function downsample(values: number[], n: number): number[] {
  if (values.length === 0) return Array.from({ length: n }, () => 0)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * values.length) / n)
    const b = Math.max(a + 1, Math.floor(((i + 1) * values.length) / n))
    let peak = 0
    for (let k = a; k < b && k < values.length; k++) peak = Math.max(peak, values[k])
    out.push(peak)
  }
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}
