export function formatShare(label: string, stamp: string, mooMs: number): string {
  const sec = (Math.max(0, mooMs) / 1000).toFixed(1)
  return `${label} · ${stamp} · ${sec}с`
}
