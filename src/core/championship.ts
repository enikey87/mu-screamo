import { bullVoice } from './voice-power'
import type { DailyBull, Segment } from './daily'
import type { RoundRules } from './round'

export interface ChampionshipStage {
  title: string
  scene: { id: 'fence' | 'yard' | 'evening'; label: string }
  mood: string
  intro: string
  fury: number
  bull: DailyBull
  rhythms: readonly (readonly Segment[])[]
  rules: RoundRules
}

const SCENES = {
  fence: { id: 'fence', label: 'У изгороди' },
  yard: { id: 'yard', label: 'Во дворе' },
  evening: { id: 'evening', label: 'Вечерний луг' },
} as const

function encounter(title: string, scene: ChampionshipStage['scene'], mood: string, intro: string, fury: number, pitch: number, airMs: number, durations: number[], ...alternates: number[][]): ChampionshipStage {
  const rhythms = [durations, ...alternates].map(pattern => pattern.map((ms, index): Segment => ({ kind: index % 2 === 0 ? 'voice' : 'inhale', ms })))
  return {
    title, scene, mood, intro, fury, rhythms,
    bull: { dateKey: `championship-${fury}`, label: title, pitch, fury, segments: rhythms[0] },
    rules: { airMs, recoveryRate: 1.5, recoverAt: 0.4, bullForce: bullVoice(fury).power },
  }
}

export const STAGES: readonly ChampionshipStage[] = [
  encounter('Разминка', SCENES.fence, 'Спросонья', '«Ты меня ради этого разбудил? Ладно, мычи».', 0, 125, 2600, [400, 1800, 600, 1800, 600, 2800],
    [600, 2200, 400, 2000, 600, 2200],
    [500, 2400, 500, 1800, 600, 2200]),
  encounter('Упрямство', SCENES.fence, 'Собрался', '«Это была разминка. Теперь я готов». Лови ровный ритм.', 1, 118, 2400, [800, 1200, 800, 1200, 800, 1200, 800, 1200],
    [700, 1300, 900, 1100, 700, 1300, 900, 1100],
    [1000, 1400, 600, 1000, 1000, 1400, 600, 1000]),
  encounter('Вызов', SCENES.yard, 'Сердится', '«Думаешь, разгадал меня?» Длина вдохов теперь разная.', 2, 110, 2300, [1000, 1500, 1100, 1000, 1200, 2200],
    [1200, 1000, 900, 1900, 1200, 1800],
    [900, 2100, 1400, 1500, 1000, 1100]),
  encounter('Ярость', SCENES.yard, 'Взбешён', '«Всё. Хватит поддавков». Береги воздух для коротких пауз.', 3, 102, 2100, [1000, 1000, 600, 1000, 1100, 600, 1300, 1400],
    [700, 900, 1200, 1100, 800, 1300, 1300, 700],
    [1200, 800, 900, 1400, 1100, 1100, 800, 700]),
  encounter('Финал', SCENES.evening, 'Разъярён', '«Луг. Пока ещё. Мой». В середине боя Бынич ускорится.', 4, 94, 1900, [1600, 1400, 1200, 1200, 500, 500, 700, 900],
    [1400, 1600, 1300, 1000, 800, 800, 500, 600],
    [1500, 1200, 1100, 1500, 600, 700, 800, 600]),
]

export function championshipStage(index: number): ChampionshipStage {
  if (!Number.isInteger(index) || index < 0 || index >= STAGES.length) throw new RangeError('invalid championship stage')
  return STAGES[index]
}

export function pickChampionshipBull(index: number, chance: number, previous?: number): { rhythm: number; bull: DailyBull } {
  const stage = championshipStage(index)
  if (!Number.isFinite(chance) || chance < 0 || chance >= 1) throw new RangeError('invalid rhythm sample')
  if (previous !== undefined && (!Number.isInteger(previous) || previous < 0 || previous >= stage.rhythms.length)) throw new RangeError('invalid previous rhythm')
  const draw = Math.floor(chance * (stage.rhythms.length - (previous === undefined ? 0 : 1)))
  const rhythm = previous !== undefined && draw >= previous ? draw + 1 : draw
  return { rhythm, bull: { ...stage.bull, segments: stage.rhythms[rhythm].map(segment => ({ ...segment })) } }
}

export function winStage(cleared: number, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= STAGES.length || index > cleared) return cleared
  return Math.max(cleared, index + 1)
}

export const CHAMPIONSHIP_KEY = 'bynich.championship.v1'
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>

export function loadProgress(storage: StorageAccess): number {
  try {
    const value: unknown = JSON.parse(storage().getItem(CHAMPIONSHIP_KEY) ?? 'null')
    if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 || !('cleared' in value)) return 0
    const cleared = value.cleared
    return typeof cleared === 'number' && Number.isInteger(cleared) && cleared >= 0 && cleared <= STAGES.length ? cleared : 0
  } catch {
    return 0
  }
}

export function saveProgress(storage: StorageAccess, cleared: number): boolean {
  try {
    storage().setItem(CHAMPIONSHIP_KEY, JSON.stringify({ version: 1, cleared }))
    return true
  } catch {
    return false
  }
}
