import { describe, expect, it } from 'vitest'
import { formatShare } from './share'

describe('formatShare', () => {
  it('prints the date stamp and the moo length', () => {
    expect(formatShare('02.11', 'опись', 4200)).toBe('02.11 · опись · 4.2с')
  })
})
