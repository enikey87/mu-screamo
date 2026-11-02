export interface Phrase {
  id: string
  stamp: string
  text: string
  minWeightedMs: number
}

export const PHRASES: readonly Phrase[] = [
  { id: 'wait', stamp: 'ожидание', text: 'Я подожду.', minWeightedMs: 0 },
  { id: 'mu', stamp: 'му', text: 'Му.', minWeightedMs: 400 },
  { id: 'muu', stamp: 'муу', text: 'Муу.', minWeightedMs: 800 },
  { id: 'note', stamp: 'заметка', text: 'Зафиксировано: муу.', minWeightedMs: 1_300 },
  { id: 'heed', stamp: 'сведение', text: 'Прошу принять к сведению: мууу.', minWeightedMs: 1_900 },
  { id: 'inbox', stamp: 'входящее', text: 'Входящее мычание зарегистрировано.', minWeightedMs: 2_500 },
  { id: 'inventory', stamp: 'опись', text: 'Прошу внести в опись одно (1) мууу.', minWeightedMs: 3_400 },
  {
    id: 'horns',
    stamp: 'рога',
    text: 'Прошу внести в опись одно (1) мууу и приложить рога.',
    minWeightedMs: 4_000,
  },
  {
    id: 'act',
    stamp: 'акт',
    text: 'Акт приёма-передачи мычания составлен в одном экземпляре.',
    minWeightedMs: 4_400,
  },
  {
    id: 'vowel',
    stamp: 'гласная',
    text: 'Настоящим подтверждается непрерывность гласной «у».',
    minWeightedMs: 4_800,
  },
  {
    id: 'agreed',
    stamp: 'протокол',
    text: 'Протокол согласован без замечаний. Экземпляр — у микрофона.',
    minWeightedMs: 5_200,
  },
  {
    id: 'notice',
    stamp: 'уведомление',
    text: 'Прошу считать настоящее мычание надлежащим уведомлением всех присутствующих копыт.',
    minWeightedMs: 5_600,
  },
]

export interface Score {
  weightedMs: number
  mooMs: number
  screamMs: number
  /** 1 — высота «у» не плавает */
  stability: number
}

export function selectPhrase(score: Score): Phrase {
  const drowned =
    score.mooMs < 350 || (score.screamMs > score.mooMs * 1.4 && score.mooMs < 800)
  if (drowned) return PHRASES[0]
  let index = 0
  for (let i = 1; i < PHRASES.length; i++) {
    if (score.weightedMs >= PHRASES[i].minWeightedMs) index = i
  }
  if (score.stability >= 0.75 && index >= 6 && index < PHRASES.length - 1) index += 1
  return PHRASES[index]
}

export function revealedLine(score: Score, done: boolean): string {
  const phrase = selectPhrase(score)
  if (done) return phrase.text
  if (phrase.id === 'wait') return ''
  const index = PHRASES.indexOf(phrase)
  const next =
    index + 1 < PHRASES.length ? PHRASES[index + 1].minWeightedMs : phrase.minWeightedMs + 600
  const span = Math.max(1, next - phrase.minWeightedMs)
  const ratio = clamp01((score.weightedMs - phrase.minWeightedMs) / span)
  const count = Math.max(1, Math.ceil(ratio * phrase.text.length))
  return phrase.text.slice(0, count)
}

function clamp01(v: number): number {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}
