import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { build, preview } from 'vite'

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
  await until(() => evaluate(`Boolean(document.querySelector('#app')?.style.getPropertyValue('--tug'))`), 'app module loaded')
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

async function checkInhale(reduced = false, recognized = false) {
  await until(() => evaluate(`document.querySelector('#fighter-bull').classList.contains('is-inhaling') && Number(document.querySelector('#app').style.getPropertyValue('--inhale')) > 0.05 && Number(document.querySelector('#app').style.getPropertyValue('--inhale')) < 0.45`), 'visible inhale starts with the breathing window')
  if (recognized) await until(async () => (await state()).title === 'Держи!', 'input recognition reaches the instruction')
  const progress = await evaluate(`Number(document.querySelector('#player-meter').getAttribute('aria-valuenow'))`)
  assert.ok(progress > 60 && progress <= 100)
  assert.match(await evaluate(`document.querySelector('#player-time').textContent`), /^[0-9]+,[0-9] с$/)
  assert.equal(await evaluate(`document.querySelector('#player-meter').getAttribute('role')`), 'progressbar')
  assert.equal(await evaluate(`document.querySelector('#player-window').hidden`), false)
  assert.equal((await state()).title, recognized ? 'Держи!' : 'МЫЧИ')
  const visible = await evaluate(`({ fill: new DOMMatrix(getComputedStyle(document.querySelector('#player-fill')).transform).a, percent: Number(document.querySelector('#player-meter').getAttribute('aria-valuenow')) })`)
  const fill = visible.fill
  assert.ok(Math.abs(fill - visible.percent / 100) < .011, `visible fill must match the reported percentage: ${JSON.stringify(visible)}`)
  const clear = await evaluate(`(() => {
    const label = document.querySelector('#player-time'), badge = document.querySelector('#player-window').getBoundingClientRect();
    const body = document.querySelector('#fighter-you .fighter__body').getBoundingClientRect();
    const poster = document.querySelector('#app').getBoundingClientRect();
    return label.scrollWidth <= label.clientWidth && badge.left >= poster.left && badge.right <= poster.right &&
      badge.bottom <= body.top && Math.abs((badge.left + badge.right - body.left - body.right) / 2) < 8;
  })()`)
  assert.equal(clear, true, 'breath timer must fit and stay clear of other text')
  const enemy = await evaluate(`({ kind: document.querySelector('#app').dataset.bullCue, text: document.querySelector('#bull-action').textContent, time: document.querySelector('#bull-time').textContent, fill: new DOMMatrix(getComputedStyle(document.querySelector('#bull-fill')).transform).a, percent: Number(document.querySelector('#bull-meter').getAttribute('aria-valuenow')) })`)
  assert.equal(await evaluate(`document.querySelector('#bull-window').hidden`), false)
  if (enemy.kind === 'inhale' || enemy.kind === 'warning') {
    assert.equal(enemy.text, 'Бынич замычит')
    assert.match(enemy.time, /^[0-9]+,[0-9] с$/)
    assert.ok(Math.abs(enemy.fill - enemy.percent / 100) < .011, 'visible bull inhale must match the reported progress')
  } else assert.equal(enemy.text, 'Бынич выдохся', 'final inhale must not promise an attack')
  const first = await evaluate(`getComputedStyle(document.querySelector('#bull-bull')).transform`)
  await pause(100)
  assert.equal(await evaluate(`document.querySelector('#fighter-bull').classList.contains('is-inhaling')`), true)
  assert.ok(await evaluate(`Number(document.querySelector('#player-meter').getAttribute('aria-valuenow'))`) < progress, 'player time must keep shrinking')
  assert.ok(await evaluate(`new DOMMatrix(getComputedStyle(document.querySelector('#player-fill')).transform).a`) < fill, 'rendered player bar must keep shrinking')
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('#bull-bull')).transform`), first, 'bull expands during its inhale')
  if (enemy.kind === 'inhale' || enemy.kind === 'warning') assert.ok(await evaluate(`new DOMMatrix(getComputedStyle(document.querySelector('#bull-fill')).transform).a`) > enemy.fill, 'enemy fills its inhale while player time shrinks')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.breath-cue')).display === 'none'`), false)
  assert.equal(await evaluate(`document.querySelector('#bull-bull').classList.contains('is-fierce')`), false, 'mouth closes on inhale')
  if (reduced) {
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#bull-bull')).transform`), 'none')
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#fighter-bull .fighter__body')).animationName`), 'none')
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.breath-cue')).display === 'none'`), false)
    const reducedFill = await evaluate(`new DOMMatrix(getComputedStyle(document.querySelector('#player-fill')).transform).a`)
    await pause(100)
    assert.ok(await evaluate(`new DOMMatrix(getComputedStyle(document.querySelector('#player-fill')).transform).a`) < reducedFill, 'reduced motion must retain a functional progress indicator')
    await call('Emulation.setEmulatedMedia', { features: [] })
  }
  if (recognized && reduced) {
    await evaluate(`document.querySelector('#go').dispatchEvent(new PointerEvent('pointerup'))`)
    await until(async () => (await state()).title === 'МЫЧИ', 'releasing input removes recognition feedback')
    await evaluate(`document.querySelector('#go').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2 }))`)
    await until(async () => (await state()).title === 'Держи!', 'recognized input confirms holding again')
  }
}

