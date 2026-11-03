import { describe, expect, it } from 'vitest'
import { HUSH_MS, INVITE_MS } from '../core/timing'
import { COUNT_AT_MS } from './count'

describe('COUNT_AT_MS', () => {
  it('stays quiet while the room is measured and rings the signal when the fight starts', () => {
    expect(COUNT_AT_MS[0]).toBeGreaterThanOrEqual(HUSH_MS)
    expect(COUNT_AT_MS[COUNT_AT_MS.length - 1]).toBe(HUSH_MS + INVITE_MS)
    expect(COUNT_AT_MS).toHaveLength(4)
  })
})
