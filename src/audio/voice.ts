import { bullVoice } from '../core/voice-power'
import type { DailyBull } from '../core/daily'

const PHRASE_PEAK = 0.22
const NOISE_ONSET = 0.32
const NOISE_BREATH = 0.04

interface Stage {
  type: BiquadFilterType
  freq: number
  q: number
  gain?: number
  glideTo?: number
}

const TRACT: readonly Stage[] = [
  { type: 'lowpass', freq: 2400, q: 0.7 },
  { type: 'peaking', freq: 400, q: 2.2, gain: 5 },
  { type: 'peaking', freq: 740, q: 5.5, gain: 14, glideTo: 660 },
  { type: 'notch', freq: 1400, q: 2 },
  { type: 'peaking', freq: 2200, q: 3, gain: 4 },
]

export function harmonicAmp(k: number): number {
  return 1 / k ** 1.15
}

export function phraseContour(pitch: number, dur: number): { at: number; hz: number }[] {
  return [
    { at: 0, hz: pitch * 1.04 },
    { at: dur * 0.16, hz: pitch * 1.08 },
    { at: dur * 0.55, hz: pitch * 0.99 },
    { at: dur, hz: pitch * 0.92 },
  ]
}

export function partialPower(f0: number, harmonic: number, sampleRate: number): number {
  const amp = harmonicAmp(harmonic) * tractLinear(f0 * harmonic, sampleRate)
  return amp * amp
}

export function mooCentroid(f0: number, sampleRate: number): number {
  let num = 0
  let den = 0
  for (let k = 1; k <= 48; k++) {
    const freq = f0 * k
    if (freq >= sampleRate / 2) break
    const power = partialPower(f0, k, sampleRate)
    num += freq * power
    den += power
  }
  return den > 0 ? num / den : 0
}

export function playBull(ctx: BaseAudioContext, bull: DailyBull, startAt: number, destination: AudioNode = ctx.destination): () => void {
  const profile = bullVoice(bull.fury)
  const osc = ctx.createOscillator()
  osc.setPeriodicWave(glottalWave(ctx))
  const noise = ctx.createBufferSource()
  noise.buffer = breathBuffer(ctx)
  noise.loop = true
  const noiseEnv = ctx.createGain()
  noiseEnv.gain.value = 0.0001
  const mix = ctx.createGain()
  osc.connect(mix)
  const sub = ctx.createOscillator()
  sub.type = 'triangle'
  const split = ctx.createGain()
  split.gain.value = profile.roughness * 0.5
  sub.connect(split)
  split.connect(mix)
  const rasp = ctx.createWaveShaper()
  const curve = new Float32Array(2049)
  const drive = 1 + profile.roughness * 4
  for (let i = 0; i < curve.length; i++) {
    const x = i * 2 / (curve.length - 1) - 1
    curve[i] = profile.roughness === 0 ? x : Math.tanh(drive * x) / Math.tanh(drive)
  }
  rasp.curve = curve
  rasp.oversample = '2x'
  mix.connect(rasp)
  noise.connect(noiseEnv)
  noiseEnv.connect(mix)

  const glideStage = TRACT.find((item) => item.glideTo !== undefined)
  let node: AudioNode = rasp
  let glide: BiquadFilterNode | null = null
  for (const stage of TRACT) {
    const filter = ctx.createBiquadFilter()
    filter.type = stage.type
    filter.frequency.value = stage.freq
    filter.Q.value = stage.q
    if (stage.gain !== undefined) filter.gain.value = stage.gain
    if (stage.glideTo !== undefined) glide = filter
    node.connect(filter)
    node = filter
  }

  const amp = ctx.createGain()
  amp.gain.value = 0.0001
  node.connect(amp)
  amp.connect(destination)

  let at = startAt
  for (const seg of bull.segments) {
    const dur = seg.ms / 1000
    const end = at + dur
    amp.gain.setValueAtTime(seg.kind === 'voice' ? 0.0001 : 0, at)
    noiseEnv.gain.setValueAtTime(0.0001, at)
    if (seg.kind === 'voice' && dur > 0.25) {
      const points = phraseContour(bull.pitch, dur)
      osc.frequency.setValueAtTime(points[0].hz, at)
      sub.frequency.setValueAtTime(points[0].hz / 2, at)
      for (const point of points.slice(1)) {
        osc.frequency.exponentialRampToValueAtTime(point.hz, at + point.at)
        sub.frequency.exponentialRampToValueAtTime(point.hz / 2, at + point.at)
      }
      amp.gain.exponentialRampToValueAtTime(PHRASE_PEAK * profile.power, at + 0.085)
      amp.gain.exponentialRampToValueAtTime(PHRASE_PEAK * profile.power * 0.62, end - 0.14)
      amp.gain.exponentialRampToValueAtTime(0.0001, end - 0.015)
      amp.gain.setValueAtTime(0, end)
      noiseEnv.gain.exponentialRampToValueAtTime(NOISE_ONSET, at + 0.028)
      noiseEnv.gain.exponentialRampToValueAtTime(NOISE_BREATH, at + 0.08)
      noiseEnv.gain.exponentialRampToValueAtTime(0.0001, end - 0.015)
      if (glide && glideStage?.glideTo !== undefined) {
        glide.frequency.setValueAtTime(glideStage.freq, at)
        glide.frequency.exponentialRampToValueAtTime(glideStage.glideTo, end - 0.015)
      }
    }
    at += dur
  }

  const stopAt = at + 0.02
  osc.start(startAt)
  sub.start(startAt)
  noise.start(startAt)
  osc.stop(stopAt)
  sub.stop(stopAt)
  noise.stop(stopAt)

  return () => {
    const now = ctx.currentTime
    try {
      amp.gain.cancelScheduledValues(now)
      noiseEnv.gain.cancelScheduledValues(now)
      amp.gain.setValueAtTime(0, now)
      noiseEnv.gain.setValueAtTime(0.0001, now)
      osc.stop()
      sub.stop()
      noise.stop()
    } catch {
      /* расписание уже доиграло */
    }
  }
}