async function assertStableCues(mode) {
  for (const [width, height] of [[280, 560], [320, 568], [375, 667], [1280, 720], [1920, 1080]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const frames = await evaluate(`(() => {
      const app = document.querySelector('#app'), label = document.querySelector('#callout-label');
      const player = document.querySelector('#player-window'), hint = document.querySelector('#hint');
      return [['moo', 'МЫЧИ', 'Продолжай «му-у-у» до конца полоски.'],
        ['moo', 'Держи!', 'Продолжай «му-у-у» до конца полоски.'],
        ['pause', 'ПАУЗА', 'Набери воздух — помолчи до восстановления.'],
        ['ready', 'ЖДИ', 'Скоро твой выход. Жди сигнала.'],
        ['count', '4', 'Первым мычит Бынич. Жди сигнала.']].map(([cue, text, detail]) => {
          app.dataset.phase = cue === 'count' ? 'invite' : 'listen';
          label.parentElement.classList.toggle('is-count', cue === 'count');
          app.dataset.cue = cue; label.textContent = text; player.hidden = cue !== 'moo'; hint.textContent = detail;
          return { text, boxes: ['.sheet', '#callout-label', '.arena', '.gauge', '#fighter-you .fighter-status', '#fighter-bull .fighter-status', '#go'].map(selector => {
            const node = document.querySelector(selector), box = node.getBoundingClientRect();
            return [selector, box.top, box.height];
          }), fits: (() => { const range = document.createRange(); range.selectNodeContents(label); const text = range.getBoundingClientRect(), heading = label.parentElement.getBoundingClientRect(); return text.left >= heading.left && text.right <= heading.right && text.bottom <= heading.bottom; })() };
        });
    })()`)
    assert.equal(frames.length, 5)
    await assertArenaFocus(mode, width, height)
    for (const frame of frames) {
      assert.ok(frame.fits, `${mode} instruction clips at ${width}×${height}: ${frame.text}`)
      assert.deepEqual(frame.boxes, frames[0].boxes, `${mode} command must not move layout at ${width}×${height}: ${frame.text}`)
    }
  }
}

async function assertArenaFocus(mode, width, height) {
  const layout = await evaluate(`(() => {
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, center: (r.left + r.right) / 2 }; };
    return { you: box('#fighter-you .fighter__body'), bull: box('#fighter-bull .fighter__body'),
      yours: box('#fighter-you .fighter-status'), his: box('#fighter-bull .fighter-status'), command: box('#callout'),
      font: parseFloat(getComputedStyle(document.querySelector('#callout')).fontSize) };
  })()`)
  for (const [badge, bull] of [[layout.yours, layout.you], [layout.his, layout.bull]]) {
    assert.ok(badge.bottom <= bull.top + 2 && Math.abs(badge.center - bull.center) < 8, `timer must be above its fighter at ${mode} ${width}×${height}: ${JSON.stringify(layout)}`)
  }
  assert.ok(layout.command.left >= layout.you.right - 3 && layout.command.right <= layout.bull.left + 3, `command must fit between fighters: ${JSON.stringify(layout)}`)
  assert.ok(Math.abs(layout.command.center - (layout.you.center + layout.bull.center) / 2) < 20, 'command must remain in the center')
  const y = (layout.command.top + layout.command.bottom) / 2
  assert.ok(y > layout.you.top && y < layout.you.bottom && y > layout.bull.top && y < layout.bull.bottom, 'command must sit beside the bodies, below both timers')
  assert.ok(layout.font >= (width >= 1000 ? 40 : 22), 'central command must be large')
}

async function assertReadableHeadings(url) {
  for (const [mode, scene] of [['daily', 'fence'], ['championship', 'fence'], ['championship', 'yard'], ['championship', 'evening']]) {
    await loaded(mode === 'daily' ? url : `${url}#championship`)
    await evaluate(`document.fonts.ready`)
    await evaluate(`document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '* { animation: none !important; transition: none !important; }' }))`)
    if (mode === 'championship') await evaluate(`document.querySelector('#app').dataset.scene = ${JSON.stringify(scene)}`)
    const intros = mode === 'daily' ? ['Ну что,<br>кто кого?'] : ['Разминка.', 'Упрямство.', 'Вызов.', 'Ярость.', 'Финал.', 'Реванш чемпиона.']
    const cases = [
      ...intros.map(text => [null, '', text]),
      ...['Первым мычишь ты!', 'Первым мычит Бынич!'].map(text => ['toss', '', text]),
      ...['4', '3', '2', '1'].map(text => ['invite', 'count', text]),
      ...[['moo', 'МЫЧИ'], ['moo', 'Держи!'], ['pause', 'ПАУЗА'], ['ready', 'ЖДИ']].map(([cue, text]) => ['listen', cue, text]),
      ...['Луг за тобой.', 'Раунд за Быничем.', 'Ничья.', 'Нокаут!', 'Чемпион луга!'].map(text => ['done', '', text]),
    ]
    for (const [width, height] of [[280, 560], [390, 844], [1280, 720], [1920, 1080]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      const headings = await evaluate(`(() => {
        const app = document.querySelector('#app'), label = document.querySelector('#callout-label'), title = label.parentElement;
        const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        return ${JSON.stringify(cases)}.map(([phase, cue, text]) => {
          if (phase) app.dataset.phase = phase; else delete app.dataset.phase;
          app.dataset.cue = cue; label.innerHTML = text; title.classList.toggle('is-count', cue === 'count');
          const css = getComputedStyle(label), range = document.createRange(); range.selectNodeContents(label);
          return { text, phase, fg: css.color.match(/[\\d.]+/g).map(Number), bg: css.backgroundColor.match(/[\\d.]+/g).map(Number),
            opacity: Number(css.opacity), border: css.borderTopWidth, shadow: css.boxShadow, textShadow: css.textShadow, ink: box(range), app: box(app),
            bulls: [...document.querySelectorAll('.fighter__body')].map(box) };
        });
      })()`)
      assert.ok(headings.length >= 16, 'all instruction phases must be exercised')
      for (const heading of headings) {
        const detail = `${mode}/${scene} ${width}×${height}: ${JSON.stringify(heading)}`
        assert.equal(heading.bg[3], 0, `headings must stay directly on the scenery: ${detail}`)
        assert.equal(heading.border, '0px', `headings must have no frame: ${detail}`)
        assert.equal(heading.shadow, 'none', `headings must have no plate shadow: ${detail}`)
        assert.equal(heading.textShadow, 'none', `heading fix must only change ink: ${detail}`)
        assert.equal(heading.opacity, 1, `heading ink must remain opaque: ${detail}`)
        assert.deepEqual(heading.fg, [182, 59, 42], `headings must use the palette terracotta in every phase: ${detail}`)
        assert.ok(heading.ink.left >= heading.app.left && heading.ink.right <= heading.app.right, `heading text must fit the scene: ${detail}`)
        assert.equal(heading.bulls.length, 2)
        if (heading.phase === 'listen' || heading.phase === 'invite') {
          assert.ok(heading.ink.left >= heading.bulls[0].right - 3 && heading.ink.right <= heading.bulls[1].left + 3, `live text must stay between bulls: ${detail}`)
        } else if (!heading.phase || heading.phase === 'done') {
          assert.ok(heading.bulls.every(bull => heading.ink.bottom <= bull.top), `heading text must stay above bulls: ${detail}`)
        }
      }
    }
  }
  await loaded(url)
  await evaluate(`document.fonts.ready`)
}

async function assertStableRoundLayout(url) {
  for (const mode of ['daily', 'championship']) {
    await loaded(mode === 'daily' ? url : `${url}#championship`)
    await evaluate(`document.fonts.ready`)
    for (const [width, height] of [[280, 560], [390, 844], [1280, 720], [1920, 1080]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      const frames = await evaluate(`(() => {
        const app = document.querySelector('#app'), go = document.querySelector('#go'), score = document.querySelector('#scoreboard');
        const box = node => { let x=0, y=0, parent=node; while(parent) { x+=parent.offsetLeft; y+=parent.offsetTop; parent=parent.offsetParent; } return [x,y,node.offsetWidth,node.offsetHeight]; };
        return [['toss','Готовимся к бою…'],['hush','Зажми и тяни'],['invite','Зажми и тяни'],['listen','Зажми и тяни'],['done','Ещё раунд ↗'],['done','Следующая встреча ↗'],['done','Пройти чемпионат снова ↗'],['done','Попробовать ещё ↗']].flatMap(([phase,text]) => [false,true].map(hidden => {
          app.dataset.phase = phase; go.textContent = text; go.hidden = hidden; score.hidden = phase === 'toss';
          document.querySelector('#privacy').textContent = hidden && phase !== 'toss' && phase !== 'done' ? 'Лучше играть в наушниках.' : '';
          document.querySelector('#callout').classList.toggle('is-count', phase === 'invite');
          document.querySelector('#callout-label').textContent = phase === 'done' ? 'Раунд за Быничем.' : phase === 'invite' ? '4' : 'МЫЧИ';
          document.querySelector('#player-window').hidden = phase !== 'listen'; document.querySelector('#bull-window').hidden = phase !== 'listen';
          const range = document.createRange(); range.selectNodeContents(go); const ink=range.getBoundingClientRect(), button=go.getBoundingClientRect();
          return { phase, hidden, fits: ink.left >= button.left+2 && ink.right <= button.right-2 && ink.top >= button.top+2 && ink.bottom <= button.bottom-2, buttonVisibility: getComputedStyle(go).visibility, scoreVisibility: getComputedStyle(score).visibility, boxes: [...document.querySelectorAll('.sheet,.arena,#scoreboard,.clock,.dock,#go,.fighter-status,.fighter__body')].map(box) };
        }));
      })()`)
      assert.equal(frames.length, 16)
      for (const frame of frames) {
        assert.ok(frame.fits, `button label must fit at ${mode} ${width}×${height}: ${JSON.stringify(frame)}`)
        assert.equal(frame.buttonVisibility, frame.hidden ? 'hidden' : 'visible', 'reserved button space must not expose hidden controls')
        assert.equal(frame.scoreVisibility, frame.phase === 'toss' ? 'hidden' : 'visible')
        assert.deepEqual(frame.boxes, frames[0].boxes, `round layout must stay fixed at ${mode} ${width}×${height}: ${frame.phase}, hidden button=${frame.hidden}`)
      }
    }
  }
  await loaded(url)
}

async function watchRoundLayout() {
  await evaluate(`document.fonts.ready`)
  await evaluate(`(() => {
    cancelAnimationFrame(window.__roundFrame); window.__roundLayout = []; window.__roundFrameCount = 0;
    const sample = () => {
      const box = node => { let x=0,y=0,parent=node; while(parent) { x+=parent.offsetLeft; y+=parent.offsetTop; parent=parent.offsetParent; } return [x,y,node.offsetWidth,node.offsetHeight]; };
      const frame = { phase: document.querySelector('#app').dataset.phase, boxes: [...document.querySelectorAll('.sheet,.arena,#scoreboard,.clock,.dock,#go,.fighter-status,.fighter__body')].map(box) };
      window.__roundFrameCount++;
      if (JSON.stringify(frame) !== JSON.stringify(window.__roundLayout.at(-1))) window.__roundLayout.push(frame);
      window.__roundFrame = requestAnimationFrame(sample);
    }; window.__roundFrame = requestAnimationFrame(sample);
  })()`)
}

async function assertWatchedRoundLayout() {
  const captured = await evaluate(`cancelAnimationFrame(window.__roundFrame); ({ frames: window.__roundLayout, count: window.__roundFrameCount })`)
  const frames = captured.frames.slice(captured.frames.findIndex(frame => frame.phase === 'toss'))
  assert.ok(captured.count > 100 && frames.length >= 5, 'must sample an actual round frame by frame')
  assert.deepEqual([...new Set(frames.map(frame => frame.phase))], ['toss','hush','invite','listen','done'])
  for (const frame of frames) assert.deepEqual(frame.boxes, frames[0].boxes, `actual round layout shifted in ${frame.phase}`)
}

async function mobileViewport(width, height) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: width>height?'landscapePrimary':'portraitPrimary', angle: width>height?90:0 } })
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
}

