import { LISTEN_MS, TARGET_INHALE_MS } from './timing'

export interface Segment {
  kind: 'voice' | 'inhale'
  ms: number
}

export interface DailyBull {
  dateKey: string
  label: string
  pitch: number
  segments: Segment[]
}

export function dateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dateLabel(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${d}.${m}`
}

export function dailyBull(date: Date): DailyBull {
  const key = dateKey(date)
  const rand = mulberry32(fnv(key))
  const pairs = rand() > 0.45 ? 4 : 3
  const voiceRaw: number[] = []
  const inhaleRaw: number[] = []
  for (let i = 0; i < pairs; i++) {
    voiceRaw.push(700 + rand() * 900)
    inhaleRaw.push(500 + rand() * 800)
  }
  const voices = apportion(voiceRaw, LISTEN_MS - TARGET_INHALE_MS)
  const inhales = apportion(inhaleRaw, TARGET_INHALE_MS)
  const segments: Segment[] = []
  for (let i = 0; i < pairs; i++) {
    segments.push({ kind: 'voice', ms: voices[i] })
    segments.push({ kind: 'inhale', ms: inhales[i] })
  }
  return {
    dateKey: key,
    label: dateLabel(date),
    pitch: Math.round(98 + rand() * 36),
    segments,
  }
}

export function breathAt(segments: Segment[], offsetMs: number): 'voice' | 'inhale' {
  let acc = 0
  for (const seg of segments) {
    if (offsetMs < acc + seg.ms) return seg.kind
    acc += seg.ms
  }
  return segments.length > 0 ? segments[segments.length - 1].kind : 'inhale'
}

export function segmentEndOffset(segments: Segment[], offsetMs: number): number {
  let acc = 0
  for (const seg of segments) {
    acc += seg.ms
    if (offsetMs < acc) return acc
  }
  return acc
}

function apportion(raw: number[], target: number): number[] {
  const sum = raw.reduce((acc, v) => acc + v, 0)
  const exact = raw.map((v) => (v / sum) * target)
  const floors = exact.map((v) => Math.floor(v))
  let left = target - floors.reduce((acc, v) => acc + v, 0)
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  for (const slot of order) {
    if (left <= 0) break
    floors[slot.i] += 1
    left -= 1
  }
  return floors
}

function fnv(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
