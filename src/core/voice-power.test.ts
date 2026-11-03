import { describe, expect, it } from 'vitest'
import { bullVoice, playerPower } from './voice-power'

describe('player loudness', () => {
  it('maps a calibrated noise floor to bounded voice pressure without automatic gain', () => {
    expect(playerPower(-46, -45)).toBe(0)
    expect(playerPower(-45, -45)).toBeCloseTo(0.35)
    expect(playerPower(-35, -45)).toBeCloseTo(0.61)
    expect(playerPower(-20, -45)).toBe(1)
    expect(playerPower(-8, -45)).toBe(1.5)
    expect(playerPower(0, -45)).toBe(1.5)
    expect(playerPower(100, -45)).toBe(1.5)
    expect(playerPower(-25, -30)).toBeLessThan(playerPower(-25, -45))
  })
  it.each([NaN, Infinity, -Infinity])('rejects invalid level %s', db => {
    expect(playerPower(db, -45)).toBe(0)
  })
})

describe('bull voice profile', () => {
  it('makes every angrier championship voice louder and more split', () => {
    const voices = [0, 1, 2, 3, 4].map(bullVoice)
    expect(voices[0]).toEqual({ power: 0.6, roughness: 0 })
    expect(voices[4]).toEqual({ power: 0.9, roughness: 0.8 })
    for (let i = 1; i < voices.length; i++) {
      expect(voices[i].power).toBeGreaterThan(voices[i - 1].power)
      expect(voices[i].roughness).toBeGreaterThan(voices[i - 1].roughness)
    }
    expect(bullVoice()).toEqual({ power: 1, roughness: 0.1 })
  })
})
