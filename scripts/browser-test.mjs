import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { preview } from 'vite'

const scratch = await mkdtemp(join(tmpdir(), 'mu-screamo-browser-'))
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } })
const chrome = spawn(process.env.CHROME_BIN ?? 'google-chrome', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream', '--remote-debugging-port=0',
  `--user-data-dir=${join(scratch, 'profile')}`, 'about:blank',
], { stdio: 'ignore' })
let launchError
chrome.on('error', error => { launchError = error })
let socket
const errors = []
let id = 0
let navigation = 0
const pending = new Map()

async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await pause(100)
  }
  throw new Error(`Timed out: ${label}`)
}

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(requestId, { resolve, reject, timer })
    socket.send(JSON.stringify({ id: requestId, method, params }))
  })
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails))
  return response.result.value
}

async function screenshot(name) {
  const { data } = await call('Page.captureScreenshot', { captureBeyondViewport: true })
  await writeFile(join(scratch, `${name}.png`), Buffer.from(data, 'base64'))
}

async function loaded(url) {
  const destination = new URL(url)
  destination.searchParams.set('browser-load', String(++navigation))
  await call('Page.navigate', { url: destination.href })
  await until(() => evaluate(`Boolean(document.querySelector('#date-label')?.textContent)`), 'app module loaded')
  await until(() => evaluate(`[...document.images].length === 8 && [...document.images].every(i => i.complete && i.naturalWidth > 0)`), 'all bull images loaded')
}

const stageScenes = [['fence', 'У изгороди'], ['fence', 'У изгороди'], ['yard', 'Во дворе'], ['yard', 'Во дворе'], ['evening', 'Вечерний луг']]

async function assertScene(scene, label) {
  const view = await evaluate(`(() => {
    const scenery = getComputedStyle(document.querySelector('.arena'), '::before');
    return { scene: document.querySelector('#app').dataset.scene,
      edition: document.querySelector('#edition-label').textContent,
      image: scenery.backgroundImage, content: scenery.content, opacity: Number(scenery.opacity),
      pointerEvents: scenery.pointerEvents };
  })()`)
  assert.equal(view.scene, scene)
  assert.ok(view.edition.endsWith(label), `location label must name ${label}: ${view.edition}`)
  assert.ok(view.image.includes(`arena-${scene}.webp`), `visible background must match ${scene}: ${view.image}`)
  assert.notEqual(view.content, 'none')
  assert.ok(view.opacity > 0)
  assert.equal(view.pointerEvents, 'none', 'scenery must not intercept game controls')
  const source = view.image.match(/url\(["']?([^"')]+)["']?\)/)?.[1]
  assert.ok(source, 'scene must reference an image')
  const size = await evaluate(`(async () => {
    const image = new Image(); image.src = ${JSON.stringify(source)};
    await image.decode(); return [image.naturalWidth, image.naturalHeight];
  })()`)
  assert.ok(size[0] >= 600 && size[1] >= 400, `scene asset must decode at usable resolution: ${size}`)
}

async function assertAdvantage(kind, label) {
  const colors = { even: 'rgb(135, 103, 44)', you: 'rgb(25, 115, 74)', bull: 'rgb(182, 59, 42)' }
  const value = await evaluate(`(() => {
    const label = document.querySelector('#advantage');
    return { text: label?.textContent, color: label && getComputedStyle(label).color,
      marker: getComputedStyle(document.querySelector('.gauge__mark')).borderTopColor,
      you: getComputedStyle(document.querySelector('.gauge__you')).backgroundColor,
      bull: getComputedStyle(document.querySelector('.gauge__track')).backgroundColor };
  })()`)
  assert.equal(value.text, label)
  assert.equal(value.color, colors[kind])
  assert.equal(value.marker, colors[kind])
  assert.equal(value.you, colors.you)
  assert.equal(value.bull, colors.bull)
}

