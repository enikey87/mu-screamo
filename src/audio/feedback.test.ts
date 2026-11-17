import { expect, it, vi } from 'vitest'
import { playPrecision } from './feedback'

it('routes a short bell to the echo reference bus and releases every node on stop or natural completion', () => {
  const oscillators = [] as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended: (() => void) | null; frequency: { value: number } }[]
  const gains: { disconnect: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }[] = []
  const ctx = { currentTime: 4, destination: {}, createOscillator: () => {
    const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null }
    oscillators.push(osc); return osc
  }, createGain: () => {
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
    gains.push(gain); return gain
  } } as unknown as BaseAudioContext
  const bus = { bus: 'echo reference' } as unknown as AudioNode
  const stop = playPrecision(ctx, bus)
  expect(oscillators.map(osc => osc.frequency.value)).toEqual([880, 1430])
  expect(oscillators).toHaveLength(2)
  for (const osc of oscillators) {
    expect(osc.start).toHaveBeenCalledWith(4)
    expect(osc.stop).toHaveBeenCalledWith(4.34)
    osc.stop.mockImplementation(() => { throw new DOMException('Already stopped', 'InvalidStateError') })
  }
  expect(() => { stop(); stop() }).not.toThrow()
  oscillators.forEach(osc => osc.onended?.())
  expect(oscillators.every(osc => osc.disconnect.mock.calls.length > 0)).toBe(true)
  gains.forEach(gain => {
    expect(gain.connect).toHaveBeenCalledWith(bus)
    expect(gain.disconnect).toHaveBeenCalled()
  })
})
