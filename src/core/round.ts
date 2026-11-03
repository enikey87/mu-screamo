import { playerPower } from './voice-power'
import { breathAt, segmentEndOffset, type Segment } from './daily'
import {
  COUNT_AT_MS,
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

export interface RoundRules {
  airMs: number
  recoveryRate: number
  recoverAt: number
  bullForce: number
}

export interface View {
  phase: 'hush' | 'invite' | 'listen' | 'done'
  finish: 'knockout' | 'time' | null
  breath: 'hush' | 'bait' | 'voice' | 'inhale'
  shout: string
  youHot: boolean
  bullHot: boolean
  youPower: number
  bullPower: number
  hint: string
  /** −1 бык забрал канат, +1 забрал игрок */
  tug: number
  elapsed: number
  proximity: number
  cheeks: number
  pleased: boolean
  puzzled: boolean
  air: number | null
  exhausted: boolean
  inhale: number | null
  inhaleRemaining: number | null
  bullCue: { kind: 'inhale' | 'voice' | 'rest'; remaining: number; fraction: number } | null
  cue: { kind: 'ready' | 'moo' | 'pause'; remaining: number | null; fraction: number | null } | null
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
  youPower: number
  bullPower: number
  finished: boolean
  finish: View['finish']
  rules: RoundRules | null
  airMs: number
  exhausted: boolean
}

export function createRound(segments: Segment[], rules?: RoundRules): Round {
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
    youPower: 0,
    bullPower: 0,
    finished: false,
    finish: null,
    rules: rules ?? null,
    airMs: rules?.airMs ?? 0,
    exhausted: false,
  }
}

export function push(round: Round, sample: Sample): View {
  if (round.finished) return viewOf(round, round.lastT)
  const from = round.lastT
  const to = Math.max(from, sample.t)
  if (to - from > MAX_STEP_MS) {
    round.lastT = Math.min(to, ROUND_MS)
    if (to >= ROUND_MS) { round.finished = true; round.finish = 'time' }
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
    let slice = sliceEnd - cursor
    if (slice <= 0) break
    const loud = sample.db >= round.threshold
    const gated = sample.db >= round.threshold + VOICE_GATE_DB
    const counts = sample.hold || (kind === 'inhale' ? sample.moo && loud : sample.moo && gated)
    const speaking = sample.hold || loud
    if (round.rules && speaking && !round.exhausted) slice = Math.min(slice, round.airMs)
    const power = sample.hold ? 1 : playerPower(sample.db, round.threshold)
    const player = counts && !round.exhausted ? power * (kind === 'inhale' ? INHALE_PLAYER : VOICE_PLAYER) : 0
    const bull = (kind === 'inhale' ? INHALE_BULL : VOICE_BULL) * (round.rules?.bullForce ?? 1)
    const velocity = player - bull
    const crossingMs = velocity > 0 ? (KO_PULL_MS - round.pull) / velocity
      : velocity < 0 ? (-KO_PULL_MS - round.pull) / velocity : Infinity
    const knockout = crossingMs >= 0 && crossingMs <= slice
    if (knockout) slice = crossingMs
    const activeMs = useAir(round, speaking, slice)
    round.pull += player * activeMs - bull * slice
    cursor += slice
    if (knockout) {
      round.pull = velocity > 0 ? KO_PULL_MS : -KO_PULL_MS
      round.finished = true
      round.finish = 'knockout'
      break
    }
  }

  round.lastT = round.finished ? cursor : Math.min(to, ROUND_MS)
  if (!round.finished && to >= ROUND_MS) { round.finished = true; round.finish = 'time' }
  touchFaces(round, sample)
  return viewOf(round, round.lastT)
}

function useAir(round: Round, speaking: boolean, ms: number): number {
  const rules = round.rules
  if (!rules) return ms
  if (!speaking) {
    round.airMs = Math.min(rules.airMs, round.airMs + ms * rules.recoveryRate)
    if (round.airMs >= rules.airMs * rules.recoverAt) round.exhausted = false
    return 0
  }
  if (round.exhausted) return 0
  const activeMs = Math.min(ms, round.airMs)
  round.airMs = Math.max(0, round.airMs - ms)
  if (round.airMs === 0) round.exhausted = true
  return activeMs
}

