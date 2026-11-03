export function playerPower(db: number, threshold: number): number {
  if (!Number.isFinite(db) || db < threshold) return 0
  const margin = db - threshold
  return margin <= 25 ? 0.35 + 0.65 * margin / 25 : Math.min(1.5, 1 + (margin - 25) / 24)
}

export function bullVoice(fury?: number): { power: number; roughness: number } {
  if (fury === undefined) return { power: 1, roughness: 0.1 }
  const level = Math.max(0, Math.min(4, fury))
  return { power: [0.6, 0.7, 0.78, 0.85, 0.9][level], roughness: level * 0.2 }
}
