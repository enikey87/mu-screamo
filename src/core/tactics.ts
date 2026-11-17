import type { Segment } from './daily'

export function applyTactic(segments: readonly Segment[], fury?: number): Segment[] {
  let elapsed = 0
  let voice = 0
  let strong = false
  return segments.map(segment => {
    const next: Segment = { kind: segment.kind, ms: segment.ms }
    if (fury !== undefined) {
      if (segment.kind === 'voice') {
        const burst = fury === 3 || fury === 4 && elapsed >= 4000
        strong = fury === 2 && voice % 2 === 1
        next.pressure = burst ? [1.45, .55] : fury === 1 || fury === 4 ? [.6, 1.4] : strong ? [1.3, 1.3] : fury === 2 ? [.7, .7] : [1, 1]
        voice += 1
      } else next.opening = fury === 0 ? 1.12 : fury === 3 ? 1.2 : fury === 2 && strong || fury === 4 && elapsed >= 4000 ? 1.25 : 1
    }
    elapsed += segment.ms
    return next
  })
}
