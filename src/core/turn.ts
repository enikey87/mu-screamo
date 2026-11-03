import type { DailyBull } from './daily'

export type Starter = 'you' | 'bull'

export function tossStarter(chance: number): Starter {
  if (!Number.isFinite(chance) || chance < 0 || chance >= 1) throw new RangeError('invalid coin sample')
  return chance < 0.5 ? 'you' : 'bull'
}

export function startWith(bull: DailyBull, first: Starter): DailyBull {
  const kind = first === 'you' ? 'inhale' : 'voice'
  const index = bull.segments.findIndex(segment => segment.kind === kind)
  if (index < 0) throw new RangeError('missing first breath')
  return { ...bull, segments: [...bull.segments.slice(index), ...bull.segments.slice(0, index)] }
}
