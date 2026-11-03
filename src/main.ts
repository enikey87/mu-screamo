import { analyzeFrame } from './core/analyze'
import { championshipStage, loadProgress, saveProgress, STAGES, winStage } from './core/championship'
import { dailyBull } from './core/daily'
import { createRound, push, type Round, type View } from './core/round'
import { startWith, tossStarter, type Starter } from './core/turn'
import { HUSH_MS, INVITE_MS, ROUND_MS } from './core/timing'
import { playCountdown } from './audio/count'
import { openMic, type Mic } from './audio/mic'
import { createPlayback } from './audio/output'
import { playBull } from './audio/voice'
import './style.css'

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`missing ${selector}`)
  return node
}

const app = required<HTMLElement>('#app')
const dateLabel = required<HTMLElement>('#date-label')
const editionLabel = required<HTMLElement>('#edition-label')
const stageMood = required<HTMLElement>('#stage-mood')
const stagePath = required<HTMLElement>('#stage-path')
const stageButtons = [...document.querySelectorAll<HTMLButtonElement>('.stage-step')]
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('.mode-nav button')]
const callout = required<HTMLElement>('#callout')
const tagline = required<HTMLElement>('.tagline')
const clock = required<HTMLElement>('#clock')
const youFighter = required<HTMLElement>('#fighter-you')
const bullFighter = required<HTMLElement>('#fighter-bull')
const youBull = required<HTMLElement>('#you-bull')
const bullBull = required<HTMLElement>('#bull-bull')
const bullName = required<HTMLElement>('#bull-name')
const go = required<HTMLButtonElement>('#go')
const hint = required<HTMLElement>('#hint')
const privacy = required<HTMLElement>('#privacy')
const scoreboard = required<HTMLElement>('#scoreboard')
const gauge = required<HTMLElement>('.gauge')
const advantage = required<HTMLElement>('#advantage')
const air = required<HTMLElement>('#air')
const airMeter = required<HTMLElement>('.air__track')
const airFill = required<HTMLElement>('#air-fill')
const airLabel = required<HTMLElement>('#air-label')
const championSeal = required<HTMLElement>('#champion-seal')
const saveNotice = required<HTMLElement>('#save-notice')
const coin = required<HTMLElement>('#coin-toss')
const breathCue = required<HTMLElement>('#breath-cue')
const breathMeter = required<HTMLElement>('#bull-breath-meter')
const breathFill = required<HTMLElement>('#bull-breath-fill')
const breathLabel = required<HTMLElement>('#bull-breath-label')

let audio: AudioContext | null = null
let mic: Mic | null = null
let stopVoice: (() => void) | null = null
let stopCount: (() => void) | null = null
let stopOutput: (() => void) | null = null
let cancelToss: (() => void) | null = null
let starter: Starter = 'bull'
let frame = 0
let bout = 0
let running = false
let holding = false
let micBlocked = false
let round: Round | null = null
let bull = dailyBull(new Date())
let origin = 0
let cleared = loadProgress(() => localStorage)
let stageIndex = Math.min(cleared, STAGES.length - 1)
let mode: 'daily' | 'championship' = location.hash === '#championship' ? 'championship' : 'daily'
let wonStage = false
let saved = true
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

function showPath(): void {
  stageButtons.forEach((button, index) => {
    button.disabled = index > cleared || running
    button.classList.toggle('is-cleared', index < cleared)
    button.textContent = index < cleared ? '✓' : String(index + 1)
    button.setAttribute('aria-label', `Встреча ${index + 1}: ${STAGES[index].title}${index < cleared ? ', пройдена' : ''}`)
    if (index === stageIndex) button.setAttribute('aria-current', 'step')
    else button.removeAttribute('aria-current')
  })
}

