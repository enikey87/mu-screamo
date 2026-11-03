import { afterEach, describe, expect, it, vi } from 'vitest'
import { MicError, openMic } from './mic'

function capture(settings = true) {
  const track = { stop: vi.fn(), getSettings: () => ({ echoCancellation: settings }) }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  const nodes: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  const node = () => {
    const value = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 }, fftSize: 2048, getFloatTimeDomainData: vi.fn() }
    nodes.push(value)
    return value
  }
  const ctx = { createAnalyser: node, createGain: node, createMediaStreamSource: node, sampleRate: 48000, destination: {} } as unknown as AudioContext
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  vi.stubGlobal('window', { isSecureContext: true })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  return { ctx, track, nodes, getUserMedia }
}

afterEach(() => vi.unstubAllGlobals())

describe('microphone capture policy', () => {
  it('requests echo cancellation while preserving player loudness and sustained vowels', async () => {
    const { ctx, getUserMedia, nodes, track } = capture()
    const mic = await openMic(ctx)
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } })
    expect(mic.echoCancellation).toBe(true)
    expect(mic.sampleRate).toBe(48000)
    expect(mic.read()).toHaveLength(2048)
    mic.stop()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(nodes).toHaveLength(3)
    for (const node of nodes) expect(node.disconnect).toHaveBeenCalledOnce()
  })

  it('reports unsupported AEC without rejecting a usable microphone', async () => {
    const { ctx } = capture(false)
    expect((await openMic(ctx)).echoCancellation).toBe(false)
  })

  it('preserves all processing settings on a transient capture retry', async () => {
    const { ctx, getUserMedia } = capture()
    getUserMedia.mockRejectedValueOnce(new DOMException('busy', 'NotReadableError'))
    await openMic(ctx)
    expect(getUserMedia.mock.calls[1]).toEqual([{ audio: { echoCancellation: true, autoGainControl: false, noiseSuppression: false } }])
  })

  it.each([['NotAllowedError', 'denied'], ['NotFoundError', 'missing']])('does not retry %s', async (name, reason) => {
    const { ctx, getUserMedia } = capture()
    getUserMedia.mockRejectedValue(new DOMException('', name))
    await expect(openMic(ctx)).rejects.toEqual(new MicError(reason as 'denied' | 'missing'))
    expect(getUserMedia).toHaveBeenCalledOnce()
  })

  it('maps an unsuccessful retry and rejects insecure capture before requesting permission', async () => {
    const { ctx, getUserMedia } = capture()
    getUserMedia.mockRejectedValue(new Error('device failed'))
    await expect(openMic(ctx)).rejects.toEqual(new MicError('busy'))
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    vi.stubGlobal('window', { isSecureContext: false })
    await expect(openMic(ctx)).rejects.toEqual(new MicError('unsupported'))
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
})
