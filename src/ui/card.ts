export interface CardInput {
  label: string
  text: string
  stamp: string
  share: string
  waveform: number[]
  pleased: boolean
}

export function drawCard(canvas: HTMLCanvasElement, card: CardInput): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#d9f1ff')
  sky.addColorStop(0.46, '#eef8f2')
  sky.addColorStop(1, '#c9e7b4')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.shadowColor = 'rgba(36, 28, 22, 0.14)'
  ctx.shadowBlur = 48
  ctx.shadowOffsetY = 22
  roundRect(ctx, 70, 80, w - 140, h - 160, 48, '#fffdf9')
  ctx.restore()

  ctx.fillStyle = '#8d7564'
  ctx.font = '600 30px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('ПРОТОКОЛ', w / 2, 180)
  ctx.fillStyle = '#241c16'
  ctx.font = '600 46px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(card.label, w / 2, 246)

  drawBull(ctx, w / 2, 470, card.pleased)
  drawWave(ctx, 160, 760, w - 320, 220, card.waveform)

  ctx.fillStyle = '#241c16'
  ctx.font = '52px Georgia, serif'
  ctx.textAlign = 'center'
  const lines = wrap(ctx, `«${card.text}»`, w - 220)
  let y = 1120
  for (const line of lines) {
    ctx.fillText(line, w / 2, y)
    y += 72
  }

  ctx.save()
  ctx.translate(w - 250, h - 420)
  ctx.rotate(-0.18)
  ctx.strokeStyle = card.pleased ? '#12924f' : '#ef5b4c'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(0, 0, 110, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = ctx.strokeStyle
  ctx.font = '700 34px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(card.stamp.toUpperCase(), 0, 12)
  ctx.restore()

  ctx.fillStyle = '#8d7564'
  ctx.font = '30px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText(card.share, w / 2, h - 180)
}

function drawBull(ctx: CanvasRenderingContext2D, x: number, y: number, pleased: boolean): void {
  ctx.fillStyle = '#c98a5b'
  ctx.beginPath()
  ctx.ellipse(x, y, 150, 130, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f0e0c4'
  ctx.beginPath()
  ctx.ellipse(x - 90, y - 120, 46, 18, -0.8, 0, Math.PI * 2)
  ctx.ellipse(x + 90, y - 120, 46, 18, 0.8, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.ellipse(x - 48, y - 10, 28, 34, 0, 0, Math.PI * 2)
  ctx.ellipse(x + 48, y - 10, 28, 34, 0, 0, Math.PI * 2)
  ctx.fill()
  if (pleased) {
    ctx.strokeStyle = '#3b2314'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(x - 48, y + 4, 16, Math.PI, 0)
    ctx.arc(x + 48, y + 4, 16, Math.PI, 0)
    ctx.stroke()
  } else {
    ctx.fillStyle = '#85c6ec'
    ctx.beginPath()
    ctx.arc(x - 48, y - 4, 16, 0, Math.PI * 2)
    ctx.arc(x + 48, y - 4, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#3b2314'
    ctx.beginPath()
    ctx.arc(x - 48, y - 2, 8, 0, Math.PI * 2)
    ctx.arc(x + 48, y - 2, 8, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#ecc6a3'
  ctx.beginPath()
  ctx.ellipse(x, y + 70, 54, 36, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  wave: number[],
): void {
  ctx.strokeStyle = '#ef5b4c'
  ctx.lineWidth = 7
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const mid = y + h / 2
  wave.forEach((value, i) => {
    const px = x + (i / Math.max(1, wave.length - 1)) * w
    const py = mid - value * (h / 2)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.stroke()
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > max && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}
