import type { DailyBull } from '../core/daily'

export function playBull(ctx: AudioContext, bull: DailyBull, startAt: number): () => void {
  const high = ctx.createOscillator()
  high.type = 'sawtooth'
  high.frequency.value = bull.pitch
  const low = ctx.createOscillator()
  low.type = 'triangle'
  low.frequency.value = bull.pitch / 2
  const highGain = ctx.createGain()
  highGain.gain.value = 0.45
  const lowGain = ctx.createGain()
  lowGain.gain.value = 0.55
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 680
  const amp = ctx.createGain()
  amp.gain.value = 0.0001
  high.connect(highGain)
  low.connect(lowGain)
  highGain.connect(filter)
  lowGain.connect(filter)
  filter.connect(amp)
  amp.connect(ctx.destination)

  let at = startAt
  for (const seg of bull.segments) {
    const dur = seg.ms / 1000
    amp.gain.setValueAtTime(0.0001, at)
    if (seg.kind === 'voice' && dur > 0.08) {
      amp.gain.exponentialRampToValueAtTime(0.2, at + 0.04)
      amp.gain.setValueAtTime(0.2, at + dur - 0.06)
      amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    }
    at += dur
  }

  high.start(startAt)
  low.start(startAt)
  const stopAt = at + 0.02
  high.stop(stopAt)
  low.stop(stopAt)

  return () => {
    const now = ctx.currentTime
    try {
      amp.gain.cancelScheduledValues(now)
      amp.gain.setValueAtTime(0.0001, now)
      high.stop()
      low.stop()
    } catch {
      /* уже остановлены концом расписания */
    }
  }
}