function viewOf(round: Round, t: number): View {
  const phase = round.finished ? 'done' : phaseOf(t)
  const breath = breathOf(round, phase, t)
  const done = phase === 'done'
  const tug = clamp(round.pull / KO_PULL_MS, -1, 1)
  const yours = tug > 0.08
  const his = tug < -0.08
  const recovering = phase === 'listen' && round.exhausted
  const window = phase === 'listen' ? windowAt(round.segments, t - LISTEN_START) : null
  const inhale = window?.kind === 'inhale' ? window : null
  const cue = phase === 'listen' ? cueOf(round, window) : null
  const instruction = cue?.kind === 'moo' ? round.youHot ? 'Держи!' : 'МЫЧИ' : cue?.kind === 'ready' ? 'Приготовься…' : 'ПАУЗА'
  return {
    phase,
    finish: round.finish,
    breath,
    shout: round.finish === 'knockout' ? 'Нокаут!' : done ? (yours ? 'Луг за тобой.' : his ? 'Раунд за Быничем.' : 'Ничья.') : cue ? instruction : countdownAt(t),
    youHot: round.youHot,
    bullHot: round.bullHot,
    youPower: round.youPower,
    bullPower: round.bullPower,
    hint: done
      ? yours ? 'Бынич просит реванш.' : his ? 'Его вдох — твой шанс. Попробуем ещё?' : 'Никто не уступил. Ещё раунд?'
      : recovering ? 'Набери воздух — помолчи до восстановления.'
        : cue?.kind === 'moo' ? 'Продолжай «му-у-у» до конца полоски.'
          : cue?.kind === 'ready' ? 'Скоро твой выход. Жди сигнала.'
            : cue ? 'Сейчас Бынич. Набери воздух.' : 'Тихо. Мычим после сигнала.',
    proximity: round.proximity,
    cheeks: cheeksOf(phase, breath, round.proximity),
    pleased: done && yours,
    puzzled: done && his,
    tug,
    air: round.rules ? clamp(round.airMs / round.rules.airMs, 0, 1) : null,
    exhausted: round.exhausted,
    inhale: inhale?.progress ?? null,
    inhaleRemaining: inhale?.remaining ?? null,
    cue,
    bullCue: window ? window.kind === 'voice'
      ? { kind: 'voice', remaining: window.remaining, fraction: 1 }
      : window.next === 'voice' ? { kind: 'inhale', remaining: window.remaining, fraction: window.progress }
        : { kind: 'rest', remaining: 0, fraction: 0 } : null,
    elapsed: Math.min(Math.max(t, 0), ROUND_MS),
  }
}

function windowAt(segments: Segment[], t: number): { kind: Segment['kind']; progress: number; remaining: number; duration: number; next: Segment['kind'] | null } | null {
  let start = 0
  for (const [index, segment] of segments.entries()) {
    if (t < start + segment.ms) return { kind: segment.kind, progress: clamp((t - start) / segment.ms, 0, 1), remaining: start + segment.ms - t, duration: segment.ms, next: segments[index + 1]?.kind ?? null }
    start += segment.ms
  }
  return null
}

function cueOf(round: Round, window: ReturnType<typeof windowAt>): View['cue'] {
  const pause = { kind: 'pause', remaining: null, fraction: null } as const
  if (round.exhausted || !window) return pause
  if (window.kind === 'inhale') {
    const remaining = Math.min(window.remaining, round.rules ? round.airMs : Infinity)
    if (remaining <= 0) return pause
    const duration = Math.min(window.duration, round.rules?.airMs ?? Infinity)
    return { kind: 'moo', remaining, fraction: clamp(remaining / duration, 0, 1) }
  }
  return window.next === 'inhale' && window.remaining <= 400
    ? { kind: 'ready', remaining: null, fraction: null } : pause
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

function countdownAt(t: number): string {
  if (t < HUSH_MS) return 'Тише…'
  if (t < COUNT_AT_MS[1]) return '4'
  if (t < COUNT_AT_MS[2]) return '3'
  if (t < COUNT_AT_MS[3]) return '2'
  return '1'
}

function touchFaces(round: Round, sample: Sample): void {
  if (round.finished) {
    round.youHot = false
    round.bullHot = false
    round.youPower = 0
    round.bullPower = 0
    return
  }
  const loud = sample.hold || sample.db >= round.threshold
  if (sample.t < LISTEN_START) {
    round.youHot = sample.t >= HUSH_MS && loud
    round.bullHot = false
    round.youPower = round.youHot ? (sample.hold ? 1 : playerPower(sample.db, round.threshold)) : 0
    round.bullPower = 0
    return
  }
  const kind = breathAt(round.segments, sample.t - LISTEN_START)
  const gated = sample.db >= round.threshold + VOICE_GATE_DB
  const counts = sample.hold || (kind === 'inhale' ? sample.moo && loud : sample.moo && gated)
  round.youHot = counts && !round.exhausted
  round.bullHot = kind === 'voice'
  round.youPower = round.youHot ? (sample.hold ? 1 : playerPower(sample.db, round.threshold)) : 0
  round.bullPower = round.bullHot ? round.rules?.bullForce ?? 1 : 0
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
