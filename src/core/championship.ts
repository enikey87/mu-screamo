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
  rules: RoundRules
}

const SCENES = {
  fence: { id: 'fence', label: 'У изгороди' },
  yard: { id: 'yard', label: 'Во дворе' },
  evening: { id: 'evening', label: 'Вечерний луг' },
} as const

function encounter(title: string, scene: ChampionshipStage['scene'], mood: string, intro: string, fury: number, pitch: number, airMs: number, durations: number[]): ChampionshipStage {
  const segments: Segment[] = durations.map((ms, index) => ({ kind: index % 2 === 0 ? 'voice' : 'inhale', ms }))
  return {
    title, scene, mood, intro, fury,
    bull: { dateKey: `championship-${fury}`, label: title, pitch, fury, segments },
    rules: { airMs, recoveryRate: 1.5, recoverAt: 0.4, bullForce: bullVoice(fury).power },
  }
}

export const STAGES: readonly ChampionshipStage[] = [
  encounter('Разминка', SCENES.fence, 'Спросонья', '«Ты меня ради этого разбудил? Ладно, мычи».', 0, 125, 2600, [400, 1800, 600, 1800, 600, 2800]),
  encounter('Упрямство', SCENES.fence, 'Собрался', '«Это была разминка. Теперь я готов». Лови ровный ритм.', 1, 118, 2400, [800, 1200, 800, 1200, 800, 1200, 800, 1200]),
  encounter('Вызов', SCENES.yard, 'Сердится', '«Думаешь, разгадал меня?» Длина вдохов теперь разная.', 2, 110, 2300, [1000, 1500, 1100, 1000, 1200, 2200]),
  encounter('Ярость', SCENES.yard, 'Взбешён', '«Всё. Хватит поддавков». Береги воздух для коротких пауз.', 3, 102, 2100, [1000, 1000, 600, 1000, 1100, 600, 1300, 1400]),
  encounter('Финал', SCENES.evening, 'Разъярён', '«Луг. Пока ещё. Мой». В середине боя Бынич ускорится.', 4, 94, 1900, [1600, 1400, 1200, 1200, 500, 500, 700, 900]),
]

export function championshipStage(index: number): ChampionshipStage {
  if (!Number.isInteger(index) || index < 0 || index >= STAGES.length) throw new RangeError('invalid championship stage')
  return STAGES[index]
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