async function checkInhale(reduced = false) {
  await until(() => evaluate(`document.querySelector('#fighter-bull').classList.contains('is-inhaling') && Number(document.querySelector('#app').style.getPropertyValue('--inhale')) > 0.05 && Number(document.querySelector('#app').style.getPropertyValue('--inhale')) < 0.45`), 'visible inhale starts with the breathing window')
  const first = await evaluate(`getComputedStyle(document.querySelector('#bull-bull')).transform`)
  await pause(100)
  assert.equal(await evaluate(`document.querySelector('#fighter-bull').classList.contains('is-inhaling')`), true)
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('#bull-bull')).transform`), first, 'bull expands during its inhale')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.breath-cue')).display === 'none'`), false)
  assert.equal(await evaluate(`document.querySelector('#bull-bull').classList.contains('is-fierce')`), false, 'mouth closes on inhale')
  if (reduced) {
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#bull-bull')).transform`), 'none')
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#fighter-bull .fighter__body')).animationName`), 'none')
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.breath-cue')).display === 'none'`), false)
    await call('Emulation.setEmulatedMedia', { features: [] })
  }
}

const state = () => evaluate(`({
  phase: document.querySelector('#app').dataset.phase,
  breath: document.querySelector('#app').dataset.breath,
  title: document.querySelector('#callout').textContent,
  button: document.querySelector('#go').textContent,
  hidden: document.querySelector('#go').hidden,
  disabled: document.querySelector('#go').disabled,
  privacy: document.querySelector('#privacy').textContent,
  requests: window.__micRequests,
  loser: document.querySelector('.fighter.is-lose')?.id,
  meter: Number(document.querySelector('.gauge').getAttribute('aria-valuenow'))
})`)

