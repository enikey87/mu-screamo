import { COUNT_AT_MS } from '../core/timing'

const FREQ = [523, 659, 784, 1_047]

export function playCountdown(ctx: AudioContext, origin: number, destination: AudioNode = ctx.destination): () => void {
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  const gain = ctx.createGain()
  gain.gain.value = 0.0001
  osc.connect(gain)
  gain.connect(destination)
  COUNT_AT_MS.forEach((ms, i) => {
    const t = origin + ms / 1000
    const dur = i === COUNT_AT_MS.length - 1 ? 0.22 : 0.13
    osc.frequency.setValueAtTime(FREQ[i], t)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  })
  osc.start(origin + COUNT_AT_MS[0] / 1000)
  osc.stop(origin + COUNT_AT_MS[COUNT_AT_MS.length - 1] / 1000 + 0.28)
  return () => {
    try {
      osc.stop()
    } catch {
      // расписание уже доиграло
    }
  }
}
