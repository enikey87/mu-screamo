import { describe, expect, it } from 'vitest'
import { analyzeFrame, rmsDb } from './analyze'

const RATE = 48_000
const N = 2048

function mooish(): Float32Array {
  const out = new Float32Array(N)
  const f0 = 140
  const amps = [1, 0.55, 0.3, 0.16, 0.08, 0.04]
  for (let h = 0; h < amps.length; h++) {
    const freq = f0 * (h + 1)
    for (let i = 0; i < N; i++) out[i] += amps[h] * Math.sin((2 * Math.PI * freq * i) / RATE)
  }
  let peak = 0
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]))
  for (let i = 0; i < N; i++) out[i] = (out[i] / peak) * 0.4
  return out
}

describe('analyzeFrame', () => {
  it('hears a low rounded vowel as moo', () => {
    const frame = analyzeFrame(mooish(), RATE)
    expect(frame.moo).toBe(true)
    expect(frame.f0).toBeGreaterThan(100)
    expect(frame.f0).toBeLessThan(180)
  })

  it('rejects a high whistle and silence', () => {
    const scream = new Float32Array(N)
    for (let i = 0; i < N; i++) scream[i] = Math.sin((2 * Math.PI * 1800 * i) / RATE) * 0.5
    expect(analyzeFrame(scream, RATE).moo).toBe(false)
    const silence = new Float32Array(N)
    expect(analyzeFrame(silence, RATE).moo).toBe(false)
    expect(rmsDb(silence)).toBeLessThan(-40)
  })
})

type VoiceOptions = {
  rate: number
  f0: number
  vowel?: 'u' | 'a'
  drive?: number
  soft?: boolean
  noise?: number
  roughness?: number
  subharmonics?: number
  phase?: number
  length?: number
}

function voice({
  rate, f0, vowel = 'u', drive = 0.2, soft = false,
  noise = 0, roughness = 0, subharmonics = 0, phase = 0, length = N,
}: VoiceOptions): Float32Array {
  const out = new Float32Array(length)
  const random = noiseSource(42)
  let frequency = 1
  let amplitude = 1
  for (let i = 0; i < out.length; i++) {
    let value = 0
    for (let h = 1; h * f0 < 8000; h++) {
      const f = h * f0
      const envelope = vowel === 'u'
        ? 1.4 * Math.exp(-0.5 * ((f - 320) / 130) ** 2)
          + 0.8 * Math.exp(-0.5 * ((f - 780) / 180) ** 2) + 0.04
        : Math.exp(-0.5 * ((f - 850) / 180) ** 2)
          + 1.2 * Math.exp(-0.5 * ((f - 1400) / 250) ** 2) + 0.04
      value += envelope / Math.sqrt(h) * Math.sin(2 * Math.PI * h * phase + 0.4 * h)
      value += subharmonics * envelope / Math.sqrt(h)
        * Math.sin(2 * Math.PI * (h - 0.5) * phase + 0.3 * h)
    }
    value *= drive * amplitude
    out[i] = (soft ? Math.tanh(value) : Math.max(-1, Math.min(1, value))) + noise * random()
    const cycle = Math.floor(phase)
    phase += f0 / rate * frequency
    if (Math.floor(phase) > cycle) {
      frequency = 1 + roughness * random()
      amplitude = 1 + 2 * roughness * random()
    }
  }
  return out
}

function noiseSource(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 31 - 1
  }
}

const voices = [44_100, 48_000].flatMap((rate) =>
  [80, 140, 220, 320, 420].map((f0) => ({ rate, f0 })))
const textures = [
  { name: 'clean', drive: 0.2 },
  { name: 'hard clipped', drive: 3 },
  { name: 'soft saturated', drive: 3, soft: true },
  { name: 'raspy', drive: 1.5, noise: 0.35, roughness: 0.06 },
  { name: 'growled', drive: 1.5, noise: 0.15, subharmonics: 0.7 },
]

describe.each(voices)('vowels at $f0 Hz / $rate samples per second', (pitch) => {
  it.each(textures)('recognizes $name rounded moo at different frame offsets and gains', (texture) => {
    for (const phase of [0, 0.37]) {
      const samples = voice({ ...pitch, ...texture, phase })
      for (const gain of [0.08, 0.8]) {
        const frame = analyzeFrame(samples.map((value) => value * gain), pitch.rate)
        expect(frame.moo, JSON.stringify({ texture, phase, gain, frame })).toBe(true)
      }
    }
  })

  it.each(textures)('rejects the same $name voice with an open aaa vowel', (texture) => {
    const samples = voice({ ...pitch, ...texture, vowel: 'a' })
    expect(analyzeFrame(samples, pitch.rate).moo).toBe(false)
  })
})

describe.each([44_100, 48_000])('non-vocal input at %i samples per second', (rate) => {
  it.each([19, 42, 103])('rejects broadband and low-pass noise (seed %i)', (seed) => {
    const random = noiseSource(seed)
    const noise = Float32Array.from({ length: N }, () => random())
    expect(analyzeFrame(noise, rate).moo).toBe(false)
    let low = 0
    const rumble = noise.map((value) => {
      low += 0.06 * (value - low)
      return low
    })
    expect(analyzeFrame(rumble, rate).moo).toBe(false)
  })

  it('rejects silence, DC, a click, high whistles and a noise-masked vowel', () => {
    const silence = new Float32Array(N)
    const click = new Float32Array(N)
    click[N / 2] = 1
    const masked = voice({ rate, f0: 140, drive: 0.02, noise: 1 })
    for (const samples of [silence, new Float32Array(N).fill(0.9), click, masked]) {
      expect(analyzeFrame(samples, rate).moo).toBe(false)
    }
    for (const hz of [1800, 3000, 6000]) {
      const whistle = Float32Array.from({ length: N }, (_, i) => Math.sin(2 * Math.PI * hz * i / rate))
      expect(analyzeFrame(whistle, rate).moo).toBe(false)
    }
  })

  it('does not carry a recognized moo into the following rejected frame', () => {
    const moo = voice({ rate, f0: 140, drive: 3 })
    const aaa = voice({ rate, f0: 140, drive: 3, vowel: 'a' })
    expect([moo, aaa, moo, new Float32Array(N)].map((samples) => analyzeFrame(samples, rate).moo))
      .toEqual([true, false, true, false])
  })

  it('does not mistake a slowly drifting rumble for the highest allowed pitch', () => {
    const random = noiseSource(1)
    let low = 0
    const drift = Float32Array.from({ length: N }, () => {
      low += 0.006 * (random() - low)
      return low
    })
    expect(analyzeFrame(drift, rate).moo).toBe(false)
  })

  it.each([72, 455])('keeps a rounded vowel near the pitch boundary (%i Hz)', (f0) => {
    expect(analyzeFrame(voice({ rate, f0, drive: 3 }), rate).moo).toBe(true)
  })
})


describe.each([44_100, 48_000])('sustained harsh moo at %i samples per second', (rate) => {
  it('recognizes most frames even with 12% cycle jitter and breath noise', () => {
    const samples = voice({ rate, f0: 80, drive: 1.5, noise: 0.35, roughness: 0.12, length: rate })
    const frames = []
    for (let i = 0; i + N <= samples.length; i += N) {
      frames.push(analyzeFrame(samples.slice(i, i + N), rate).moo)
    }
    expect(frames.length).toBeGreaterThan(20)
    expect(frames.filter(Boolean).length / frames.length).toBeGreaterThanOrEqual(0.6)
  })
})