function glottalWave(ctx: BaseAudioContext): PeriodicWave {
  const n = 64
  const real = new Float32Array(n)
  const imag = new Float32Array(n)
  for (let k = 1; k < n; k++) real[k] = harmonicAmp(k)
  return ctx.createPeriodicWave(real, imag)
}

function breathBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let seed = 0x6d2b79f5
  for (let i = 0; i < data.length; i++) {
    seed = Math.imul(seed, 1664525) + 1013904223
    data[i] = ((seed >>> 8) / 0x1000000) * 2 - 1
  }
  return buffer
}

function tractLinear(freq: number, sampleRate: number): number {
  let gain = 1
  for (const stage of TRACT) gain *= stageLinear(stage, freq, sampleRate)
  return gain
}

function stageLinear(stage: Stage, freq: number, sampleRate: number): number {
  const w0 = (2 * Math.PI * stage.freq) / sampleRate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const alpha = sin / (2 * stage.q)
  const A = 10 ** ((stage.gain ?? 0) / 40)
  let b0 = 1
  let b1 = 0
  let b2 = 0
  let a0 = 1
  let a1 = 0
  let a2 = 0
  if (stage.type === 'lowpass') {
    b0 = (1 - cos) / 2
    b1 = 1 - cos
    b2 = (1 - cos) / 2
    a0 = 1 + alpha
    a1 = -2 * cos
    a2 = 1 - alpha
  } else if (stage.type === 'peaking') {
    b0 = 1 + alpha * A
    b1 = -2 * cos
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cos
    a2 = 1 - alpha / A
  } else if (stage.type === 'notch') {
    b0 = 1
    b1 = -2 * cos
    b2 = 1
    a0 = 1 + alpha
    a1 = -2 * cos
    a2 = 1 - alpha
  }
  const w = (2 * Math.PI * freq) / sampleRate
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const numRe = b0 + b1 * cw + b2 * c2
  const numIm = -(b1 * sw + b2 * s2)
  const denRe = a0 + a1 * cw + a2 * c2
  const denIm = -(a1 * sw + a2 * s2)
  const den = Math.hypot(denRe, denIm)
  return den === 0 ? 0 : Math.hypot(numRe, numIm) / den
}
