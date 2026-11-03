export interface Playback {
  destination: AudioNode
  echoReference: boolean
  stop: () => void
}

export async function createPlayback(ctx: AudioContext): Promise<Playback> {
  const destination = ctx.createGain()
  const peers: RTCPeerConnection[] = []
  let stream: MediaStreamAudioDestinationNode | null = null
  let element: HTMLAudioElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = new AbortController()
  const close = () => {
    abort.abort()
    for (const peer of peers) peer.close()
    for (const track of stream?.stream.getTracks() ?? []) track.stop()
    if (element) { element.pause(); element.srcObject = null; element.remove() }
    destination.disconnect()
  }
  try {
    stream = ctx.createMediaStreamDestination()
    destination.connect(stream)
    const send = new RTCPeerConnection({ iceServers: [] })
    peers.push(send)
    const receive = new RTCPeerConnection({ iceServers: [] })
    peers.push(receive)
    element = new Audio()
    element.dataset.echoReference = 'true'
    element.hidden = true
    document.body.append(element)
    const player = element
    const playing = new Promise<void>((resolve, reject) => {
      receive.ontrack = event => {
        player.srcObject = new MediaStream([event.track])
        void player.play().then(resolve, reject)
      }
    })
    for (const track of stream.stream.getAudioTracks()) send.addTrack(track, stream.stream)
    const connect = async () => {
      await send.setLocalDescription(await send.createOffer())
      await gathered(send, abort.signal)
      await receive.setRemoteDescription(send.localDescription!)
      await receive.setLocalDescription(await receive.createAnswer())
      await gathered(receive, abort.signal)
      await send.setRemoteDescription(receive.localDescription!)
    }
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('audio reference timeout')), 3000)
    })
    await Promise.race([Promise.all([connect(), playing]), timeout])
    return { destination, echoReference: true, stop: close }
  } catch {
    close()
    destination.connect(ctx.destination)
    return { destination, echoReference: false, stop: () => destination.disconnect() }
  } finally {
    clearTimeout(timer)
  }
}

function gathered(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const clean = () => {
      peer.removeEventListener('icegatheringstatechange', changed)
      signal.removeEventListener('abort', cancelled)
    }
    const changed = () => {
      if (peer.iceGatheringState === 'complete') { clean(); resolve() }
    }
    const cancelled = () => { clean(); reject(new Error('audio reference closed')) }
    peer.addEventListener('icegatheringstatechange', changed)
    signal.addEventListener('abort', cancelled, { once: true })
  })
}
