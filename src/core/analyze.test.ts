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

  it('rejects a scream and silence', () => {
    const scream = new Float32Array(N)
    for (let i = 0; i < N; i++) scream[i] = Math.sin((2 * Math.PI * 1800 * i) / RATE) * 0.5
    expect(analyzeFrame(scream, RATE).moo).toBe(false)
    const silence = new Float32Array(N)
    expect(analyzeFrame(silence, RATE).moo).toBe(false)
    expect(rmsDb(silence)).toBeLessThan(-40)
  })
})
