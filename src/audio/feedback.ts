export function playPrecision(ctx: BaseAudioContext, destination: AudioNode = ctx.destination): () => void {
  const stop: (() => void)[] = []
  for (const hz of [880, 1430]) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = hz
    gain.gain.setValueAtTime(.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(.075, ctx.currentTime + .008)
    gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .3)
    osc.connect(gain)
    gain.connect(destination)
    osc.onended = () => { osc.disconnect(); gain.disconnect() }
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + .34)
    stop.push(() => {
      try { osc.stop() } catch { osc.disconnect(); gain.disconnect() }
    })
  }
  return () => stop.forEach(end => end())
}
