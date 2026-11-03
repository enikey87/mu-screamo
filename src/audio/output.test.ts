import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlayback } from './output'

function playback({ fail = false, gathering = false } = {}) {
  const track = { stop: vi.fn() }
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] }
  const output = { connect: vi.fn(), disconnect: vi.fn() }
  const streamNode = { stream }
  const destination = {}
  const ctx = { createGain: () => output, createMediaStreamDestination: () => streamNode, destination } as unknown as AudioContext
  const element = { dataset: {}, hidden: false, srcObject: null, play: vi.fn(() => fail ? Promise.reject(new Error('play denied')) : Promise.resolve()), pause: vi.fn(), remove: vi.fn() }
  const peers: Peer[] = []
  class Peer {
    iceGatheringState = gathering ? 'gathering' : 'complete'
    localDescription = { type: 'offer', sdp: 'local' }
    ontrack?: (event: { track: object }) => void
    listeners = new Map<string, () => void>()
    close = vi.fn()
    addTrack = vi.fn()
    createOffer = async () => this.localDescription
    createAnswer = async () => this.localDescription
    setLocalDescription = async () => undefined
    setRemoteDescription = async () => { this.ontrack?.({ track: { remote: true } }) }
    addEventListener = (name: string, fn: () => void) => this.listeners.set(name, fn)
    removeEventListener = (name: string) => this.listeners.delete(name)
    constructor(readonly config: object) { peers.push(this) }
  }
  vi.stubGlobal('RTCPeerConnection', Peer)
  vi.stubGlobal('Audio', class { constructor() { return element } })
  vi.stubGlobal('MediaStream', class { constructor(readonly tracks: object[]) {} })
  vi.stubGlobal('document', { body: { append: vi.fn() } })
  return { ctx, output, streamNode, destination, peers, track, stream, element }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('game playback echo reference', () => {
  it('routes only game output through a local received stream and closes it with the round', async () => {
    const fixture = playback()
    const result = await createPlayback(fixture.ctx)
    expect(result.echoReference).toBe(true)
    expect(result.destination).toBe(fixture.output)
    expect(fixture.output.connect).toHaveBeenCalledExactlyOnceWith(fixture.streamNode)
    expect(fixture.peers).toHaveLength(2)
    for (const peer of fixture.peers) expect(peer.config).toEqual({ iceServers: [] })
    expect(fixture.peers[0].addTrack).toHaveBeenCalledExactlyOnceWith(fixture.track, fixture.stream)
    expect(fixture.peers[1].addTrack).not.toHaveBeenCalled()
    expect(fixture.element.play).toHaveBeenCalledOnce()
    result.stop()
    for (const peer of fixture.peers) expect(peer.close).toHaveBeenCalledOnce()
    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.element.srcObject).toBeNull()
    expect(fixture.element.remove).toHaveBeenCalledOnce()
    expect(fixture.output.disconnect).toHaveBeenCalledOnce()
  })

  it('keeps sound available and reports a missing reference after playback rejection', async () => {
    const fixture = playback({ fail: true })
    const result = await createPlayback(fixture.ctx)
    expect(result.echoReference).toBe(false)
    expect(fixture.output.connect).toHaveBeenLastCalledWith(fixture.destination)
    for (const peer of fixture.peers) expect(peer.close).toHaveBeenCalledOnce()
    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.element.remove).toHaveBeenCalledOnce()
    result.stop()
    expect(fixture.output.disconnect).toHaveBeenCalledTimes(2)
  })

  it('falls back when WebRTC is unavailable', async () => {
    const fixture = playback()
    vi.stubGlobal('RTCPeerConnection', undefined)
    const result = await createPlayback(fixture.ctx)
    expect(result.echoReference).toBe(false)
    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.output.connect).toHaveBeenLastCalledWith(fixture.destination)
  })

  it('bounds a stalled connection and removes gathering listeners on timeout', async () => {
    vi.useFakeTimers()
    const fixture = playback({ gathering: true })
    const pending = createPlayback(fixture.ctx)
    await vi.advanceTimersByTimeAsync(2999)
    expect(fixture.peers[0].close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await pending).echoReference).toBe(false)
    for (const peer of fixture.peers) {
      expect(peer.close).toHaveBeenCalledOnce()
      expect(peer.listeners.size).toBe(0)
    }
    expect(fixture.output.connect).toHaveBeenLastCalledWith(fixture.destination)
  })
})
