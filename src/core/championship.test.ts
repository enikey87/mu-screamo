import { describe, expect, it } from 'vitest'
import { championshipStage, loadProgress, saveProgress, winStage, CHAMPIONSHIP_KEY, STAGES } from './championship'

function memory(value: string | null = null) {
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next } }
}

describe('meadow championship', () => {
  it('moves from the fence through the yard to the evening meadow', () => {
    expect(STAGES.map(stage => stage.scene)).toEqual([
      { id: 'fence', label: 'У изгороди' },
      { id: 'fence', label: 'У изгороди' },
      { id: 'yard', label: 'Во дворе' },
      { id: 'yard', label: 'Во дворе' },
      { id: 'evening', label: 'Вечерний луг' },
    ])
  })

  it('has five progressively fiercer, complete and distinct encounters', () => {
    expect(STAGES).toHaveLength(5)
    expect(new Set(STAGES.map(stage => JSON.stringify(stage.bull.segments))).size).toBe(5)
    STAGES.forEach((stage, index) => {
      expect(stage.bull.segments.reduce((sum, segment) => sum + segment.ms, 0)).toBe(8000)
      expect(stage.bull.segments.every(segment => segment.ms >= 400)).toBe(true)
      expect(stage.fury).toBe(index)
      expect(stage.intro.length).toBeGreaterThan(10)
      expect(stage.bull.pitch).toBeGreaterThan(70)
      if (index > 0) {
        expect(stage.rules.bullForce).toBeGreaterThan(STAGES[index - 1].rules.bullForce)
        expect(stage.rules.airMs).toBeLessThan(STAGES[index - 1].rules.airMs)
      }
      expect(championshipStage(index)).toBe(stage)
    })
  })

  it.each([-1, 5, 1.5, NaN, Infinity])('rejects invalid encounter %s', index => {
    expect(() => championshipStage(index)).toThrow(RangeError)
  })

  it('unlocks only a won available stage and never loses earned progress', () => {
    expect(winStage(0, 0)).toBe(1)
    expect(winStage(0, 1)).toBe(0)
    expect(winStage(2, 0)).toBe(2)
    expect(winStage(2, 2)).toBe(3)
    expect(winStage(4, 4)).toBe(5)
    expect(winStage(5, 4)).toBe(5)
    expect(winStage(1, -1)).toBe(1)
    expect(winStage(1, 1.5)).toBe(1)
    expect(winStage(5, 5)).toBe(5)
  })
})

describe('championship save', () => {
  it('starts fresh, saves wins and restores completion', () => {
    const storage = memory()
    expect(loadProgress(() => storage)).toBe(0)
    expect(saveProgress(() => storage, 3)).toBe(true)
    expect(loadProgress(() => storage)).toBe(3)
    expect(saveProgress(() => storage, 5)).toBe(true)
    expect(loadProgress(() => storage)).toBe(5)
    expect(CHAMPIONSHIP_KEY).toBe('bynich.championship.v1')
  })

  it.each(['', 'oops', 'null', '3', '{}', '[]', '{"version":2,"cleared":3}', '{"version":1,"cleared":-1}', '{"version":1,"cleared":6}', '{"version":1,"cleared":1.5}', '{"version":1,"cleared":"2"}'])('ignores corrupt or incompatible save %s', value => {
    expect(loadProgress(() => memory(value))).toBe(0)
  })

  it('keeps the game playable when access, reading or writing is blocked', () => {
    const blocked = () => { throw new DOMException('Blocked', 'SecurityError') }
    expect(loadProgress(blocked)).toBe(0)
    expect(saveProgress(blocked, 1)).toBe(false)
    const storage = { getItem: blocked, setItem: blocked }
    expect(loadProgress(() => storage)).toBe(0)
    expect(saveProgress(() => storage, 1)).toBe(false)
  })
})