function resetArena(): void {
  delete app.dataset.phase
  delete app.dataset.breath
  delete app.dataset.starter
  delete app.dataset.finish
  delete app.dataset.echoCancellation
  app.dataset.mode = mode
  app.classList.remove('is-yours', 'is-his', 'is-ko', 'is-champion', 'is-exhausted')
  app.style.setProperty('--tug', '0')
  app.style.setProperty('--inhale', '0')
  advantage.textContent = 'Равные силы'
  for (const fighter of [youFighter, bullFighter]) {
    fighter.classList.remove('is-hot', 'is-lose', 'is-inhaling', 'is-scared')
    fighter.style.setProperty('--power', '0')
    fighter.style.setProperty('--fear', '0')
  }
  for (const face of [youBull, bullBull]) face.classList.remove('is-fierce', 'is-pleased', 'is-puzzled')
  callout.classList.remove('is-count', 'is-pop')
  scoreboard.hidden = true
  championSeal.hidden = true
  air.hidden = true
  breathCue.classList.remove('is-ready')
  breathMeter.setAttribute('aria-valuenow', '0')
  breathMeter.setAttribute('aria-valuetext', '')
  breathFill.style.transform = 'scaleX(0)'
  breathLabel.textContent = ''
}

function preview(): void {
  bout += 1
  release()
  round = null
  wonStage = false
  resetArena()
  go.hidden = false
  go.disabled = false
  dateLabel.hidden = mode === 'championship'
  stageMood.hidden = mode !== 'championship'
  stagePath.hidden = mode !== 'championship'
  saveNotice.hidden = saved || mode !== 'championship'
  showDay(new Date())
  modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)))
  const url = new URL(location.href)
  url.hash = mode === 'championship' ? 'championship' : ''
  history.replaceState(null, '', url)
  if (mode === 'championship') {
    const stage = championshipStage(stageIndex)
    app.dataset.scene = stage.scene.id
    app.dataset.fury = String(stage.fury)
    app.style.setProperty('--fury', String(stage.fury))
    app.style.setProperty('--bull-column', `${(stage.fury - 1) * 100 / 3}%`)
    editionLabel.textContent = `Встреча ${stageIndex + 1} / ${STAGES.length} · ${stage.scene.label}`
    stageMood.textContent = stage.mood
    bullName.textContent = `Бынич · ${stageIndex + 1}/5`
    callout.textContent = cleared === STAGES.length && stageIndex === STAGES.length - 1 ? 'Реванш чемпиона.' : `${stage.title}.`
    tagline.textContent = stage.intro
    hint.textContent = 'Громче «му» — сильнее тяга. Лови его вдох и береги воздух.'
    go.textContent = 'Выйти на луг ↗'
    privacy.textContent = 'Пять встреч. Прогресс сохраняется на этом устройстве.'
    showPath()
  } else {
    delete app.dataset.fury
    delete app.dataset.scene
    app.style.removeProperty('--fury')
    editionLabel.textContent = 'Дуэль дня'
    bullName.textContent = 'Бынич'
    callout.innerHTML = 'Ну что,<br />кто кого?'
    tagline.textContent = 'На лугу решают мычанием.'
    hint.innerHTML = 'Громче «му» — сильнее тяга.<br />Тяни на вдохе Бынича. Край шкалы — нокаут.'
    go.innerHTML = 'Принять вызов <span aria-hidden="true">↗</span>'
    privacy.textContent = 'Нужен микрофон. Голос остаётся у тебя.'
  }
}

modeButtons.forEach(button => button.addEventListener('click', () => {
  const next = button.dataset.mode
  if ((next !== 'daily' && next !== 'championship') || next === mode) return
  mode = next
  if (mode === 'championship') stageIndex = Math.min(cleared, STAGES.length - 1)
  preview()
}))
stageButtons.forEach((button, index) => button.addEventListener('click', () => {
  if (mode !== 'championship' || running || index > cleared) return
  stageIndex = index
  preview()
}))

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
go.addEventListener('pointerup', () => { holding = false })
go.addEventListener('pointercancel', () => { holding = false })
go.addEventListener('keydown', event => {
  if (running && !mic && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault()
    holding = true
  }
})
go.addEventListener('keyup', event => {
  if (event.key === ' ' || event.key === 'Enter') holding = false
})
go.addEventListener('blur', () => { holding = false })
go.addEventListener('click', () => {
  if (running) return
  if (mode === 'championship' && wonStage) {
    stageIndex = stageIndex < STAGES.length - 1 ? stageIndex + 1 : 0
    preview()
    return
  }
  void start()
})
window.addEventListener('pagehide', () => { bout += 1; release() })
window.addEventListener('blur', () => { holding = false })

preview()

