import { describe, expect, it, vi } from 'vitest'
import { COUNT_AT_MS, HUSH_MS, INVITE_MS } from '../core/timing'
import { createRound, push } from '../core/round'
import { playCountdown } from './count'

describe('countdown rhythm', () => {
  it('has three equal beats after calibration and starts the fight on the fourth', () => {
    expect(COUNT_AT_MS).toHaveLength(4)
    expect(COUNT_AT_MS[0]).toBe(HUSH_MS)
    expect(COUNT_AT_MS[3]).toBe(HUSH_MS + INVITE_MS)
    for (let index = 1; index < 4; index++) expect(COUNT_AT_MS[index] - COUNT_AT_MS[index - 1]).toBeCloseTo(2000 / 3, 8)
  })

  it.each([[0, 'Тише…'], [399, 'Тише…'], [400, '3'], [1066, '3'], [400 + 2000 / 3 - .001, '3'], [400 + 2000 / 3, '2'], [1067, '2'], [1733, '2'], [400 + 4000 / 3 - .001, '2'], [400 + 4000 / 3, '1'], [1734, '1'], [2399, '1']] as const)('shows %s ms on the same rhythm as the audio', (t, label) => {
    const view = push(createRound([{ kind: 'inhale', ms: 8000 }]), { t, db: -60, moo: false, hold: false })
    expect(view.shout).toBe(label)
  })

  it('schedules every audible onset on the shared grid through the supplied bus', () => {
    const frequency = { setValueAtTime: vi.fn() }
    const oscillator = { type: '', frequency, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
    const gain = { gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
    const context = { createOscillator: () => oscillator, createGain: () => gain, destination: {} } as unknown as AudioContext
    const bus = {} as AudioNode
    const stop = playCountdown(context, 1.25, bus)
    const starts = gain.gain.setValueAtTime.mock.calls.map(call => call[1])
    for (const [index, expected] of [1.65, 2.3166666667, 2.9833333333, 3.65].entries()) expect(starts[index]).toBeCloseTo(expected, 8)
    expect(starts).toHaveLength(4)
    expect(gain.connect).toHaveBeenCalledExactlyOnceWith(bus)
    expect(oscillator.start).toHaveBeenCalledExactlyOnceWith(1.65)
    expect(oscillator.stop).toHaveBeenCalledTimes(1)
    expect(oscillator.stop.mock.calls[0][0]).toBeCloseTo(3.93, 8)
    oscillator.stop.mockImplementation(() => { throw new DOMException('Already stopped', 'InvalidStateError') })
    expect(() => { stop(); stop() }).not.toThrow()
  })
})
