export interface Frame {
  db: number
  f0: number
  clarity: number
  centroid: number
  lowShare: number
  moo: boolean
}

const F0_MIN = 70
const F0_MAX = 460
const MIN_CLARITY = 0.4
const MAX_CENTROID = 850
const MAX_F2 = 1300
const MIN_LOW_SHARE = 0.7

export function rmsDb(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / (samples.length || 1))
  return 20 * Math.log10(Math.max(rms, 1e-6))
}

export function analyzeFrame(samples: Float32Array, sampleRate: number): Frame {
  const db = rmsDb(samples)
  const reduced = decimate(samples, 4)
  const { f0, clarity } = estimatePitch(reduced, sampleRate / 4, F0_MIN, F0_MAX)
  const { centroid, lowShare, f2 } = spectrumFeatures(samples, sampleRate)
  const voiced = clarity >= MIN_CLARITY && f0 >= F0_MIN && f0 <= F0_MAX
  const vowelU =
    centroid > 0 &&
    centroid <= MAX_CENTROID &&
    (f2 === 0 || f2 <= MAX_F2) &&
    lowShare >= MIN_LOW_SHARE
  return { db, f0, clarity, centroid, lowShare, moo: voiced && vowelU }
}

function decimate(samples: Float32Array, factor: number): Float32Array {
  const n = Math.floor(samples.length / factor)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const base = i * factor
    for (let k = 0; k < factor; k++) sum += samples[base + k]
    out[i] = sum / factor
  }
  return out
}

function estimatePitch(
  samples: Float32Array,
  sampleRate: number,
  f0Min: number,
  f0Max: number,
): { f0: number; clarity: number } {
  const n = samples.length
  const minLag = Math.max(2, Math.floor(sampleRate / f0Max))
  const maxLag = Math.min(Math.floor(sampleRate / f0Min), Math.floor(n / 2))
  if (maxLag <= minLag) return { f0: 0, clarity: 0 }

  let mean = 0
  for (let i = 0; i < n; i++) mean += samples[i]
  mean /= n
  const x = new Float32Array(n)
  let energy = 0
  for (let i = 0; i < n; i++) {
    const v = samples[i] - mean
    x[i] = v
    energy += v * v
  }
  if (energy < 1e-9) return { f0: 0, clarity: 0 }

  const corr = new Float32Array(maxLag + 2)
  let bestLag = 0
  let bestCorr = 0
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let num = 0
    let e1 = 0
    let e2 = 0
    for (let i = 0; i + lag < n; i++) {
      const a = x[i]
      const b = x[i + lag]
      num += a * b
      e1 += a * a
      e2 += b * b
    }
    const c = num / Math.sqrt(e1 * e2 + 1e-12)
    corr[lag] = c
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const c = corr[lag]
    if (c > bestCorr && c > corr[lag - 1] && c >= corr[lag + 1]) {
      bestCorr = c
      bestLag = lag
    }
  }
  if (!bestLag) return { f0: 0, clarity: bestCorr }
  const c0 = corr[bestLag - 1]
  const c1 = corr[bestLag]
  const c2 = corr[bestLag + 1]
  const denom = c0 - 2 * c1 + c2
  const delta = denom !== 0 ? (0.5 * (c0 - c2)) / denom : 0
  const lag = bestLag + (delta > 0.5 ? 0.5 : delta < -0.5 ? -0.5 : delta)
  return { f0: sampleRate / lag, clarity: bestCorr }
}

function spectrumFeatures(
  samples: Float32Array,
  sampleRate: number,
): { centroid: number; lowShare: number; f2: number } {
  const n = samples.length
  if (n < 256 || (n & (n - 1)) !== 0) return { centroid: 0, lowShare: 0, f2: 0 }
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    re[i] = samples[i] * w
  }
  fftInPlace(re, im)
  const binHz = sampleRate / n
  let total = 0
  let low = 0
  let centNum = 0
  let f2 = 0
  let f2Power = 0
  for (let k = 1; k < n >> 1; k++) {
    const f = k * binHz
    // Ниже 150 Гц лежит основной тон, гласная «у» живёт в гармониках над ним.
    if (f < 150 || f > 4000) continue
    const power = re[k] * re[k] + im[k] * im[k]
    total += power
    centNum += f * power
    if (f <= 1000) low += power
    if (f >= 500 && f <= 1600 && power > f2Power) {
      f2Power = power
      f2 = f
    }
  }
  return {
    centroid: total > 0 ? centNum / total : 0,
    lowShare: total > 0 ? low / total : 0,
    f2,
  }
}

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(step * k)
        const wi = Math.sin(step * k)
        const a = i + k
        const b = a + half
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}