try {
  const url = server.resolvedUrls.local[0]
  let port
  await until(async () => {
    if (launchError) throw launchError
    try { port = Number((await readFile(join(scratch, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]); return port > 0 } catch { return false }
  }, 'Chrome debugging port')
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = pages.find(page => page.type === 'page')
  assert.ok(target, 'Chrome must expose a page')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  }
  await call('Page.enable')
  await call('Runtime.enable')
  const denied = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__micRequests = 0;
    navigator.mediaDevices.getUserMedia = () => {
      window.__micRequests++;
      return new Promise((_, reject) => { window.__denyMic = () => reject(new DOMException('Denied', 'NotAllowedError')); });
    };
  ` })
  const unlocked = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('bynich.championship.v1', JSON.stringify({ version: 1, cleared: 5 }));
  ` })
  await loaded(`${url}#championship`)
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  for (const stage of [0, 1, 2, 3, 4, 2, 0, 4]) {
    await evaluate(`document.querySelector('.stage-step[data-stage="${stage}"]').click()`)
    await assertScene(...stageScenes[stage])
    if ([0, 2, 4].includes(stage)) await screenshot(`location-${stageScenes[stage][0]}`)
  }
  await evaluate(`document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '* { transition: none !important; }' }))`)
  for (const [width, height] of [[320, 844], [280, 844], [320, 568], [350, 844], [360, 800], [375, 844], [390, 844], [520, 900], [521, 900], [844, 390], [1280, 900]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const violation = await evaluate(`(() => {
      const app = document.querySelector('#app');
      const steps = [...document.querySelectorAll('.stage-step')];
      if (steps.length !== 5 || steps.some(step => step.disabled)) return { error: 'all five encounters must be available' };
      for (const [stage, step] of steps.entries()) {
        step.click();
        const fighter = document.querySelector('#fighter-bull');
        const bull = document.querySelector('#bull-bull');
        const you = document.querySelector('#fighter-you');
        for (const pose of ['ready', 'voice', 'inhale']) {
          fighter.classList.toggle('is-hot', pose === 'voice');
          fighter.classList.toggle('is-inhaling', pose === 'inhale');
          bull.classList.toggle('is-fierce', pose === 'voice');
          you.classList.toggle('is-hot', pose !== 'ready');
          app.style.setProperty('--inhale', pose === 'inhale' ? '1' : '0');
          for (const pull of [-0.99, 0, 0.99]) {
            app.style.setProperty('--tug', String(pull));
            for (const progress of [0, 0.32, 0.68]) {
              for (const body of document.querySelectorAll('.fighter__body')) {
                const duration = parseFloat(getComputedStyle(body).animationDuration) * 1000;
                for (const animation of body.getAnimations()) {
                  animation.pause();
                  animation.currentTime = progress * duration;
                }
              }
              const poster = app.getBoundingClientRect();
              for (const art of [stage === 0 ? bull : bull.querySelector('.bull__championship'), document.querySelector('#you-bull')]) {
                const bounds = art.getBoundingClientRect();
                if (bounds.width <= 0 || bounds.left < poster.left || bounds.right > poster.right) {
                  return { stage, pose, pull, progress, art: art.className,
                    left: bounds.left, right: bounds.right, posterLeft: poster.left, posterRight: poster.right };
                }
              }
            }
          }
        }
      }
      return null;
    })()`)
    if (violation || width === 320 || width === 390 || width === 1280) await screenshot(`championship-bounds-${width}-${height}`)
    assert.equal(violation, null, `championship art clipped at ${width}×${height}: ${JSON.stringify(violation)}`)
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'championship must not scroll horizontally')
  }
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: unlocked.identifier })
  for (const cleared of [0, 2, 4]) {
    await evaluate(`localStorage.setItem('bynich.championship.v1', JSON.stringify({ version: 1, cleared: ${cleared} }))`)
    await loaded(`${url}#championship`)
    await assertScene(...stageScenes[cleared])
  }
  await call('Network.enable')
  await call('Network.setCacheDisabled', { cacheDisabled: true })
  await call('Network.setBlockedURLs', { urls: ['*arena-evening.webp*'] })
  await loaded(`${url}#championship`)
  assert.equal(await evaluate(`fetch(new URL('art/arena-evening.webp', location.href)).then(r => r.ok, () => false)`), false)
  assert.equal(await evaluate(`document.querySelector('#app').dataset.scene`), 'evening')
  assert.match(await evaluate(`getComputedStyle(document.querySelector('#app')).backgroundImage`), /linear-gradient/)
  await evaluate(`document.querySelector('#go').click(); window.__denyMic()`)
  await until(async () => (await state()).phase === 'hush', 'round starts with unavailable scenery')
  assert.equal((await state()).disabled, false)
  await evaluate(`document.querySelector('.mode-nav [data-mode="daily"]').click()`)
  assert.equal(await evaluate(`document.querySelector('#app').dataset.scene`), undefined)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.arena'), '::before').backgroundImage`), 'none')
  await call('Network.setBlockedURLs', { urls: [] })
  await call('Network.setCacheDisabled', { cacheDisabled: false })
  await evaluate(`localStorage.removeItem('bynich.championship.v1')`)
  console.log('PASS: both bulls fit all five championship stages at pull and animation extremes across eleven screen sizes')
  console.log('PASS: championship scenes follow stage selection, replay selection and restored progress')
  console.log('PASS: unavailable background retains the location palette and playable round controls')

  await loaded(url)
  assert.equal(await evaluate(`document.querySelector('#app').dataset.scene`), undefined)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.arena'), '::before').backgroundImage`), 'none')
  assert.match((await state()).button, /Принять вызов/)
  assert.equal(await evaluate(`document.querySelector('#scoreboard').hidden`), true)
  assert.equal(await evaluate(`
    [...document.querySelectorAll('.bull__face, .bull__championship')].every(image => {
      for (let node = image; node; node = node.parentElement) {
        if (getComputedStyle(node).filter !== 'none') return false;
      }
      return true;
    })
  `), true, 'bull artwork must retain its original colors without CSS filters')

  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [1280, 900], [844, 390]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const layout = await evaluate(`(() => {
      const app = document.querySelector('#app').getBoundingClientRect();
      const go = document.querySelector('#go').getBoundingClientRect();
      const title = document.querySelector('#callout');
      return { scroll: document.documentElement.scrollWidth, width: innerWidth, appBottom: app.bottom,
        buttonBottom: go.bottom, buttonRight: go.right, titleFits: title.scrollWidth <= title.clientWidth,
        paper: getComputedStyle(document.querySelector('#app')).backgroundColor };
    })()`)
    assert.ok(layout.scroll <= width, `horizontal overflow at ${width}×${height}`)
    assert.ok(layout.buttonRight <= width && layout.buttonBottom <= layout.appBottom, `button outside poster at ${width}×${height}`)
    if (height >= 568) assert.ok(layout.buttonBottom <= height, `button below screen at ${width}×${height}`)
    assert.ok(layout.titleFits, `headline overflow at ${width}×${height}`)
    assert.equal(layout.paper, 'rgb(246, 238, 206)')
    if (width === 390 || width === 1280) await screenshot(`idle-${width}`)
  }
  console.log('PASS: entry copy, assets, and layout at five screen sizes')

  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 1, mobile: false })
  await evaluate(`document.querySelector('#go').click()`)
  assert.equal((await state()).button, 'Включаем микрофон…')
  assert.equal((await state()).disabled, true)
  await evaluate(`window.__denyMic()`)
  await until(async () => (await state()).button === 'Зажми и тяни', 'fallback control')
  assert.match((await state()).privacy, /Без микрофона/)
  assert.equal((await state()).title, '3')
  await assertAdvantage('even', 'Равные силы')
  assert.equal(await evaluate(`document.querySelector('#fighter-bull').classList.contains('is-inhaling')`), false)
  await evaluate(`document.querySelector('#go').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1 }))`)
  await until(async () => (await state()).phase === 'listen', 'countdown to play')
  for (const [width, height] of [[320, 568], [375, 667]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const layout = await evaluate(`(() => {
      const button = document.querySelector('#go').getBoundingClientRect();
      const hint = document.querySelector('#hint').getBoundingClientRect();
      const meter = document.querySelector('.gauge').getBoundingClientRect();
      return { privacyBottom: document.querySelector('#privacy').getBoundingClientRect().bottom, bottom: button.bottom, hintBottom: hint.bottom, buttonTop: button.top, meterBottom: meter.bottom, hintTop: hint.top };
    })()`)
    await screenshot(`playing-${width}`)
    assert.ok(layout.bottom <= height, `active button below screen at ${width}×${height}`)
    assert.ok(layout.privacyBottom <= height, `microphone hint below screen at ${width}×${height}`)
    assert.ok(layout.hintBottom < layout.buttonTop && layout.meterBottom < layout.hintTop, 'controls and instructions must not overlap')
  }
  await checkInhale(true)
  await screenshot('daily-inhale')
  await until(async () => (await state()).phase === 'listen' && (await state()).meter > 8, 'player takes the lead')
  await assertAdvantage('you', 'Ты ведёшь')
  await until(async () => (await state()).phase === 'done', 'held button wins')
  assert.equal((await state()).title, 'Луг за тобой.')
  assert.equal((await state()).loser, 'fighter-bull')
  assert.ok((await state()).meter > 8)
  await until(async () => (await state()).button === 'Ещё раунд ↗', 'replay after win')
  await assertAdvantage('you', 'Ты победил')
  assert.equal(await evaluate(`document.querySelector('#fighter-bull').classList.contains('is-inhaling')`), false)
  await screenshot('win')
  console.log('PASS: permission pending → denied → countdown → hold → win → replay')

  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'hush', 'replay resets round')
  assert.equal((await state()).meter, 0)
  assert.equal((await state()).loser, undefined)
  assert.equal((await state()).requests, 1)
  await assertAdvantage('even', 'Равные силы')
  await until(async () => (await state()).phase === 'listen' && (await state()).meter < -8, 'bull takes the lead')
  await assertAdvantage('bull', 'Бынич ведёт')
  await until(async () => (await state()).phase === 'done', 'unheld button loses')
  assert.equal((await state()).title, 'Раунд за Быничем.')
  assert.equal((await state()).loser, 'fighter-you')
  await until(async () => (await state()).button === 'Ещё раунд ↗', 'replay after loss')
  await assertAdvantage('bull', 'Бынич победил')
  await screenshot('loss')
  console.log('PASS: replay resets state, remembers denial, and reports loss without holding')

  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: denied.identifier })
  const syntheticVoice = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      const source = ctx.createOscillator();
      source.type = 'sawtooth';
      source.frequency.value = 140;
      const tract = ctx.createBiquadFilter();
      const open = new URL(location.href).searchParams.get('vowel') === 'a';
      tract.type = open ? 'bandpass' : 'lowpass';
      tract.frequency.value = open ? 1200 : 700;
      tract.Q.value = open ? 2 : 1.5;
      const distortion = ctx.createWaveShaper();
      distortion.curve = Float32Array.from({ length: 4097 }, (_, i) => Math.max(-1, Math.min(1, (i / 2048 - 1) * 6)));
      const level = ctx.createGain();
      level.gain.value = 0;
      const destination = ctx.createMediaStreamDestination();
      source.connect(tract).connect(distortion).connect(level).connect(destination);
      source.start();
      window.__voiceLevel = level;
      window.__voiceContext = ctx;
      window.__voiceTracks = destination.stream.getTracks();
      return destination.stream;
    };
  ` })
  for (const vowel of ['u', 'a']) {
    await loaded(`${url}?vowel=${vowel}`)
    await evaluate(`document.querySelector('#go').click()`)
    await until(async () => (await state()).phase === 'listen', 'synthetic microphone countdown')
    assert.equal((await state()).hidden, true, 'audio input must use the microphone path')
    await evaluate(`window.__voiceLevel.gain.value = 0.7`)
    await until(async () => (await state()).phase === 'done', `distorted ${vowel} audio round`)
    assert.equal((await state()).title, vowel === 'u' ? 'Луг за тобой.' : 'Раунд за Быничем.')
    assert.equal(await evaluate(`window.__voiceTracks.every(track => track.readyState === 'ended')`), true)
    await evaluate(`window.__voiceContext.close()`)
  }
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: syntheticVoice.identifier })
  console.log('PASS: distorted rounded vowel wins through Web Audio microphone input; open vowel loses')

  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__micTracks = [];
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await acquire(constraints);
      window.__micTracks.push(...stream.getTracks());
      return stream;
    };
  ` })
  await loaded(url)
  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).hidden, 'microphone mode hides fallback control')
  assert.equal(await evaluate(`window.__micTracks.length > 0 && window.__micTracks.every(t => t.readyState === 'live')`), true)
  await until(async () => (await state()).phase === 'done', 'microphone round finishes')
  assert.equal(await evaluate(`window.__micTracks.length > 0 && window.__micTracks.every(t => t.readyState === 'ended')`), true)
  assert.equal((await state()).privacy, 'Раунд окончен. Микрофон выключен.')
  await until(async () => !(await state()).hidden && (await state()).button === 'Ещё раунд ↗', 'microphone replay')
  console.log('PASS: real Chrome fake microphone opens, fallback hides, tracks close, replay returns')
  const delayed = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const acquireLater = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => new Promise(resolve => {
      window.__resolveMic = async () => resolve(await acquireLater(constraints));
    });
  ` })
  await loaded(url)
  await evaluate(`document.querySelector('#go').click()`)
  assert.equal((await state()).disabled, true)
  await evaluate(`document.querySelector('.mode-nav [data-mode="championship"]').click()`)
  await evaluate(`window.__resolveMic()`)
  await pause(200)
  assert.equal((await state()).phase, undefined)
  assert.equal(await evaluate(`window.__micTracks.length > 0 && window.__micTracks.every(t => t.readyState === 'ended')`), true)
  console.log('PASS: changing modes while permission is pending discards and closes a late microphone')
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: delayed.identifier })

  await loaded(`${url}#championship`)
  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).hidden, 'championship microphone round')
  await evaluate(`document.querySelector('.mode-nav [data-mode="daily"]').click()`)
  assert.equal((await state()).phase, undefined)
  assert.equal(await evaluate(`window.__micTracks.length > 0 && window.__micTracks.every(t => t.readyState === 'ended')`), true)
  assert.equal(await evaluate(`document.querySelector('#air').hidden`), true)
  assert.equal(await evaluate(`localStorage.getItem('bynich.championship.v1')`), null)
  console.log('PASS: changing modes stops an active microphone and grants no campaign progress')

  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  ` })
  await loaded(`${url}#championship`)
  assert.equal(await evaluate(`document.querySelectorAll('.stage-step').length`), 5)
  assert.equal(await evaluate(`document.querySelectorAll('.stage-step:not(:disabled)').length`), 1)
  assert.equal(await evaluate(`document.querySelector('.mode-nav [data-mode="championship"]').getAttribute('aria-pressed')`), 'true')

  async function campaignLayout(width, height, name) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const layout = await evaluate(`(() => {
      const go = document.querySelector('#go').getBoundingClientRect();
      const hint = document.querySelector('#hint').getBoundingClientRect();
      const air = document.querySelector('#air').getBoundingClientRect();
      const stage = document.querySelector('#stage-path').getBoundingClientRect();
      return { noticeVisible: !document.querySelector('#save-notice').hidden, noticeBottom: document.querySelector('#save-notice').getBoundingClientRect().bottom, scroll: document.documentElement.scrollWidth, buttonBottom: go.bottom,
        privacyBottom: document.querySelector('#privacy').getBoundingClientRect().bottom,
        hintBottom: hint.bottom, buttonTop: go.top, airBottom: air.bottom, hintTop: hint.top, stageBottom: stage.bottom };
    })()`)
    await screenshot(name)
    assert.ok(layout.scroll <= width, `championship horizontal overflow at ${width}×${height}`)
    assert.ok(layout.buttonBottom <= height && layout.privacyBottom <= height, `championship controls below screen at ${width}×${height}: ${JSON.stringify(layout)}`)
    assert.ok(layout.hintBottom < layout.buttonTop, 'championship instructions overlap button')
    if (layout.noticeVisible) assert.ok(layout.noticeBottom <= height, 'save failure notice below screen')
    if (await evaluate(`!document.querySelector('#air').hidden`)) assert.ok(layout.airBottom < layout.hintTop, 'air overlaps instructions')
  }

  await campaignLayout(320, 568, 'championship-preview-small')
  await campaignLayout(390, 844, 'championship-preview')
  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'listen', 'championship begins')
  await campaignLayout(320, 568, 'championship-playing-small')
  await until(async () => (await state()).phase === 'done', 'championship loss')
  await until(async () => (await state()).button === 'Попробовать ещё ↗', 'retry lost stage')
  assert.equal(await evaluate(`document.querySelectorAll('.stage-step:not(:disabled)').length`), 1)
  assert.equal(await evaluate(`localStorage.getItem('bynich.championship.v1')`), null)
  console.log('PASS: campaign loss retries the same encounter without unlocking anything')
  await assertScene(...stageScenes[0])

  async function winEncounter(key = '') {
    await evaluate(`(() => {
      document.querySelector('#go').click();
      let held = false;
      const timer = setInterval(() => {
        const app = document.querySelector('#app');
        const go = document.querySelector('#go');
        const want = app.dataset.phase === 'listen' && app.dataset.breath === 'inhale' && !app.classList.contains('is-exhausted');
        if (want !== held) {
          const key = ${JSON.stringify(key)};
          if (key) {
            if (want) go.focus();
            go.dispatchEvent(new KeyboardEvent(want ? 'keydown' : 'keyup', { key, bubbles: true, cancelable: true }));
          } else go.dispatchEvent(new PointerEvent(want ? 'pointerdown' : 'pointerup', { pointerId: 2 }));
          held = want;
        }
        if (app.dataset.phase === 'done') clearInterval(timer);
      }, 60);
    })()`)
    await checkInhale()
    await until(async () => (await state()).phase === 'done', 'timed championship win')
    assert.ok((await state()).meter > 8, `timed input must win: ${JSON.stringify(await state())}`)
    await until(async () => !(await state()).hidden, 'championship result action')
  }

  for (let stage = 0; stage < 5; stage++) {
    if (stage === 1) await loaded(`${url}#championship`)
    else if (stage > 1) await evaluate(`document.querySelector('#go').click()`)
    assert.equal(await evaluate(`document.querySelector('#app').dataset.fury`), String(stage))
    await assertScene(...stageScenes[stage])
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
    if (stage > 0) {
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bull__championship')).display`), 'block')
      const alphaAtlas = await evaluate(`fetch(new URL('art/bull-championship.webp', location.href)).then(r => r.ok)`)
      assert.equal(alphaAtlas, true)
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bull__championship')).filter`), 'none')
    }
    await screenshot(`championship-stage-${stage + 1}`)
    await winEncounter(stage === 0 ? ' ' : stage === 1 ? 'Enter' : '')
    await assertScene(...stageScenes[stage])
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('bynich.championship.v1')).cleared`), stage + 1)
    assert.equal(await evaluate(`document.querySelectorAll('.stage-step.is-cleared').length`), stage + 1)
    if (stage < 4) assert.equal((await state()).button, 'Следующая встреча ↗')
    console.log(`PASS: encounter ${stage + 1} won and saved; fury ${stage} shown`)
  }
  assert.equal((await state()).title, 'Чемпион луга!')
  assert.equal(await evaluate(`document.querySelector('#champion-seal').hidden`), false)
  await screenshot('championship-finale')
  await evaluate(`document.querySelector('#go').click()`)
  assert.equal(await evaluate(`document.querySelector('#app').dataset.fury`), '0')
  assert.equal(await evaluate(`document.querySelectorAll('.stage-step:not(:disabled)').length`), 5)
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('bynich.championship.v1')).cleared`), 5)
  await evaluate(`document.querySelector('.stage-step[data-stage="4"]').click()`)
  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'listen', 'hard-stage replay')
  await evaluate(`document.querySelector('#go').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3 }))`)
  await until(() => evaluate(`document.querySelector('#app').classList.contains('is-exhausted')`), 'continuous input exhausts air')
  assert.equal((await state()).title, 'Вдохни.')
  assert.equal(await evaluate(`document.querySelector('.air__track').getAttribute('aria-valuenow')`), '0')
  await campaignLayout(320, 568, 'championship-exhausted-small')
  await until(async () => (await state()).phase === 'done', 'continuous input loses hard encounter')
  assert.equal((await state()).title, 'Раунд за Быничем.')
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('bynich.championship.v1')).cleared`), 5)
  await evaluate(`document.querySelector('.mode-nav [data-mode="daily"]').click()`)
  assert.match((await state()).button, /Принять вызов/)
  assert.equal(await evaluate(`document.querySelector('#stage-path').hidden && document.querySelector('#air').hidden`), true)
  assert.equal(await evaluate(`document.querySelector('#app').dataset.scene`), undefined)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.arena'), '::before').backgroundImage`), 'none')
  console.log('PASS: campaign completion, replay without losing unlocks, and return to daily duel')

  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  ` })
  await loaded(`${url}#championship`)
  await winEncounter()
  assert.equal(await evaluate(`document.querySelector('#save-notice').hidden`), false)
  await campaignLayout(320, 568, 'championship-storage-blocked-small')
  assert.equal(await evaluate(`document.querySelectorAll('.stage-step:not(:disabled)').length`), 2)
  console.log('PASS: blocked storage preserves playable session progress and shows an honest save notice')
  assert.deepEqual(errors, [], 'uncaught browser errors')
  console.log(`Screenshots: ${scratch}`)
} finally {
  socket?.close()
  chrome.kill()
  await server.close()
  await pause(300)
  await rm(join(scratch, 'profile'), { recursive: true, force: true })
}