async function touch(selector, type = 'tap') {
  const point = await evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}), r=n.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2, hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===n}; })()`)
  assert.equal(point.hit, true, `touch target must be reachable: ${selector}`)
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] })
  if (type === 'tap') await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function assertMobileFit(insets = {}) {
  const view = await evaluate(`(() => {
    const visible = [...document.querySelectorAll('.sheet,.arena,#go,.gauge,.clock,.mode-nav button,.stage-step,.player-window,.bull-window,.fighter__body,.bull__championship,#save-notice')].filter(n=>getComputedStyle(n).visibility!=='hidden' && n.getBoundingClientRect().height>0 && !n.closest('.app.is-ko .fighter.is-lose'));
    const box=n=>{const r=n.getBoundingClientRect();return {name:n.id||n.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
    return {width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,scroll:document.documentElement.scrollWidth,inner:innerWidth,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer:coarse)').matches,boxes:visible.map(box),buttonTextFits:(()=>{const go=document.querySelector('#go'),r=go.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(go);const ink=range.getBoundingClientRect();return ink.left>=r.left+2&&ink.right<=r.right-2&&ink.top>=r.top+2&&ink.bottom<=r.bottom-2})()};
  })()`)
  assert.ok(view.touch > 0 && view.coarse && view.scale === 1, `must run in touch mobile emulation: ${JSON.stringify(view)}`)
  assert.ok(view.scroll <= view.inner, `mobile horizontal overflow: ${JSON.stringify(view)}`)
  assert.ok(view.buttonTextFits, `mobile button text must fit: ${JSON.stringify(view)}`)
  for(const box of view.boxes) assert.ok(box.left >= (insets.left ?? 0) && box.right <= view.width-(insets.right ?? 0)+.5 && box.top >= (insets.top ?? 0) && box.bottom <= view.height-(insets.bottom ?? 0)+.5, `mobile controls must fit the visible viewport: ${JSON.stringify(view)}`)
}

async function checkMobileLayouts(url) {
  for(const [width,height,insets = {}] of [[280,560],[320,568],[375,667],[390,844],[430,932],[568,320],[844,390],[390,700,{top:44,right:0,bottom:34,left:0}],[844,390,{top:0,right:44,bottom:21,left:44}]]) {
    await mobileViewport(width,height)
    await call('Emulation.setSafeAreaInsetsOverride',{insets})
    for(const mode of ['daily','championship']) {
      await loaded(mode==='daily'?url:`${url}#championship`)
      await evaluate(`document.fonts.ready`)
      await assertMobileFit(insets)
      for(const phase of ['toss','invite','listen','done']) {
        await evaluate(`(() => {
          const app=document.querySelector('#app'); app.dataset.phase=${JSON.stringify(phase)};
          document.querySelector('#scoreboard').hidden=${phase==='toss'};
          document.querySelector('#save-notice').hidden=${phase!=='done'};
          document.querySelector('#go').textContent=${JSON.stringify(phase==='done'?(mode==='championship'?'Пройти чемпионат снова ↗':'Ещё раунд ↗'):'Зажми и тяни')};
          document.querySelector('#callout').classList.toggle('is-count',${phase==='invite'});
          document.querySelector('#callout-label').textContent=${JSON.stringify(phase==='done'?'Раунд за Быничем.':phase==='invite'?'4':phase==='toss'?'Первым мычит Бынич!':'МЫЧИ')};
          document.querySelector('#player-window').hidden=${phase!=='listen'}; document.querySelector('#bull-window').hidden=${phase!=='listen'};
        })()`)
        await assertMobileFit(insets)
        if(phase==='listen') {
          await assertArenaFocus(mode,width,height)
          if(mode==='championship') {
            await evaluate(`const app=document.querySelector('#app'); app.dataset.fury='4'; app.style.setProperty('--fury','4'); app.style.setProperty('--bull-column','100%')`)
            await assertMobileFit(insets)
          }
        }
      }
    }
  }
  await call('Emulation.setSafeAreaInsetsOverride',{insets:{}})
  await call('Emulation.setTouchEmulationEnabled', { enabled: false })
  await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await loaded(url)
}

async function checkMobileTouch(url) {
  for(const mode of ['daily','championship']) {
    await mobileViewport(390,844)
    await loaded(mode==='daily'?url:`${url}#championship`)
    await evaluate(`document.fonts.ready`)
    await evaluate(`window.__coinValue=.25`)
    await touch('#go')
    await until(()=>evaluate(`typeof window.__denyMic==='function'`),'mobile microphone request')
    await evaluate(`window.__denyMic()`)
    await until(()=>evaluate(`document.querySelector('#app').dataset.cue==='moo'`),'mobile player window')
    await touch('#go','hold')
    await until(()=>evaluate(`document.querySelector('#fighter-you').classList.contains('is-hot')`),'touch hold gives power')
    await call('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]})
    await until(()=>evaluate(`!document.querySelector('#fighter-you').classList.contains('is-hot')`),'cancel stops power')
    await touch('#go','hold')
    await until(()=>evaluate(`document.querySelector('#fighter-you').classList.contains('is-hot')`),'second touch gives power')
    await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:8,y:8,id:1}]})
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await until(()=>evaluate(`!document.querySelector('#fighter-you').classList.contains('is-hot')`),'release outside stops power')
    await mobileViewport(844,390)
    await assertMobileFit()
    await until(()=>evaluate(`document.querySelector('#app').dataset.cue==='moo'`),'player window after rotation')
    await touch('#go','hold')
    await until(async()=>(await state()).phase==='done','touch round ends',20000)
    await until(async()=>!(await state()).hidden,'mobile result action appears')
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await pause(200)
    assert.equal((await state()).phase,'done','releasing a round hold must not click the new result action')
    await assertMobileFit()
    await touch('#go')
    assert.equal((await state()).phase,'toss','a fresh tap must start exactly one new encounter')
    await touch(`.mode-nav [data-mode="${mode==='daily'?'championship':'daily'}"]`)
    assert.equal((await state()).phase,undefined,'touch mode switch must cancel the pending round')
  }
  await mobileViewport(390,844)
  await evaluate(`localStorage.removeItem('bynich.championship.v1')`)
  await loaded(`${url}#championship`)
  await evaluate(`window.__coinValue=.25`)
  await touch('#go')
  await until(()=>evaluate(`typeof window.__denyMic==='function'`),'championship microphone request')
  await evaluate(`window.__denyMic()`)
  let held=false
  const deadline=Date.now()+20000
  while((await state()).phase!=='done' && Date.now()<deadline) {
    const want=await evaluate(`document.querySelector('#app').dataset.cue==='moo'`)
    if(want && !held) { await touch('#go','hold'); held=true }
    else if(!want && held) { await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); held=false }
    await pause(80)
  }
  if(held)await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  assert.equal((await state()).phase,'done','touch-controlled championship encounter must finish')
  await until(async()=>(await state()).button==='Следующая встреча ↗','touch-controlled victory unlocks next opponent')
  await touch('#go')
  assert.equal((await state()).phase,'toss')
  assert.equal(await evaluate(`document.querySelector('#app').dataset.fury`),'1','one tap starts the next opponent')
  await touch('.mode-nav [data-mode="daily"]')
  await evaluate(`localStorage.removeItem('bynich.championship.v1')`)
  await call('Emulation.setTouchEmulationEnabled',{enabled:false})
  await call('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false})
  await loaded(url)
  console.log('PASS: genuine mobile touches hold, cancel, release outside, rotate and require a fresh result tap')
}

async function assertRoundTimer(expected) {
  const timer = await evaluate(`(() => {
    const track = document.querySelector('.clock'), label = document.querySelector('#clock-label');
    return { role: track.getAttribute('role'), hidden: track.getAttribute('aria-hidden'), text: label?.textContent,
      fraction: new DOMMatrix(document.querySelector('#clock').style.transform).a };
  })()`)
  assert.equal(timer.role, 'timer', 'round clock needs timer semantics')
  assert.notEqual(timer.hidden, 'true', 'round time must be accessible')
  if (typeof expected === 'number') {
    assert.match(timer.text, /^До конца раунда · [1-8] с$/)
    const seconds = Number(timer.text.match(/([1-8]) с$/)[1])
    assert.ok(Math.abs(seconds - expected) <= 1, `round clock should show about ${expected}s: ${JSON.stringify(timer)}`)
    assert.ok(timer.fraction > 0 && timer.fraction <= 1)
    assert.equal(Math.ceil(timer.fraction * 8), seconds, 'fill and displayed seconds must agree')
  } else {
    assert.equal(timer.text, expected)
    assert.equal(timer.fraction, expected === 'Приготовься' ? 1 : 0)
  }
}

