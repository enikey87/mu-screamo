import { describe, expect, it, vi } from 'vitest'
import { COUNT_AT_MS, HUSH_MS, INVITE_MS } from '../core/timing'
import { createRound, push } from '../core/round'
import { playCountdown } from './count'

describe('countdown rhythm', () => {
  it('has four full one-second beats including the pause after one', () => {
    expect(COUNT_AT_MS).toEqual([400, 1400, 2400, 3400, 4400])
    expect(HUSH_MS + INVITE_MS).toBe(4400)
  })

  it.each([[0, 'Тише…'], [399, 'Тише…'], [400, '4'], [1399, '4'], [1400, '3'], [2399, '3'], [2400, '2'], [3399, '2'], [3400, '1'], [4399, '1']] as const)('shows %s ms on the same rhythm as the audio', (t, label) => {
    const view = push(createRound([{ kind: 'inhale', ms: 8000 }]), { t, db: -60, moo: false, hold: false })
    expect(view.shout).toBe(label)
    expect(view.phase).not.toBe('listen')
    expect(view.tug).toBe(0)
  })

  it('starts both opening choices only after the last full beat', () => {
    for (const kind of ['inhale', 'voice'] as const) {
      const round = createRound([{ kind, ms: 8000 }])
      expect(push(round, { t: 4399, db: -60, moo: false, hold: true }).phase).toBe('invite')
      const view = push(round, { t: 4400, db: -60, moo: false, hold: true })
      expect(view.phase).toBe('listen')
      expect(view.breath).toBe(kind)
      expect(view.tug).toBe(0)
    }
  })

  it('schedules every audible onset on the shared grid through the supplied bus', () => {
    const frequency = { setValueAtTime: vi.fn() }
    const oscillator = { type: '', frequency, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
    const gain = { gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
    const context = { createOscillator: () => oscillator, createGain: () => gain, destination: {} } as unknown as AudioContext
    const bus = {} as AudioNode
    const stop = playCountdown(context, 1.25, bus)
    const starts = gain.gain.setValueAtTime.mock.calls.map(call => call[1])
    for (const [index, expected] of [1.65, 2.65, 3.65, 4.65, 5.65].entries()) expect(starts[index]).toBeCloseTo(expected, 8)
    expect(starts).toHaveLength(5)
    expect(gain.connect).toHaveBeenCalledExactlyOnceWith(bus)
    expect(oscillator.start).toHaveBeenCalledExactlyOnceWith(1.65)
    expect(oscillator.stop).toHaveBeenCalledTimes(1)
    expect(oscillator.stop.mock.calls[0][0]).toBeCloseTo(5.93, 8)
    oscillator.stop.mockImplementation(() => { throw new DOMException('Already stopped', 'InvalidStateError') })
    expect(() => { stop(); stop() }).not.toThrow()
  })
})
