import { describe, expect, it } from 'vitest'
import { mooCentroid, partialPower, phraseContour } from './voice'

describe('moo spectrum', () => {
  it('keeps a vowel bump near 770 Hz under the fundamental', () => {
    const root = partialPower(110, 1, 48_000)
    const bump = partialPower(110, 7, 48_000)
    expect(bump).toBeGreaterThan(root * 0.08)
    expect(bump).toBeLessThan(root)
  })

  it('sits the centroid above the fundamental and below a shout', () => {
    const centroid = mooCentroid(110, 48_000)
    expect(centroid).toBeGreaterThan(220)
    expect(centroid).toBeLessThan(700)
  })
})

describe('phrase contour', () => {
  it('rises early and finishes lower than it started', () => {
    const points = phraseContour(100, 1)
    expect(points.map((point) => point.at)).toEqual([0, 0.16, 0.55, 1])
    expect(points.map((point) => Math.round(point.hz))).toEqual([104, 108, 99, 92])
  })
})