async function start(): Promise<void> {
  if (running) return
  const id = ++bout
  release()
  resetArena()
  round = null
  running = true
  holding = false
  const today = new Date()
  const stage = mode === 'championship' ? championshipStage(stageIndex) : null
  starter = tossStarter(Math.random())
  bull = startWith(stage?.bull ?? dailyBull(today), starter)
  showDay(today)
  const coinReady = animateCoin(id, starter)
  go.disabled = true
  go.textContent = 'Готовимся к бою…'
  showPath()
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
  const openedMic = await opened
  if (id !== bout) { openedMic?.stop(); return }
  mic = openedMic
  const playback = mic ? await createPlayback(ctx) : null
  if (id !== bout) { playback?.stop(); return }
  stopOutput = playback?.stop ?? null
  const echoProtected = Boolean(mic?.echoCancellation && playback?.echoReference)
  app.dataset.echoCancellation = mic ? String(echoProtected) : 'unavailable'
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined)
  if (id !== bout) return
  await coinReady
  if (id !== bout) return
  coin.hidden = true
  round = createRound(bull.segments, stage?.rules)
  origin = ctx.currentTime
  stopCount = playCountdown(ctx, origin, playback?.destination)
  stopVoice = playBull(ctx, bull, origin + (HUSH_MS + INVITE_MS) / 1000, playback?.destination)
  go.hidden = mic !== null
  go.disabled = false
  go.textContent = 'Зажми и тяни'
  privacy.textContent = mic
    ? echoProtected ? 'Микрофон включён на раунд. Записи нет.' : 'Эхоподавление недоступно. Лучше играть в наушниках.'
    : mode === 'championship' ? 'Отпускай кнопку, чтобы набрать воздух.' : 'Без микрофона: удерживай кнопку вместо мычания.'
  render(push(round, { t: 0, db: -90, moo: false, hold: false }))
  if (!mic && go.matches(':active')) holding = true
  frame = requestAnimationFrame(loop)
}

function animateCoin(id: number, first: Starter): Promise<void> {
  app.dataset.phase = 'toss'
  app.dataset.starter = first
  coin.dataset.settled = 'false'
  coin.style.setProperty('--coin-stop', first === 'you' ? '1440deg' : '1620deg')
  void coin.offsetWidth
  coin.hidden = false
  callout.textContent = 'Бросаем монетку.'
  hint.textContent = 'Сейчас решим, кто начнёт.'
  return new Promise(resolve => {
    const reveal = window.setTimeout(() => {
      if (id !== bout) return
      coin.dataset.settled = 'true'
      callout.textContent = first === 'you' ? 'Первым мычишь ты!' : 'Первым мычит Бынич!'
      hint.textContent = first === 'you' ? 'Бынич начнёт со вдоха. Жди сигнала.' : 'Дождись вдоха Бынича — тогда твой выход.'
    }, 900)
    const ready = window.setTimeout(() => {
      if (id === bout) cancelToss = null
      resolve()
    }, 1800)
    cancelToss = () => {
      window.clearTimeout(reveal)
      window.clearTimeout(ready)
      cancelToss = null
      resolve()
    }
  })
}

function loop(): void {
  const ctx = audio
  const current = round
  if (!ctx || !current) return
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
    go.hidden = true
    if (mode === 'championship') {
      wonStage = view.pleased
      if (wonStage) {
        cleared = winStage(cleared, stageIndex)
        saved = saveProgress(() => localStorage, cleared)
        saveNotice.hidden = saved
        if (stageIndex === STAGES.length - 1) {
          app.classList.add('is-champion')
          callout.textContent = 'Чемпион луга!'
          hint.textContent = 'Бынич уступает титул. Луг за тобой.'
          championSeal.hidden = false
        } else hint.textContent = 'Встреча пройдена. Бынич уже злится — дальше будет жарче.'
      }
      showPath()
    }
    window.setTimeout(() => {
      if (bout !== id) return
      go.hidden = false
      go.disabled = false
      go.textContent = mode === 'daily' ? 'Ещё раунд ↗'
        : wonStage ? stageIndex === STAGES.length - 1 ? 'Пройти чемпионат снова ↗' : 'Следующая встреча ↗'
          : 'Попробовать ещё ↗'
    }, 900)
    return
  }
  frame = requestAnimationFrame(loop)
}

