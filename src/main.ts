import { analyzeFrame } from './core/analyze'
import { dailyBull, type DailyBull } from './core/daily'
import { createRound, push, type Round, type View } from './core/round'
import { formatShare } from './core/share'
import { HUSH_MS, INVITE_MS, ROUND_MS } from './core/timing'
import { openMic, type Mic } from './audio/mic'
import { playBull } from './audio/voice'
import { drawCard } from './ui/card'
import './style.css'

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`missing ${selector}`)
  return node
}

const app = required<HTMLElement>('#app')
const dateLabel = required<HTMLElement>('#date-label')
const callout = required<HTMLElement>('#callout')
const clock = required<HTMLElement>('#clock')
const stageBull = required<HTMLElement>('#stage-bull')
const bullSvg = required<SVGElement>('#bull')
const line = required<HTMLElement>('#line')
const go = required<HTMLButtonElement>('#go')
const hint = required<HTMLElement>('#hint')
const dialog = required<HTMLDialogElement>('#card-dialog')
const canvas = required<HTMLCanvasElement>('#card')
const save = required<HTMLButtonElement>('#save')
const copy = required<HTMLButtonElement>('#copy')
const again = required<HTMLButtonElement>('#again')

let audio: AudioContext | null = null
let mic: Mic | null = null
let stopVoice: (() => void) | null = null
let frame = 0
let bout = 0
let running = false
let holding = false
let micBlocked = false
let round: Round | null = null
let bull: DailyBull | null = null
let shareText = ''
let origin = 0

const today = dailyBull(new Date())
dateLabel.textContent = `${today.label} · дневной бык`

go.addEventListener('pointerdown', (event) => {
  if (!running || mic) return
  holding = true
  go.setPointerCapture(event.pointerId)
})
go.addEventListener('pointerup', () => {
  holding = false
})
go.addEventListener('pointercancel', () => {
  holding = false
})
go.addEventListener('click', () => {
  if (running) return
  void start()
})

save.addEventListener('click', () => {
  canvas.toBlob((blob) => {
    if (!blob || !bull) return
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `bynich-${bull.dateKey}.png`
    link.click()
    URL.revokeObjectURL(link.href)
  })
})

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shareText)
    copy.textContent = 'Строка скопирована'
  } catch {
    copy.textContent = shareText
  }
})

again.addEventListener('click', () => {
  dialog.close()
  void start()
})

window.addEventListener('pagehide', release)

const params = new URLSearchParams(location.search)
if (params.has('card')) showPreview()

async function start(): Promise<void> {
  if (running) return
  bout += 1
  release()
  running = true
  holding = false
  copy.textContent = 'Скопировать строку'
  go.disabled = true
  const ctx = context()
  const resumed = ctx.resume().catch(() => undefined)
  const opened = micBlocked
    ? Promise.resolve(null)
    : openMic(ctx).catch(() => {
        micBlocked = true
        return null
      })
  await resumed
  mic = await opened
  bull = dailyBull(new Date())
  dateLabel.textContent = `${bull.label} · дневной бык`
  round = createRound(bull.segments)
  origin = ctx.currentTime
  stopVoice = playBull(ctx, bull, origin + (HUSH_MS + INVITE_MS) / 1000)
  go.hidden = mic !== null
  go.disabled = false
  go.textContent = 'Держи'
  if (!mic && go.matches(':active')) holding = true
  frame = requestAnimationFrame(loop)
}

function loop(): void {
  const ctx = audio
  const current = round
  const voice = bull
  if (!ctx || !current || !voice) return
  const t = (ctx.currentTime - origin) * 1000
  let db = -90
  let moo = false
  let f0 = 0
  if (mic) {
    const heard = analyzeFrame(mic.read(), mic.sampleRate)
    db = heard.db
    moo = heard.moo
    f0 = heard.f0
  }
  const view = push(current, { t, db, moo, f0, hold: holding && !mic })
  render(view)
  if (view.phase === 'done') {
    const snapshot = view
    const fought = voice
    const id = bout
    release()
    window.setTimeout(() => {
      if (bout !== id) return
      finish(snapshot, fought)
    }, 900)
    return
  }
  frame = requestAnimationFrame(loop)
}

function render(view: View): void {
  app.dataset.phase = view.phase
  app.dataset.breath = view.breath
  app.style.setProperty('--tug', view.tug.toFixed(3))
  app.classList.toggle('is-yours', view.tug > 0.08)
  app.classList.toggle('is-his', view.tug < -0.08)
  app.classList.toggle('is-shake', view.phase === 'invite' && view.proximity > 0.45)
  stageBull.style.setProperty('--proximity', view.proximity.toFixed(3))
  stageBull.style.setProperty('--cheeks', view.cheeks.toFixed(3))
  bullSvg.classList.toggle('is-pleased', view.pleased)
  bullSvg.classList.toggle('is-puzzled', view.puzzled)
  callout.textContent = view.shout
  line.textContent = view.line
  hint.textContent = view.hint
  clock.style.transform = `scaleX(${Math.max(0, 1 - view.elapsed / ROUND_MS)})`
}

function finish(view: View, voice: DailyBull): void {
  release()
  shareText = formatShare(voice.label, view.stamp, view.mooMs)
  drawCard(canvas, {
    label: voice.label,
    text: view.text,
    stamp: view.stamp,
    share: shareText,
    waveform: view.waveform,
    pleased: view.pleased,
  })
  if (!dialog.open) dialog.showModal()
  go.hidden = false
  go.disabled = false
  go.textContent = 'В бой'
}

function showPreview(): void {
  const voice = dailyBull(new Date())
  shareText = formatShare(voice.label, 'опись', 4200)
  drawCard(canvas, {
    label: voice.label,
    text: 'Прошу внести в опись одно (1) мууу.',
    stamp: 'опись',
    share: shareText,
    waveform: Array.from({ length: 64 }, (_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i / 5))),
    pleased: true,
  })
  dialog.showModal()
}

function context(): AudioContext {
  if (!audio) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audio = new Ctx()
  }
  return audio
}

function release(): void {
  running = false
  holding = false
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  mic?.stop()
  mic = null
  stopVoice?.()
  stopVoice = null
}
