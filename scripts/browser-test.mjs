import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { createServer } from 'vite'

const scratch = await mkdtemp(join(tmpdir(), 'mu-screamo-browser-'))
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
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
  await call('Page.navigate', { url })
  await until(() => evaluate(`Boolean(document.querySelector('#date-label')?.textContent)`), 'app module loaded')
  await until(() => evaluate(`[...document.images].length === 8 && [...document.images].every(i => i.complete && i.naturalWidth > 0)`), 'all bull images loaded')
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
  await server.listen()
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
  await loaded(url)
  assert.match((await state()).button, /Принять вызов/)
  assert.equal(await evaluate(`document.querySelector('#scoreboard').hidden`), true)
  assert.equal(await evaluate(`
    [...document.querySelectorAll('.bull__face')].every(image => {
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
  await until(async () => (await state()).phase === 'done', 'held button wins')
  assert.equal((await state()).title, 'Луг за тобой.')
  assert.equal((await state()).loser, 'fighter-bull')
  assert.ok((await state()).meter > 8)
  await until(async () => (await state()).button === 'Ещё раунд ↗', 'replay after win')
  await screenshot('win')
  console.log('PASS: permission pending → denied → countdown → hold → win → replay')

  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'hush', 'replay resets round')
  assert.equal((await state()).meter, 0)
  assert.equal((await state()).loser, undefined)
  assert.equal((await state()).requests, 1)
  await until(async () => (await state()).phase === 'done', 'unheld button loses')
  assert.equal((await state()).title, 'Раунд за Быничем.')
  assert.equal((await state()).loser, 'fighter-you')
  await until(async () => (await state()).button === 'Ещё раунд ↗', 'replay after loss')
  await screenshot('loss')
  console.log('PASS: replay resets state, remembers denial, and reports loss without holding')

  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: denied.identifier })
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
  assert.deepEqual(errors, [], 'uncaught browser errors')
  console.log(`Screenshots: ${scratch}`)
} finally {
  socket?.close()
  chrome.kill()
  await server.close()
  await pause(300)
  await rm(join(scratch, 'profile'), { recursive: true, force: true })
}