function render(view: View): void {
  const yours = view.tug > 0.08
  const his = view.tug < -0.08
  scoreboard.hidden = false
  app.dataset.phase = view.phase
  app.dataset.breath = view.breath
  if (view.finish) app.dataset.finish = view.finish
  else delete app.dataset.finish
  app.style.setProperty('--tug', view.tug.toFixed(3))
  app.classList.toggle('is-yours', yours)
  app.classList.toggle('is-his', his)
  app.classList.toggle('is-ko', view.finish === 'knockout')
  app.classList.toggle('is-exhausted', view.exhausted)
  bullFighter.classList.toggle('is-inhaling', view.inhale !== null)
  app.style.setProperty('--inhale', String(view.inhale === null ? 0 : Math.sin(view.inhale * Math.PI / 2)))
  advantage.textContent = view.phase === 'done'
    ? yours ? view.finish === 'knockout' ? 'Ты победил нокаутом' : 'Ты победил'
      : his ? view.finish === 'knockout' ? 'Бынич победил нокаутом' : 'Бынич победил' : 'Ничья'
    : yours ? 'Ты ведёшь' : his ? 'Бынич ведёт' : 'Равные силы'
  youFighter.style.setProperty('--power', String(view.youPower / 1.5))
  bullFighter.style.setProperty('--power', String(view.bullPower / 1.5))
  const yourFear = view.phase === 'listen' ? view.bullPower / 1.5 : 0
  const bullFear = view.phase === 'listen' ? view.youPower / 1.5 : 0
  youFighter.style.setProperty('--fear', String(yourFear))
  bullFighter.style.setProperty('--fear', String(bullFear))
  youFighter.classList.toggle('is-scared', yourFear > 0)
  bullFighter.classList.toggle('is-scared', bullFear > 0)
  youFighter.classList.toggle('is-hot', view.youHot)
  bullFighter.classList.toggle('is-hot', view.bullHot)
  youFighter.classList.toggle('is-lose', view.phase === 'done' && his)
  bullFighter.classList.toggle('is-lose', view.phase === 'done' && yours)
  youBull.classList.toggle('is-fierce', view.youHot)
  bullBull.classList.toggle('is-fierce', view.bullHot)
  youBull.classList.toggle('is-pleased', view.phase === 'done' && yours)
  bullBull.classList.toggle('is-pleased', view.phase === 'done' && his)
  youBull.classList.toggle('is-puzzled', view.phase === 'done' && his)
  bullBull.classList.toggle('is-puzzled', view.phase === 'done' && yours)
  callout.classList.toggle('is-count', view.phase === 'hush' || view.phase === 'invite')
  if (callout.textContent !== view.shout) {
    callout.textContent = view.shout
    callout.classList.remove('is-pop')
    void callout.offsetWidth
    callout.classList.add('is-pop')
  }
  hint.textContent = view.phase === 'hush' || view.phase === 'invite'
    ? `${starter === 'you' ? 'Первым мычишь ты' : 'Первым мычит Бынич'}. Жди сигнала.` : view.hint
  const inhale = view.inhale ?? 0
  breathFill.style.transform = `scaleX(${inhale})`
  breathMeter.setAttribute('aria-valuenow', String(Math.floor(inhale * 100)))
  breathCue.classList.toggle('is-ready', inhale >= .8)
  const remaining = view.inhaleRemaining
  const seconds = remaining === null ? '' : (Math.ceil(remaining / 100) / 10).toFixed(1).replace('.', ',')
  breathLabel.textContent = remaining === null ? ''
    : `${view.elapsed + remaining >= ROUND_MS ? 'Финиш через' : 'До «му»'} ${seconds} с`
  breathMeter.setAttribute('aria-valuetext', breathLabel.textContent)
  air.hidden = view.air === null
  if (view.air !== null) {
    airFill.style.transform = `scaleX(${view.air})`
    airMeter.setAttribute('aria-valuenow', String(Math.round(view.air * 100)))
    airLabel.textContent = view.exhausted ? 'Сделай паузу' : view.youHot ? 'Расходуется' : 'Молчишь — восстанавливаешь'
  }
  gauge.setAttribute('aria-valuenow', String(Math.round(view.tug * 100)))
  gauge.setAttribute('aria-valuetext', advantage.textContent)
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
  cancelToss?.()
  coin.hidden = true
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
  stopOutput?.()
  stopOutput = null
}