async function assertRoundTimerLayout() {
  for (const [width, height] of [[280, 560], [390, 844], [1280, 720], [1920, 1080]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const layout = await evaluate(`(() => {
      const track = document.querySelector('.clock'), fill = document.querySelector('#clock'), label = document.querySelector('#clock-label');
      if (!label) return null;
      const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
      const original = { text: label.textContent, fill: fill.style.transform, hidden: document.querySelector('#scoreboard').hidden };
      document.querySelector('#scoreboard').hidden = false;
      const samples = ['Приготовься', 'До конца раунда · 8 с', 'До конца раунда · 1 с', 'Раунд окончен', 'Нокаут'].flatMap(text => [1, .5, 0].map(fraction => {
        label.textContent = text; fill.style.transform = 'scaleX(' + fraction + ')';
        const range = document.createRange(); range.selectNodeContents(label);
        return { text, track: box(track), ink: box(range), font: parseFloat(getComputedStyle(label).fontSize) };
      }));
      label.textContent = original.text; fill.style.transform = original.fill; document.querySelector('#scoreboard').hidden = original.hidden;
      return samples;
    })()`)
    assert.ok(layout && layout.length === 15, 'round clock must have a fixed label inside its track')
    for (const sample of layout) {
      assert.ok(sample.track.height >= 26 && sample.font >= 13, `round timer must be large enough: ${JSON.stringify(sample)}`)
      assert.ok(sample.ink.left >= sample.track.left + 2 && sample.ink.right <= sample.track.right - 2 && sample.ink.top >= sample.track.top + 2 && sample.ink.bottom <= sample.track.bottom - 2, `timer label must fit at ${width}×${height}: ${JSON.stringify(sample)}`)
      assert.deepEqual(sample.track, layout[0].track, 'clock labels and progress must not move the layout')
    }
  }
}

async function assertResultClear() {
  assert.equal((await state()).phase, 'done')
  for (const [width, height] of [[280, 560], [320, 568], [375, 667], [390, 844], [844, 390], [1000, 768], [1280, 720], [1920, 1080]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const results = await evaluate(`(() => {
      const label = document.querySelector('#callout-label'), original = label.textContent;
      const box = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const result = ['Луг за тобой.', 'Раунд за Быничем.', 'Ничья.', 'Нокаут!', 'Чемпион луга!'].map(text => {
        label.textContent = text;
        const range = document.createRange(); range.selectNodeContents(label);
        return { text, label: box(range), bulls: [...document.querySelectorAll('.fighter__body')].map(box), app: box(document.querySelector('#app')) };
      });
      label.textContent = original; return result;
    })()`)
    assert.equal(results.length, 5)
    for (const item of results) {
      assert.equal(item.bulls.length, 2)
      assert.ok(item.bulls.every(bull => item.label.bottom + 8 <= bull.top), `result text must stay above both bulls at ${width}×${height}: ${JSON.stringify(item)}`)
      assert.ok(item.label.left >= item.app.left && item.label.right <= item.app.right && item.label.top >= item.app.top, 'result text must fit inside the scene')
    }
  }
}

async function assertFear(you, bull) {
  const actual = await evaluate(`['you', 'bull'].map(side => {
    const fighter = document.querySelector('#fighter-' + side);
    return { level: Number(fighter.style.getPropertyValue('--fear')), scared: fighter.classList.contains('is-scared') };
  })`)
  for (const [index, expected] of [you, bull].entries()) {
    assert.ok(Math.abs(actual[index].level - expected) < .001, `opponent fear level: ${JSON.stringify(actual)}, expected ${you}, ${bull}`)
    assert.equal(actual[index].scared, expected > 0)
  }
}

async function fearDisplacement(side) {
  return evaluate(`(() => {
    const bull = document.querySelector('#fighter-${side} .bull');
    const animation = bull.getAnimations().find(animation => animation.animationName === 'tremble');
    if (!animation) return null;
    animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) * .25;
    const style = getComputedStyle(bull);
    const displacement = { x: Math.abs(parseFloat(style.translate)), angle: Math.abs(parseFloat(style.rotate)) };
    animation.play(); return displacement;
  })()`)
}

const state = () => evaluate(`({
  phase: document.querySelector('#app').dataset.phase,
  finish: document.querySelector('#app').dataset.finish,
  breath: document.querySelector('#app').dataset.breath,
  title: document.querySelector('#callout-label').textContent,
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
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__coinValue = .75; window.__draws = []; Math.random = () => window.__draws.length ? window.__draws.shift() : window.__coinValue;
    window.__gameContexts = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = new Proxy(NativeAudioContext, { construct(Target, args) {
      const ctx = new Target(...args); window.__gameContexts.push(ctx); ctx.__starts = []; ctx.__mooOnsets = [];
      const create = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => { const osc = create(), start = osc.start.bind(osc); osc.start = at => { ctx.__starts.push(at); start(at); }; const frequency = osc.frequency.setValueAtTime.bind(osc.frequency); osc.frequency.setValueAtTime = (hz, at) => { if (hz > 80 && hz < 200) ctx.__mooOnsets.push(at); return frequency(hz, at); }; return osc; };
      return ctx;
    } });
    window.__echoPeers = []; window.__gameTracks = [];
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(NativePeer, { construct(Target, args) {
      const peer = new Target(...args); window.__echoPeers.push(peer);
      const add = peer.addTrack.bind(peer);
      peer.addTrack = (track, ...rest) => { window.__gameTracks.push(track); return add(track, ...rest); };
      return peer;
    } });
  ` })
  const denied = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__micRequests = 0;
    navigator.mediaDevices.getUserMedia = () => {
      window.__micRequests++;
      return new Promise((_, reject) => { window.__denyMic = () => reject(new DOMException('Denied', 'NotAllowedError')); });
    };
  ` })
  await loaded(url)
  await evaluate(`document.fonts.ready`)
  const print = await evaluate(`(() => {
    const css = selector => getComputedStyle(document.querySelector(selector));
    return { paper: css('#app').backgroundColor, ink: css('#app').color,
      type: css('#callout').fontFamily, loaded: [...document.fonts].some(face => face.family === 'Oswald' && face.status === 'loaded'),
      scene: getComputedStyle(document.querySelector('.arena'), '::before').backgroundImage,
      buttons: [...document.querySelectorAll('.mode-nav button, #go')].map(node => node.getBoundingClientRect().height) };
  })()`)
  assert.equal(print.paper, 'rgb(244, 231, 208)', 'redesign must use warm print paper')
  assert.equal(print.ink, 'rgb(23, 62, 49)')
  assert.ok(print.type.includes('Oswald') && print.loaded, 'Cyrillic display type must load from the bundled font')
  assert.ok(print.scene.includes('arena-fence.webp'), 'daily duel must share the printed arena art')
  assert.equal(print.buttons.length, 3)
  assert.ok(print.buttons.every(height => height >= 44), 'primary controls need generous touch targets')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await evaluate(`document.querySelector('#go').focus()`)
  assert.equal(await evaluate(`document.querySelector('#go').matches(':focus-visible') && parseFloat(getComputedStyle(document.querySelector('#go')).outlineWidth) >= 2`), true, 'print treatment must retain visible keyboard focus')
  const bars = await evaluate(`['.player-window__track', '.bull-window__track'].map(selector => {
    const css = getComputedStyle(document.querySelector(selector)); return { height: parseFloat(css.height), border: parseFloat(css.borderTopWidth) };
  })`)
  assert.equal(bars.length, 2)
  assert.ok(bars.every(bar => bar.height >= 10 && bar.border >= 2), 'both breathing bars need the same substantial printed frame')
  const timerPaper = await evaluate(`['#player-window', '#bull-window'].map(selector => getComputedStyle(document.querySelector(selector)).backgroundColor)`)
  assert.deepEqual(timerPaper, [print.paper, print.paper], 'timer text needs opaque paper above the detailed scenery')
  await assertReadableHeadings(url)
  await assertRoundTimerLayout()
  await assertStableRoundLayout(url)
  await call('Network.enable')
  await call('Network.setCacheDisabled', { cacheDisabled: true })
  await call('Network.setBlockedURLs', { urls: ['*oswald*.ttf*'] })
  await loaded(url)
  await evaluate(`document.fonts.ready`)
  assert.equal(await evaluate(`[...document.fonts].some(face => face.family === 'Oswald' && face.status === 'error')`), true, 'fallback scenario must actually block the display font')
  for (const [width, height] of [[280, 560], [390, 844], [1280, 900]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    assert.equal(await evaluate(`(() => {
      const go = document.querySelector('#go'), title = document.querySelector('#callout');
      const box = go.getBoundingClientRect();
      return !go.disabled && title.scrollWidth <= title.clientWidth && box.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
    })()`), true, 'font failure must preserve readable entry and playable controls')
  }
  await assertStableCues('daily with missing display font')
  await assertReadableHeadings(url)
  await assertRoundTimerLayout()
  await assertStableRoundLayout(url)
  await checkMobileLayouts(url)
  await call('Network.setBlockedURLs', { urls: [] })
  await call('Network.setCacheDisabled', { cacheDisabled: false })
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await assertStableRoundLayout(url)
  await call('Emulation.setEmulatedMedia', { features: [] })
  await checkMobileLayouts(url)
  await checkMobileTouch(url)
  console.log('PASS: folk-punk print identity, readable controls, local Cyrillic font and font-failure fallback')
  const rhythmProgress = await call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('bynich.championship.v1', JSON.stringify({ version: 1, cleared: 2 }))` })
  await loaded(`${url}#championship`)
  const rhythmCases = [
    { draws: [.75, 0], starter: 'bull', onsets: [0, 2500, 4600], windows: [0, 1000, 2500, 3600, 4600, 5800], inhale: 1500 },
    { draws: [.75, 0], starter: 'bull', onsets: [0, 2200, 5000], windows: [0, 1200, 2200, 3100, 5000, 6200], inhale: 1000 },
    { draws: [.25, .99], starter: 'you', onsets: [2100, 5000, 7100], windows: [0, 2100, 3500, 5000, 6000, 7100], inhale: 2100 },
  ]
  for (const [attempt, expected] of rhythmCases.entries()) {
    await watchRoundLayout()
    await evaluate(`(() => {
      window.__draws = ${JSON.stringify(expected.draws)}; window.__breathChanges = [];
      const audio = window.__gameContexts.at(-1);
      if (audio) { audio.__starts = []; audio.__mooOnsets = []; }
      const app = document.querySelector('#app');
      window.__rhythmObserver?.disconnect();
      window.__rhythmObserver = new MutationObserver(() => {
        if (app.dataset.phase !== 'listen') return;
        const kind = app.dataset.breath, ctx = window.__gameContexts.at(-1);
        if (window.__breathChanges.at(-1)?.kind !== kind) window.__breathChanges.push({ kind, at: (ctx.currentTime - ctx.__starts[0] - 4) * 1000 });
      });
      window.__rhythmObserver.observe(app, { attributes: true, attributeFilter: ['data-breath'] });
      document.querySelector('#go').click(); if (window.__micRequests) window.__denyMic();
    })()`)
    await until(async () => (await state()).phase === 'invite', 'timer preparation begins')
    await assertRoundTimer('Приготовься')
    await pause(1000)
    await assertRoundTimer('Приготовься')
    await until(async () => (await state()).phase === 'listen', 'selected championship rhythm begins')
    await assertRoundTimer(8)
    assert.equal(await evaluate(`window.__draws.length`), 0, 'coin and rhythm must consume separate random draws')
    assert.equal(await evaluate(`document.querySelector('#app').dataset.starter`), expected.starter)
    const audio = await evaluate(`(() => { const ctx = window.__gameContexts.at(-1); return ctx.__mooOnsets.map(at => Math.round((at - ctx.__starts[0] - 4) * 1000)); })()`)
    assert.deepEqual(audio, expected.onsets, 'voice audio must use the selected pattern, including a different same-stage retry')
    await until(async () => (await state()).breath === 'inhale', 'first selected player window')
    await assertRoundTimer(expected.starter === 'you' ? 8 : 7)
    const time = await evaluate(`parseFloat(document.querySelector('#bull-time').textContent.replace(',', '.')) * 1000`)
    assert.ok(time > expected.inhale - 150 && time <= expected.inhale, `timer must show the selected inhale: ${time}`)
    await until(async () => (await state()).phase === 'done', 'selected pattern completes')
    await assertRoundTimer('Раунд окончен')
    const changes = await evaluate(`window.__breathChanges`)
    assert.equal(changes.length, 6)
    for (const [index, change] of changes.entries()) {
      assert.equal(change.kind, (index + (expected.starter === 'you' ? 1 : 0)) % 2 ? 'inhale' : 'voice')
      assert.ok(Math.abs(change.at - expected.windows[index]) < 100, `visible breath must follow the frozen audio plan: ${JSON.stringify(changes)}`)
    }
    await until(async () => !(await state()).hidden, 'retry selected rhythm')
    await assertWatchedRoundLayout()
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('bynich.championship.v1')).cleared`), 2, 'a different pattern must not grant progress')
    console.log(`PASS: championship rhythm ${attempt + 1} keeps audio, windows and timer synchronized`)
  }
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: rhythmProgress.identifier })
  await evaluate(`localStorage.removeItem('bynich.championship.v1')`)
  for (const mode of ['daily', 'championship']) {
    await loaded(mode === 'daily' ? url : `${url}#championship`)
    assert.equal(await evaluate(`document.querySelectorAll('.masthead, .tagline, #stage-mood, #date-label, .round-stamp, .versus, .arena__ring, .scoreboard__labels > span').length`), 0, 'remove secondary copy and repeated labels from the page')
    assert.equal(await evaluate(`document.querySelectorAll('.rules, .voice-level, .timer-caption').length`), 0, 'remove duplicate small captions and voice bars')
    assert.equal(await evaluate(`['#hint', '#advantage', '#edition-label', '#air'].every(selector => getComputedStyle(document.querySelector(selector)).clipPath === 'inset(50%)')`), true, 'secondary detail must stay out of the visual scene')
    assert.equal((await state()).privacy, '', 'idle screen needs no routine microphone or save footer')
    assert.equal(await evaluate(`document.querySelector('#edition-label').hidden`), mode === 'daily', 'only championship needs encounter context')
    for (const [width, height] of [[280, 560], [320, 568], [375, 667], [390, 844], [768, 1024], [1000, 768], [1280, 720], [1280, 900], [1440, 900], [1920, 1080], [844, 390]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      const layout = await evaluate(`(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const app = rect('#app'), go = rect('#go'), header = rect('.sheet'), bull = rect('#fighter-bull .fighter__body');
        const title = document.querySelector('#callout');
        return { width: app.width, scroll: document.documentElement.scrollWidth, buttonBottom: go.bottom,
          buttonRight: go.right, appBottom: app.bottom, bullWidth: bull.width, bullTop: bull.top, headerBottom: header.bottom,
          titleFits: title.scrollWidth <= title.clientWidth, privacyDisplay: getComputedStyle(document.querySelector('#privacy')).display,
          navFont: parseFloat(getComputedStyle(document.querySelector('.mode-nav button')).fontSize),
          timerFont: parseFloat(getComputedStyle(document.querySelector('#player-time')).fontSize) };
      })()`)
      assert.ok(layout.scroll <= width, `${mode} horizontal overflow at ${width}×${height}`)
      assert.ok(layout.titleFits && layout.buttonRight <= width && layout.buttonBottom <= layout.appBottom, `${mode} main controls must fit: ${JSON.stringify(layout)}`)
      assert.equal(layout.privacyDisplay, 'none', 'empty service message must take no space')
      if (height >= 560) assert.ok(layout.buttonBottom <= height, `${mode} start button below screen at ${width}×${height}`)
      if (width >= 1000) {
        assert.ok(layout.width >= 900, `desktop arena must use the available width: ${JSON.stringify(layout)}`)
        assert.ok(layout.navFont >= 16 && layout.timerFont >= 16, 'desktop feedback must use readable text')
        assert.ok(layout.bullTop >= layout.headerBottom, 'large bull must stay clear of the header')
        if (height >= 900) assert.ok(layout.bullWidth >= 240, 'desktop bulls must be visibly larger than phone sprites')
      }
      if (width === 1280 && height === 900 || width === 390) await screenshot(`clean-${mode}-${width}`)
    }
  }
  for (const mode of ['daily', 'championship']) {
    await loaded(mode === 'daily' ? url : `${url}#championship`)
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
    await evaluate(`window.__coinValue = .25; document.querySelector('#go').click(); window.__denyMic()`)
    await until(async () => (await state()).phase === 'listen', 'desktop fallback round begins')
    await checkInhale()
    await assertStableCues(mode)
    for (const [width, height] of [[1280, 720], [1000, 768], [1280, 900], [1920, 1080]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      const controls = await evaluate(`(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        return { button: box('#go').bottom, message: box('#privacy').bottom, gauge: box('.gauge').bottom, buttonTop: box('#go').top };
      })()`)
      assert.ok(controls.button <= height && controls.message <= height, `active ${mode} controls must fit at ${width}×${height}: ${JSON.stringify(controls)}`)
      assert.ok(controls.gauge < controls.buttonTop, 'score must stay clear of the button')
    }
    await screenshot(`clean-playing-${mode}-desktop`)
  }
  console.log('PASS: simplified page preserves essential controls and scales up on desktop')
  await loaded(url)
  await evaluate(`(() => {
    window.__countLabels = [];
    const label = document.querySelector('#callout-label');
    new MutationObserver(() => { const ctx = window.__gameContexts[0]; if (ctx) window.__countLabels.push({ text: label.textContent, time: ctx.currentTime * 1000, phase: document.querySelector('#app').dataset.phase }); }).observe(label, { childList: true });
    document.querySelector('#go').click(); window.__denyMic();
  })()`)
  await until(async () => (await state()).phase === 'listen', 'rhythmic countdown reaches the fight')
  const counts = await evaluate(`({ labels: window.__countLabels, origin: window.__gameContexts[0].__starts[0] * 1000 - 400 })`)
  for (const [index, text] of ['4', '3', '2', '1'].entries()) {
    const event = counts.labels.find(item => item.text === text);
    assert.ok(event, `missing visible count ${text}: ${JSON.stringify(counts)}`)
    assert.ok(Math.abs(event.time - counts.origin - (400 + index * 1000)) < 80, `visible ${text} must match its scheduled sound: ${JSON.stringify(counts)}`)
  }
  const startEvent = counts.labels.find(item => item.phase === 'listen')
  assert.ok(startEvent && Math.abs(startEvent.time - counts.origin - 4400) < 80, 'fight must begin after the full last beat')
  console.log('PASS: visible countdown and fight start follow the same evenly spaced audio clock')
  for (const first of ['you', 'bull']) {
    await loaded(url)
    await evaluate(`window.__coinValue = ${first === 'you' ? .25 : .75}; document.querySelector('#go').click()`)
    await until(async () => (await state()).phase === 'toss', 'coin toss before countdown')
    assert.equal(await evaluate(`document.querySelector('#coin-toss').hidden`), false)
    assert.equal(await evaluate(`document.querySelector('#scoreboard').hidden`), true)
    assert.equal((await state()).meter, 0)
    const before = await evaluate(`getComputedStyle(document.querySelector('.coin__spin')).transform`)
    await pause(100)
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.coin__spin')).transform`), before, 'coin must actually turn before revealing its side')
    await until(() => evaluate(`document.querySelector('#coin-toss').dataset.settled === 'true'`), 'coin result settles')
    assert.equal(await evaluate(`document.querySelector('#app').dataset.starter`), first)
    assert.equal((await state()).title, first === 'you' ? 'Первым мычишь ты!' : 'Первым мычит Бынич!')
    assert.ok(Math.abs(await evaluate(`new DOMMatrix(getComputedStyle(document.querySelector('.coin__spin')).transform).m11`) - (first === 'you' ? 1 : -1)) < .001, 'the visible coin face must match the announced starter')
    for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1000, 768], [1280, 900]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      const fits = await evaluate(`(() => { const coin = document.querySelector('#coin-toss').getBoundingClientRect(); const app = document.querySelector('#app').getBoundingClientRect(); const title = document.querySelector('#callout'); return coin.left >= app.left && coin.right <= app.right && coin.top >= app.top && coin.bottom <= app.bottom && title.scrollWidth <= title.clientWidth; })()`)
      assert.equal(fits, true, 'coin and first-turn announcement fit small screens')
    }
    await screenshot('coin-' + first)
    await evaluate(`window.__denyMic()`)
    await until(async () => (await state()).phase === 'hush', 'countdown follows settled coin')
    assert.equal(await evaluate(`document.querySelector('#coin-toss').hidden`), true)
    assert.match(await evaluate(`document.querySelector('#hint').textContent`), first === 'you' ? /Первым мычишь ты/ : /Первым мычит Бынич/)
    await until(async () => (await state()).phase === 'listen', 'announced first turn begins')
    assert.equal((await state()).breath, first === 'you' ? 'inhale' : 'voice')
    assert.equal(await evaluate(`document.querySelector('#fighter-bull').classList.contains('is-hot')`), first === 'bull')
    if (first === 'you') {
      await checkInhale()
      await until(() => evaluate(`document.querySelector('#app').dataset.bullCue === 'warning'`), 'last half-second warns of the attack')
      const warning = await evaluate(`({ text: document.querySelector('#bull-time').textContent, color: getComputedStyle(document.querySelector('#bull-window')).color })`)
      assert.match(warning.text, /^0,[1-5] с$/)
      assert.equal(warning.color, 'rgb(182, 59, 42)')
      await screenshot('bull-about-to-moo')
      await until(async () => (await state()).breath === 'voice', 'bull begins after opening inhale')
      assert.equal(await evaluate(`document.querySelector('#bull-action').textContent`), 'Бынич мычит')
      assert.equal(await evaluate(`document.querySelector('#app').dataset.bullCue`), 'voice')
      assert.equal(await evaluate(`document.querySelector('#player-meter').getAttribute('aria-valuenow')`), '0')
      assert.equal(await evaluate(`document.querySelector('#player-window').hidden`), true)
      assert.match((await state()).title, /^(ПАУЗА|ЖДИ)$/)
    }
  }
  await loaded(url)
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'toss', 'static coin with reduced motion')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.coin__spin')).animationName`), 'none')
  await evaluate(`document.querySelector('.mode-nav [data-mode="championship"]').click(); window.__denyMic()`)
  await pause(1900)
  assert.equal((await state()).phase, undefined)
  assert.equal(await evaluate(`document.querySelector('#coin-toss').hidden`), true)
  assert.equal(await evaluate(`document.querySelector('#app').dataset.starter`), undefined)
  await call('Emulation.setEmulatedMedia', { features: [] })
  console.log('PASS: both coin outcomes match the first live breath; reduced motion and cancelled tosses reset safely')
  const unlocked = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('bynich.championship.v1', JSON.stringify({ version: 1, cleared: 5 }));
  ` })
  await loaded(`${url}#championship`)
  const atlas = await evaluate(`(async () => {
    const sprite = document.querySelector('.bull__championship');
    const source = getComputedStyle(sprite).backgroundImage.slice(4, -1).replaceAll('"', '');
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const w = canvas.width / 4, h = canvas.height / 2, frames = [];
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
      let edge = 0, content = 0, clipped = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const alpha = pixels[((row * h + y) * canvas.width + col * w + x) * 4 + 3];
        if (x < 24 || x >= w - 24 || y < 24 || y >= h - 24) edge = Math.max(edge, alpha);
        else if (alpha > 200) content++;
        if (alpha > 24 && (x < 50 || x >= 334 || y < 66 || y >= 446)) clipped++;
      }
      frames.push({ row, col, edge, content, clipped });
    }
    return { width: canvas.width, height: canvas.height, frames };
  })()`)
  assert.equal(atlas.width, 1536); assert.equal(atlas.height, 1024)
  assert.equal(atlas.frames.length, 8)
  for (const frame of atlas.frames) {
    assert.equal(frame.clipped, 0, `bull anatomy and steam must fit the visible source window: ${JSON.stringify(frame)}`)
    assert.ok(frame.edge <= 4, `sprite must have clear gutters: ${JSON.stringify(frame)}`)
    assert.ok(frame.content > 15000, `sprite must retain visible colored artwork: ${JSON.stringify(frame)}`)
  }
  console.log('PASS: all eight championship sprites have empty gutters and complete visible content')
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  for (const stage of [0, 1, 2, 3, 4, 2, 0, 4]) {
    await evaluate(`document.querySelector('.stage-step[data-stage="${stage}"]').click()`)
    await assertScene(...stageScenes[stage])
    if ([0, 2, 4].includes(stage)) await screenshot(`location-${stageScenes[stage][0]}`)
  }
  await evaluate(`document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '* { transition: none !important; }' }))`)
  for (const [width, height] of [[320, 844], [280, 844], [320, 568], [350, 844], [360, 800], [375, 844], [390, 844], [520, 900], [521, 900], [844, 390], [1000, 768], [1280, 900], [1920, 1080]]) {
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
          for (const actor of [fighter, you]) { actor.classList.add('is-scared'); actor.style.setProperty('--fear', '1'); }
          app.style.setProperty('--inhale', pose === 'inhale' ? '1' : '0');
          for (const pull of [-0.99, 0, 0.99]) {
            app.style.setProperty('--tug', String(pull));
            for (const progress of [0, 0.25, 0.32, 0.5, 0.68, 0.75]) {
              for (const body of document.querySelectorAll('.fighter__body, .bull')) {
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
  assert.match(await evaluate(`getComputedStyle(document.querySelector('.arena'), '::before').backgroundImage`), /arena-fence\.webp/)
  await call('Network.setBlockedURLs', { urls: [] })
  await call('Network.setCacheDisabled', { cacheDisabled: false })
  await evaluate(`localStorage.removeItem('bynich.championship.v1')`)
  console.log('PASS: both bulls fit all five championship stages at pull and animation extremes across thirteen screen sizes')
  console.log('PASS: championship scenes follow stage selection, replay selection and restored progress')
  console.log('PASS: unavailable background retains the location palette and playable round controls')

  await loaded(url)
  async function audioModule(entry) {
    const built = await build({ configFile: false, logLevel: 'silent', build: {
      write: false, minify: false, lib: { entry, formats: ['es'] },
    } })
    const code = [built].flat().flatMap(result => result.output).find(output => output.type === 'chunk').code
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  }
  const voiceModule = await audioModule('src/audio/voice.ts')
  const countModule = await audioModule('src/audio/count.ts')
  const rendered = await evaluate(`(async () => {
    const { playBull } = await import(${JSON.stringify(voiceModule)});
    const { playCountdown } = await import(${JSON.stringify(countModule)});
    const routed = [];
    for (const muted of [false, true]) {
      const ctx = new OfflineAudioContext(1, 144000, 48000);
      const bus = ctx.createGain(); bus.gain.value = muted ? 0 : 1; bus.connect(ctx.destination);
      playBull(ctx, { pitch: 110, fury: 4, segments: [{ kind: 'voice', ms: 1000 }] }, .1, bus);
      playCountdown(ctx, 0, bus);
      const data = (await ctx.startRendering()).getChannelData(0);
      routed.push(data.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0));
    }
    const results = [];
    for (const fury of [0, 1, 2, 3, 4]) {
      const ctx = new OfflineAudioContext(1, 96000, 48000);
      playBull(ctx, { pitch: 110, fury, segments: [{ kind: 'voice', ms: 1200 }, { kind: 'inhale', ms: 800 }] }, 0);
      const data = (await ctx.startRendering()).getChannelData(0);
      let energy = 0, peak = 0, tail = 0, subRe = 0, subIm = 0;
      const points = [[0, 114.4], [.192, 118.8], [.66, 108.9], [1.2, 101.2]];
      function phase(t) {
        let cycles = 0;
        for (let i = 1; i < points.length; i++) {
          const [a, fa] = points[i - 1], [b, fb] = points[i];
          const dt = Math.max(0, Math.min(t, b) - a), rate = Math.log(fb / fa) / (b - a);
          cycles += fa * Math.expm1(rate * dt) / rate;
        }
        return cycles * Math.PI;
      }
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
        if (i >= 7200 && i < 50400) {
          energy += data[i] ** 2;
          subRe += data[i] * Math.cos(phase(i / 48000));
          subIm += data[i] * Math.sin(phase(i / 48000));
        }
        if (i >= 62400) tail += data[i] ** 2;
      }
      const rms = Math.sqrt(energy / 43200);
      results.push({ fury, rms, peak, tail, split: Math.hypot(subRe, subIm) / 43200 / rms });
    }
    const stopped = new OfflineAudioContext(1, 48000, 48000);
    const stop = playBull(stopped, { pitch: 110, fury: 4, segments: [{ kind: 'voice', ms: 800 }] }, .1);
    stop(); stop();
    const countContext = new OfflineAudioContext(1, 240000, 48000);
    playCountdown(countContext, .1);
    const countData = (await countContext.startRendering()).getChannelData(0), countOnsets = [];
    for (let i = 0; i < countData.length; i++) {
      if (Math.abs(countData[i]) > .01) { countOnsets.push(i / 48000); i += 14400; }
    }
    return { countOnsets, routed, profiles: results, stoppedPeak: Math.max(...(await stopped.startRendering()).getChannelData(0).map(Math.abs)) };
  })()`)
  console.log('Audio renders:', JSON.stringify(rendered))
  assert.equal(rendered.countOnsets.length, 5, 'all five countdown sounds must actually render')
  for (let index = 0; index < 5; index++) {
    assert.ok(Math.abs(rendered.countOnsets[index] - (.5 + index)) < .02, 'rendered onset must match the shared beat')
    if (index > 0) assert.ok(Math.abs(rendered.countOnsets[index] - rendered.countOnsets[index - 1] - 1) < .003, 'audible countdown intervals must be equal')
  }
  assert.ok(rendered.routed[0] > 0.1, 'game audio must be audible through its output bus')
  assert.equal(rendered.routed[1], 0, 'neither bull nor countdown may bypass the echo reference bus')
  assert.equal(rendered.profiles.length, 5)
  for (const [index, profile] of rendered.profiles.entries()) {
    assert.ok(profile.rms > 0.01 && profile.peak < 0.95, `audible unclipped voice: ${JSON.stringify(profile)}`)
    assert.ok(profile.tail < 1e-8, 'bull must be silent on inhale')
    if (index > 0) {
      assert.ok(profile.rms > rendered.profiles[index - 1].rms, 'angrier voice must render louder')
      assert.ok(profile.split > rendered.profiles[index - 1].split, 'angrier voice must render stronger subharmonics')
    }
  }
  assert.ok(rendered.profiles[4].split > rendered.profiles[0].split + 0.05)
  assert.equal(rendered.stoppedPeak, 0)
  console.log('PASS: actual offline audio gets louder and more split; inhales and stop are silent')

  assert.equal(await evaluate(`document.querySelector('#app').dataset.scene`), undefined)
  assert.match(await evaluate(`getComputedStyle(document.querySelector('.arena'), '::before').backgroundImage`), /arena-fence\.webp/)
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
    assert.equal(layout.paper, 'rgb(244, 231, 208)')
    if (width === 390 || width === 1280) await screenshot(`idle-${width}`)
  }
  console.log('PASS: entry copy, assets, and layout at five screen sizes')

  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 1, mobile: false })
  await evaluate(`document.querySelector('#go').click()`)
  assert.equal((await state()).button, 'Готовимся к бою…')
  assert.equal((await state()).disabled, true)
  await evaluate(`window.__denyMic()`)
  await until(async () => (await state()).button === 'Зажми и тяни', 'fallback control')
  assert.equal((await state()).privacy, '', 'the hold button needs no duplicate fallback caption')
  assert.equal((await state()).title, 'Тише…')
  await assertAdvantage('even', 'Равные силы')
  assert.equal(await evaluate(`document.querySelector('#fighter-bull').classList.contains('is-inhaling')`), false)
  await evaluate(`document.querySelector('#go').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1 }))`)
  await assertFear(0, 0)
  await until(async () => (await state()).phase === 'listen', 'countdown to play')
  await assertFear(2 / 3, 2 / 3)
  for (const [width, height] of [[1280, 900], [1000, 768], [320, 568], [375, 667]]) {
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
    assert.ok(layout.meterBottom < layout.buttonTop, 'meter and button must not overlap')
  }
  await checkInhale(true, true)
  await assertFear(0, 2 / 3)
  assert.ok((await fearDisplacement('bull'))?.x > 0, 'bull must visibly tremble during its inhale')
  await screenshot('daily-inhale')
  await until(async () => (await state()).phase === 'listen' && (await state()).meter > 8, 'player takes the lead')
  await assertAdvantage('you', 'Ты ведёшь')
  await until(async () => (await state()).phase === 'done', 'held button wins')
  assert.equal((await state()).title, (await state()).finish === 'knockout' ? 'Нокаут!' : 'Луг за тобой.')
  assert.equal((await state()).loser, 'fighter-bull')
  assert.ok((await state()).meter > 8)
  await until(async () => (await state()).button === 'Ещё раунд ↗', 'replay after win')
  await assertAdvantage('you', (await state()).finish === 'knockout' ? 'Ты победил нокаутом' : 'Ты победил')
  assert.equal(await evaluate(`document.querySelector('#fighter-bull').classList.contains('is-inhaling')`), false)
  await assertFear(0, 0)
  assert.equal(await evaluate(`document.querySelector('#player-meter').getAttribute('aria-valuenow')`), '0')
  assert.equal(await fearDisplacement('bull'), null)
  await assertResultClear()
  await screenshot('win')
  console.log('PASS: permission pending → denied → countdown → hold → win → replay')

  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'hush', 'replay resets round')
  await assertRoundTimer('Приготовься')
  assert.equal((await state()).meter, 0)
  await assertFear(0, 0)
  assert.equal((await state()).loser, undefined)
  assert.equal((await state()).requests, 1)
  await assertAdvantage('even', 'Равные силы')
  await until(async () => (await state()).phase === 'listen' && (await state()).meter < -8, 'bull takes the lead')
  await assertAdvantage('bull', 'Бынич ведёт')
  await assertFear(2 / 3, 0)
  assert.ok((await fearDisplacement('you'))?.x > 0, 'player must visibly tremble from the bull voice')
  await until(async () => (await state()).phase === 'done', 'unheld button loses')
  assert.equal((await state()).title, (await state()).finish === 'knockout' ? 'Нокаут!' : 'Раунд за Быничем.')
  assert.equal((await state()).loser, 'fighter-you')
  await until(async () => (await state()).button === 'Ещё раунд ↗', 'replay after loss')
  await assertAdvantage('bull', (await state()).finish === 'knockout' ? 'Бынич победил нокаутом' : 'Бынич победил')
  await assertResultClear()
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
    assert.equal(await evaluate(`window.__echoPeers.length === 2 && window.__echoPeers.every(p => p.connectionState === 'connected')`), true)
    if (vowel === 'u') {
      await evaluate(`window.__voiceLevel.gain.value = 0.025`)
      await until(() => evaluate(`Number(document.querySelector('#fighter-you').style.getPropertyValue('--power')) > .1`), 'soft moo produces a visible level')
      const soft = await evaluate(`Number(document.querySelector('#fighter-you').style.getPropertyValue('--power'))`)
      const softShake = await fearDisplacement('bull')
      assert.ok(softShake?.x > 0 && softShake?.angle > 0)
      await evaluate(`window.__voiceLevel.gain.value = 0.7`)
      await until(() => evaluate(`Number(document.querySelector('#fighter-you').style.getPropertyValue('--power')) > ${soft + .1}`), 'louder moo increases visible pressure')
      const loudShake = await fearDisplacement('bull')
      assert.ok(loudShake.x > softShake.x + .2 && loudShake.angle > softShake.angle, 'louder moo must produce a larger visible tremble at the same animation phase')
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      assert.deepEqual(await evaluate(`(() => { const style = getComputedStyle(document.querySelector('#bull-bull')); return [style.animationName, style.translate, style.rotate]; })()`), ['none', 'none', 'none'])
      await call('Emulation.setEmulatedMedia', { features: [] })
      await evaluate(`window.__voiceLevel.gain.value = 0`)
      await until(() => evaluate(`!document.querySelector('#fighter-bull').classList.contains('is-scared')`), 'silence stops opponent fear')
      assert.equal(await fearDisplacement('bull'), null)
      await evaluate(`window.__voiceLevel.gain.value = 0.7`)

    } else {
      await evaluate(`window.__voiceLevel.gain.value = 0.7`)
      await pause(150)
      assert.equal(await fearDisplacement('bull'), null, 'loud non-moo must not scare the opponent')
    }

    await until(async () => (await state()).phase === 'done', `distorted ${vowel} audio round`)
    assert.equal((await state()).title, (await state()).finish === 'knockout' ? 'Нокаут!' : vowel === 'u' ? 'Луг за тобой.' : 'Раунд за Быничем.')
    assert.equal((await state()).loser, vowel === 'u' ? 'fighter-bull' : 'fighter-you')
    if (vowel === 'u') {
      assert.equal((await state()).finish, 'knockout')
      assert.equal((await state()).title, 'Нокаут!')
      assert.equal(await evaluate(`document.querySelector('#app').classList.contains('is-ko')`), true)
      assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('#fighter-bull')).animationName`), 'none')
      await screenshot('knockout')
    }
    await assertFear(0, 0)
    assert.equal(await evaluate(`window.__echoPeers.every(p => p.connectionState === 'closed') && window.__gameTracks.length === 1 && window.__gameTracks.every(t => t.readyState === 'ended') && !document.querySelector('audio[data-echo-reference]')`), true)
    assert.equal(await evaluate(`window.__voiceTracks.every(track => track.readyState === 'ended')`), true)
    await evaluate(`window.__voiceContext.close()`)
  }
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: syntheticVoice.identifier })
  console.log('PASS: distorted rounded vowel wins through Web Audio microphone input; open vowel loses')

  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__micTracks = [];
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__captureConstraints = constraints;
      const stream = await acquire(constraints);
      window.__micTracks.push(...stream.getTracks());
      return stream;
    };
  ` })
  await loaded(url)
  await mobileViewport(390,844)
  await watchRoundLayout()
  await touch('#go')
  await until(async () => (await state()).hidden, 'microphone mode hides fallback control')
  assert.equal((await state()).privacy, '', 'working microphone needs no routine status footer')
  assert.equal(await evaluate(`window.__micTracks.length > 0 && window.__micTracks.every(t => t.readyState === 'live')`), true)
  assert.deepEqual(await evaluate(`window.__captureConstraints.audio`), { echoCancellation: true, noiseSuppression: false, autoGainControl: false })
  const settings = await evaluate(`window.__micTracks[0].getSettings()`);
  assert.equal(settings.echoCancellation, true)
  assert.equal(settings.autoGainControl, false)
  assert.equal(settings.noiseSuppression, false)
  console.log('Native capture settings:', JSON.stringify({ echoCancellation: settings.echoCancellation, autoGainControl: settings.autoGainControl, noiseSuppression: settings.noiseSuppression }))
  const reference = await evaluate(`(async () => {
    const player = document.querySelector('audio[data-echo-reference]');
    const stats = [...(await window.__echoPeers[1].getStats()).values()];
    return { connected: window.__echoPeers.map(p => p.connectionState),
      servers: window.__echoPeers.map(p => p.getConfiguration().iceServers),
      playing: player && !player.paused && player.srcObject.getAudioTracks().length === 1,
      received: stats.some(s => s.type === 'inbound-rtp' && s.kind === 'audio' && s.bytesReceived > 0),
      noMic: window.__gameTracks.length === 1 && window.__gameTracks.every(t => !window.__micTracks.includes(t)),
      protected: document.querySelector('#app').dataset.echoCancellation };
  })()`)
  assert.deepEqual(reference, { connected: ['connected', 'connected'], servers: [[], []], playing: true, received: true, noMic: true, protected: 'true' })
  await until(async () => (await state()).phase === 'done', 'microphone round finishes')
  assert.equal(await evaluate(`window.__micTracks.length > 0 && window.__micTracks.every(t => t.readyState === 'ended')`), true)
  assert.equal((await state()).privacy, '', 'result should not repeat the round-ended message')
  await until(async () => !(await state()).hidden && (await state()).button === 'Ещё раунд ↗', 'microphone replay')
  await assertWatchedRoundLayout()
  console.log('PASS: real Chrome fake microphone opens, fallback hides, tracks close, replay returns')
  await call('Emulation.setTouchEmulationEnabled',{enabled:false})
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false})
  const unavailableReference = await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.RTCPeerConnection = undefined;` })
  await loaded(url)
  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'hush', 'missing WebRTC keeps round playable')
  assert.equal(await evaluate(`document.querySelector('#app').dataset.echoCancellation`), 'false')
  assert.match((await state()).privacy, /наушниках/)
  assert.ok(await evaluate(`document.querySelector('#privacy').getBoundingClientRect().height`) > 0, 'headphones advice must stay visible')
  await evaluate(`document.querySelector('.mode-nav [data-mode="championship"]').click()`)
  assert.equal(await evaluate(`window.__micTracks.length > 0 && window.__micTracks.every(t => t.readyState === 'ended') && !document.querySelector('audio[data-echo-reference]')`), true)
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: unavailableReference.identifier })
  console.log('PASS: local WebRTC receives game audio without microphone transmission; unavailable reference falls back honestly')
  const pendingReference = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const createOffer = RTCPeerConnection.prototype.createOffer;
    RTCPeerConnection.prototype.createOffer = function (...args) {
      return new Promise((resolve, reject) => {
        window.__resolveReference = () => createOffer.apply(this, args).then(resolve, reject);
      });
    };
  ` })
  await loaded(url)
  await evaluate(`document.querySelector('#go').click()`)
  await until(() => evaluate(`typeof window.__resolveReference === 'function'`), 'echo reference is pending')
  await evaluate(`document.querySelector('.mode-nav [data-mode="championship"]').click(); window.__resolveReference();`)
  await until(() => evaluate(`window.__echoPeers.length === 2 && window.__echoPeers.every(p => p.connectionState === 'closed') && !document.querySelector('audio[data-echo-reference]')`), 'late playback is discarded')
  assert.equal((await state()).phase, undefined)
  assert.equal(await evaluate(`window.__micTracks.length > 0 && window.__micTracks.every(t => t.readyState === 'ended') && window.__gameTracks.every(t => t.readyState === 'ended')`), true)
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: pendingReference.identifier })
  console.log('PASS: mode change during echo setup closes the late connection and never starts a stale round')
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
  await until(async () => (await state()).phase === 'listen', 'enemy indicator is active before switching modes')
  assert.equal(await evaluate(`document.querySelector('#bull-window').hidden`), false)
  await evaluate(`document.querySelector('.mode-nav [data-mode="daily"]').click()`)
  assert.equal((await state()).phase, undefined)
  assert.equal(await evaluate(`window.__micTracks.length > 0 && window.__micTracks.every(t => t.readyState === 'ended')`), true)
  assert.equal(await evaluate(`document.querySelector('#air').hidden`), true)
  assert.equal(await evaluate(`localStorage.getItem('bynich.championship.v1')`), null)
  await assertFear(0, 0)
  assert.equal(await evaluate(`document.querySelector('#bull-window').hidden && document.querySelector('#bull-meter').getAttribute('aria-valuenow') === '0' && !document.querySelector('#app').dataset.bullCue`), true)
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
    assert.ok(layout.stageBottom < layout.buttonTop, 'stage navigation overlaps button')
    if (layout.noticeVisible) assert.ok(layout.noticeBottom <= height, 'save failure notice below screen')
  }

  await campaignLayout(320, 568, 'championship-preview-small')
  await campaignLayout(390, 844, 'championship-preview')
  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'listen', 'championship begins')
  await campaignLayout(1280, 900, 'championship-playing-desktop')
  await campaignLayout(320, 568, 'championship-playing-small')
  await until(() => evaluate(`document.querySelector('#app').dataset.cue === 'moo' && Number(document.querySelector('#clock').style.transform.slice(7, -1)) < .25`), 'last player window remains available before the finish')
  await until(async () => (await state()).phase === 'done', 'championship loss')
  await until(async () => (await state()).button === 'Попробовать ещё ↗', 'retry lost stage')
  assert.equal(await evaluate(`document.querySelectorAll('.stage-step:not(:disabled)').length`), 1)
  assert.equal(await evaluate(`localStorage.getItem('bynich.championship.v1')`), null)
  assert.equal((await state()).finish, 'time')
  assert.equal(await evaluate(`document.querySelector('#app').classList.contains('is-ko')`), false)
  console.log('PASS: campaign loss retries the same encounter without unlocking anything')
  await assertScene(...stageScenes[0])

  async function winEncounter(key = '', first = 'bull', alreadyStarted = false) {
    await evaluate(`(() => {
      window.__coinValue = ${first === 'you' ? .25 : .75};
      if (!${alreadyStarted}) document.querySelector('#go').click();
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
    await checkInhale(false, true)
    await until(async () => (await state()).phase === 'done', 'timed championship win')
    assert.ok((await state()).meter > 8, `timed input must win: ${JSON.stringify(await state())}`)
    await until(async () => !(await state()).hidden, 'championship result action')
    await assertResultClear()
  }

  for (let stage = 0; stage < 5; stage++) {
    if (stage === 1) await loaded(`${url}#championship`)
    else if (stage > 1) {
      await evaluate(`window.__coinValue = ${stage % 2 === 1 ? .25 : .75}; document.querySelector('#go').click()` )
      assert.equal((await state()).phase, 'toss', 'one click must start the next encounter; repeated click must not skip it')
      assert.equal((await state()).disabled, true)
      await evaluate(`document.querySelector('#go').click()`)
    }
    assert.equal(await evaluate(`document.querySelector('#app').dataset.fury`), String(stage))
    await assertScene(...stageScenes[stage])
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
    if (stage > 0) {
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bull__championship')).display`), 'block')
      const alphaAtlas = await evaluate(`fetch(new URL('art/bull-championship-isolated.webp', location.href)).then(r => r.ok)`)
      assert.equal(alphaAtlas, true)
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bull__championship')).filter`), 'none')
    }
    await screenshot(`championship-stage-${stage + 1}`)
    await winEncounter(stage === 0 ? ' ' : stage === 1 ? 'Enter' : '', stage % 2 === 1 ? 'you' : 'bull', stage > 1)
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
  assert.equal((await state()).phase, 'toss', 'restart must start the first encounter immediately')
  await evaluate(`document.querySelector('.mode-nav [data-mode="daily"]').click(); document.querySelector('.mode-nav [data-mode="championship"]').click()` )
  assert.equal(await evaluate(`document.querySelectorAll('.stage-step:not(:disabled)').length`), 5)
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('bynich.championship.v1')).cleared`), 5)
  await evaluate(`document.querySelector('.stage-step[data-stage="4"]').click()`)
  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'listen', 'hard-stage replay')
  await evaluate(`document.querySelector('#go').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3 }))`)
  await until(() => evaluate(`document.querySelector('#app').classList.contains('is-exhausted')`), 'continuous input exhausts air')
  assert.equal((await state()).title, 'ПАУЗА')
  assert.equal(await fearDisplacement('bull'), null, 'an exhausted moo must not scare the opponent')
  assert.equal(await evaluate(`document.querySelector('.air__track').getAttribute('aria-valuenow')`), '0')
  await campaignLayout(320, 568, 'championship-exhausted-small')
  await until(async () => (await state()).phase === 'done', 'continuous input loses hard encounter')
  assert.equal((await state()).title, (await state()).finish === 'knockout' ? 'Нокаут!' : 'Раунд за Быничем.')
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('bynich.championship.v1')).cleared`), 5)
  await until(async () => (await state()).button === 'Попробовать ещё ↗', 'hard encounter retry')
  await watchRoundLayout()
  await evaluate(`document.querySelector('#go').click()`)
  await until(async () => (await state()).phase === 'done', 'quiet player is knocked out by the final bull')
  await until(async () => !(await state()).hidden, 'knockout result action returns')
  await assertWatchedRoundLayout()
  assert.equal((await state()).finish, 'knockout')
  await assertRoundTimer('Нокаут')
  assert.equal((await state()).title, 'Нокаут!')
  assert.equal((await state()).loser, 'fighter-you')
  assert.equal(await evaluate(`document.querySelector('#app').classList.contains('is-ko')`), true)
  await assertAdvantage('bull', 'Бынич победил нокаутом')
  await screenshot('bull-knockout')
  await evaluate(`document.querySelector('.mode-nav [data-mode="daily"]').click()`)
  assert.match((await state()).button, /Принять вызов/)
  assert.equal(await evaluate(`document.querySelector('#stage-path').hidden && document.querySelector('#air').hidden`), true)
  assert.equal(await evaluate(`document.querySelector('#app').dataset.scene`), undefined)
  assert.match(await evaluate(`getComputedStyle(document.querySelector('.arena'), '::before').backgroundImage`), /arena-fence\.webp/)
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
