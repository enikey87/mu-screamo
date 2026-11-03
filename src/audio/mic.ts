export type MicFail = 'unsupported' | 'denied' | 'missing' | 'busy'

export class MicError extends Error {
  readonly reason: MicFail

  constructor(reason: MicFail) {
    super(reason)
    this.name = 'MicError'
    this.reason = reason
  }
}

export interface Mic {
  sampleRate: number
  echoCancellation: boolean
  read: () => Float32Array
  stop: () => void
}

const HINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
}

export function micAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

export async function openMic(ctx: AudioContext): Promise<Mic> {
  if (!micAvailable()) throw new MicError('unsupported')
  const stream = await acquire()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.15
  const source = ctx.createMediaStreamSource(stream)
  const sink = ctx.createGain()
  sink.gain.value = 0
  source.connect(analyser)
  analyser.connect(sink)
  sink.connect(ctx.destination)
  const buf = new Float32Array(analyser.fftSize)
  return {
    sampleRate: ctx.sampleRate,
    echoCancellation: Boolean(stream.getAudioTracks()[0]?.getSettings().echoCancellation),
    read: () => {
      analyser.getFloatTimeDomainData(buf)
      return buf
    },
    stop: () => {
      source.disconnect()
      analyser.disconnect()
      sink.disconnect()
      for (const track of stream.getTracks()) track.stop()
    },
  }
}

async function acquire(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: HINTS })
  } catch (err) {
    const reason = reasonOf(err)
    if (reason && reason !== 'busy') throw new MicError(reason)
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: HINTS })
    } catch (err2) {
      throw new MicError(reasonOf(err2) ?? 'busy')
    }
  }
}

function reasonOf(err: unknown): MicFail | null {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'missing'
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'busy'
  return null
}
