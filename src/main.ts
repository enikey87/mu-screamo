import { analyzeFrame } from './core/analyze'
import { dailyBull } from './core/daily'
import { createRound, push, type Round, type View } from './core/round'
import { HUSH_MS, INVITE_MS, ROUND_MS } from './core/timing'
import { playCountdown } from './audio/count'
import { openMic, type Mic } from './audio/mic'
import { playBull } from './audio/voice'
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
const youFighter = required<HTMLElement>('#fighter-you')
const bullFighter = required<HTMLElement>('#fighter-bull')
const youBull = required<HTMLElement>('#you-bull')
const bullBull = required<HTMLElement>('#bull-bull')
const go = required<HTMLButtonElement>('#go')
const hint = required<HTMLElement>('#hint')
const privacy = required<HTMLElement>('#privacy')
const scoreboard = required<HTMLElement>('#scoreboard')
const gauge = required<HTMLElement>('.gauge')

let audio: AudioContext | null = null
let mic: Mic | null = null
let stopVoice: (() => void) | null = null
let stopCount: (() => void) | null = null
let frame = 0
let bout = 0
let running = false
let holding = false
let micBlocked = false
let round: Round | null = null
let bull = dailyBull(new Date())
let origin = 0
const dayLine = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

function showDay(date: Date): void {
  dateLabel.textContent = dayLine.format(date)
  const localDate = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  dateLabel.setAttribute('datetime', localDate)
}

showDay(new Date())

go.addEventListener('pointerdown', (event) => {
  if (audio?.state === 'suspended') void audio.resume()
  if (!running || mic) return
  holding = true
  try {
    go.setPointerCapture(event.pointerId)
  } catch {
    // iOS drops capture when the permission sheet stole the pointer.
  }
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

window.addEventListener('pagehide', release)

async function start(): Promise<void> {
  if (running) return
  bout += 1
  release()
  running = true
  holding = false
  go.disabled = true
  go.textContent = 'Включаем микрофон…'
  const ctx = context()
  unlock(ctx)
  const resumed = ctx.resume().catch(() => undefined)
  const opened = micBlocked
    ? Promise.resolve(null)
    : openMic(ctx).catch(() => {
        micBlocked = true
        return null
      })
  await resumed
  mic = await opened
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined)
  const today = new Date()
  bull = dailyBull(today)
  showDay(today)
  round = createRound(bull.segments)
  origin = ctx.currentTime
  stopCount = playCountdown(ctx, origin)
  stopVoice = playBull(ctx, bull, origin + (HUSH_MS + INVITE_MS) / 1000)
  go.hidden = mic !== null
  go.disabled = false
  go.textContent = 'Зажми и тяни'
  privacy.textContent = mic
    ? 'Микрофон включён на раунд. Записи нет.'
    : 'Без микрофона: удерживай кнопку вместо мычания.'
  render(push(round, { t: 0, db: -90, moo: false, hold: false }))
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
  if (mic) {
    const heard = analyzeFrame(mic.read(), mic.sampleRate)
    db = heard.db
    moo = heard.moo
  }
  const view = push(current, { t, db, moo, hold: holding && !mic })
  render(view)
  if (view.phase === 'done') {
    const id = bout
    release()
    window.setTimeout(() => {
      if (bout !== id) return
      go.hidden = false
      go.disabled = false
      go.textContent = 'Ещё раунд ↗'
    }, 900)
    return
  }
  frame = requestAnimationFrame(loop)
}

function render(view: View): void {
  scoreboard.hidden = false
  app.dataset.phase = view.phase
  app.dataset.breath = view.breath
  app.style.setProperty('--tug', view.tug.toFixed(3))
  app.classList.toggle('is-yours', view.tug > 0.08)
  app.classList.toggle('is-his', view.tug < -0.08)
  app.classList.toggle('is-ko', view.phase === 'done')
  youFighter.classList.toggle('is-hot', view.youHot)
  bullFighter.classList.toggle('is-hot', view.bullHot)
  youFighter.classList.toggle('is-lose', view.phase === 'done' && view.tug < -0.08)
  bullFighter.classList.toggle('is-lose', view.phase === 'done' && view.tug > 0.08)
  youBull.classList.toggle('is-fierce', view.youHot)
  bullBull.classList.toggle('is-fierce', view.bullHot)
  youBull.classList.toggle('is-pleased', view.phase === 'done' && view.tug > 0.08)
  bullBull.classList.toggle('is-pleased', view.phase === 'done' && view.tug < -0.08)
  youBull.classList.toggle('is-puzzled', view.phase === 'done' && view.tug < -0.08)
  bullBull.classList.toggle('is-puzzled', view.phase === 'done' && view.tug > 0.08)
  callout.classList.toggle('is-count', view.phase === 'hush' || view.phase === 'invite')
  if (callout.textContent !== view.shout) {
    callout.textContent = view.shout
    callout.classList.remove('is-pop')
    void callout.offsetWidth
    callout.classList.add('is-pop')
  }
  hint.textContent = view.hint
  gauge.setAttribute('aria-valuenow', String(Math.round(view.tug * 100)))
  gauge.setAttribute('aria-valuetext', view.tug > 0.08 ? 'Ты тянешь сильнее' : view.tug < -0.08 ? 'Бынич тянет сильнее' : 'Равные силы')
  if (view.phase === 'done') privacy.textContent = 'Раунд окончен. Микрофон выключен.'
  clock.style.transform = `scaleX(${Math.max(0, 1 - view.elapsed / ROUND_MS)})`
}

function unlock(ctx: AudioContext): void {
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
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
  stopCount?.()
  stopCount = null
}
