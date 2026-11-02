import { describe, expect, it } from 'vitest'
import { dailyBull } from './daily'
import { LISTEN_MS, TARGET_INHALE_MS } from './timing'

describe('dailyBull', () => {
  it('gives everyone the same bull until the next local midnight', () => {
    const day = new Date(2026, 10, 2, 23, 50)
    const again = dailyBull(new Date(2026, 10, 2, 8, 0))
    const bull = dailyBull(day)
    expect(bull).toEqual(again)
    expect(bull.label).toBe('02.11')
    expect(bull.pitch).toBeGreaterThanOrEqual(98)
    expect(bull.pitch).toBeLessThanOrEqual(134)
    const total = bull.segments.reduce((sum, seg) => sum + seg.ms, 0)
    const inhale = bull.segments.filter((seg) => seg.kind === 'inhale').reduce((sum, seg) => sum + seg.ms, 0)
    expect(total).toBe(LISTEN_MS)
    expect(inhale).toBe(TARGET_INHALE_MS)
    expect(bull.segments[0].kind).toBe('voice')
    expect(bull.segments.filter((seg) => seg.kind === 'inhale').length).toBeGreaterThanOrEqual(3)
  })

  it('changes the breath when the date changes', () => {
    const a = dailyBull(new Date(2026, 10, 2))
    const b = dailyBull(new Date(2026, 10, 3))
    expect(a.segments).not.toEqual(b.segments)
  })
})
