import { FLOW_LIMITS, FLOW_TIMELINE as T, flowResolution, smooth } from './config'
import { prepareFlowShapes } from './paths'

const TAU = Math.PI * 2
const { coreFibers, extraFibers, points } = FLOW_LIMITS
const palette = ['#8e6aff', '#b08bff', '#7865ea', '#6466fa', '#9299ff', '#6b93f6']
const mix = (a: number, b: number, t: number): number => a + (b - a) * t

function noise(index: number, channel: number): number {
  const value = Math.sin(index * 127.1 + channel * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function makeSeed() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 96
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const glow = ctx.createRadialGradient(48, 48, 0, 48, 48, 48)
  glow.addColorStop(0, '#f3ebff')
  glow.addColorStop(0.06, '#cdb3ff')
  glow.addColorStop(0.15, '#9874ff9c')
  glow.addColorStop(0.42, '#7450ef2b')
  glow.addColorStop(1, '#5838ac00')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 96, 96)
  return canvas
}

export function createFlowRenderer(canvas: HTMLCanvasElement) {
  const light = document.createElement('canvas')
  const frontContext = canvas.getContext('2d')
  const bloomContext = light.getContext('2d')
  if (!frontContext || !bloomContext) throw new Error('Canvas 2D is unavailable')
  const front = frontContext
  const bloom = bloomContext
  const shapes = prepareFlowShapes(coreFibers, points)
  const seed = makeSeed()
  const xs = new Float32Array(points)
  const ys = new Float32Array(points)
  const fibers = Array.from({ length: coreFibers + extraFibers }, (_, index) => {
    const title = shapes.title[index % coreFibers]
    const letterX = title[points - 1] / shapes.titleWidth + 0.5
    const lane = 2 * noise(index, 1) - 1
    return {
      title,
      mark: shapes.mark[(index * 37) % coreFibers],
      letterX,
      lane,
      band: Math.sign(lane) * (0.33 + Math.abs(lane) * 0.67),
      phase: noise(index, 2) * TAU,
      reach: 0.54 + noise(index, 3) * 0.46,
      rate: 0.66 + noise(index, 4) * 0.72,
      orbit:
        (lane > 0 ? 1 - letterX : letterX) * Math.PI +
        (lane > 0 ? 0 : Math.PI) +
        noise(index, 5) * 0.45,
      span: 0.8 + noise(index, 6) * 2.15,
      power: 0.27 + noise(index, 7) * 0.73,
      color: palette[index % palette.length]
    }
  })

  let w = 1
  let h = 1
  let ratio = 1
  let glowRatio = 1
  let markScale = 1
  let titleScale = 1
  let markTint: CanvasGradient
  let flare: CanvasGradient
  let low = false

  function resize(width: number, height: number, dpr: number, economy: boolean): void {
    if (width <= 0 || height <= 0) return
    w = width
    h = height
    low = economy
    ratio = flowResolution(w, h, dpr, low)
    glowRatio = ratio * (low ? 0.28 : 0.38)
    canvas.width = Math.max(1, Math.round(w * ratio))
    canvas.height = Math.max(1, Math.round(h * ratio))
    light.width = Math.max(1, Math.round(w * glowRatio))
    light.height = Math.max(1, Math.round(h * glowRatio))
    titleScale = Math.min((w * 0.81) / shapes.titleWidth, (h * 0.125) / 31)
    markScale = Math.min((w * 0.25) / shapes.markWidth, (h * 0.32) / shapes.markHeight)
    front.setTransform(ratio, 0, 0, ratio, 0, 0)
    bloom.setTransform(glowRatio, 0, 0, glowRatio, 0, 0)
    bloom.globalCompositeOperation = 'lighter'
    front.lineCap = front.lineJoin = 'round'
    bloom.lineCap = bloom.lineJoin = 'round'
    markTint = front.createLinearGradient(w * 0.39, h * 0.38, w * 0.61, h * 0.61)
    markTint.addColorStop(0, '#d4bbff')
    markTint.addColorStop(0.5, '#9789ff')
    markTint.addColorStop(1, '#6c86f8')
    flare = front.createLinearGradient(0, 0, w * 0.15, 0)
    flare.addColorStop(0, '#8e66ff00')
    flare.addColorStop(0.5, '#d8b9ffb3')
    flare.addColorStop(1, '#8e66ff00')
  }

  function stroke(ctx: CanvasRenderingContext2D, start: number, end: number, step: number) {
    ctx.beginPath()
    ctx.moveTo(xs[start], ys[start])
    for (let point = start + step; point < end; point += step) {
      ctx.quadraticCurveTo(
        xs[point],
        ys[point],
        (xs[point] + xs[point + step]) / 2,
        (ys[point] + ys[point + step]) / 2
      )
    }
    ctx.lineTo(xs[end], ys[end])
    ctx.stroke()
  }

  function draw(time: number): void {
    const seconds = time / 1000
    const centerX = w * 0.5
    const centerY = h * 0.5
    const seedX = w * 0.075
    const seedY = h * 0.495
    const unit = Math.min(w, h)
    const intro = smooth(0, 390, time)
    const focus = smooth(T.lettering, T.title, time)
    const dissolve = smooth(T.vortex, T.vortex + 2550, time)
    const collapse = smooth(T.contraction, T.mark + 450, time)
    const resolve = smooth(T.mark, T.mark + 2380, time)
    const fill = smooth(T.mark + 1900, T.iris - 420, time)
    const wingPhase = time < T.vortex
    const tilt = -0.47 + Math.sin(seconds * 0.85) * 0.17
    const tiltX = Math.cos(tilt)
    const tiltY = Math.sin(tilt)
    const radius = Math.min(w * 0.48, h * 0.74) * (1 - collapse * 0.62)
    const rotation = (seconds - 9) * 1.14 + collapse * 1.75
    const step = low ? 2 : 1
    const last = points - 1
    front.globalCompositeOperation = 'source-over'
    front.globalAlpha = 1
    front.clearRect(0, 0, w, h)
    bloom.clearRect(0, 0, w, h)
    front.globalCompositeOperation = 'lighter'

    if (time < T.lettering + 550) {
      front.globalAlpha = intro * (1 - smooth(2300, T.lettering + 550, time))
      const pulse = 57 + Math.sin(seconds * 17) * 4 + smooth(100, 850, time) * 27
      front.drawImage(seed, seedX - pulse / 2, seedY - pulse / 2, pulse, pulse)
      front.strokeStyle = flare
      front.lineWidth = 0.8
      front.beginPath()
      front.moveTo(0, seedY)
      front.lineTo(w * 0.15, seedY)
      front.stroke()
    }

    if (time >= T.unfold) {
      for (let i = 0; i < (low ? coreFibers : fibers.length); i++) {
        const { title, mark, letterX, lane, band, phase, reach, rate, orbit, span, power, color } =
          fibers[i]
        const core = i < coreFibers
        const ambient = i % 11 === 0
        const growth = smooth(T.unfold + (1 - reach) * 420, 1850 + (1 - power) * 770, time)
        if (wingPhase && growth === 0) continue
        const letter = smooth(
          T.lettering + letterX * 2040,
          T.lettering + 790 + letterX * 2100,
          time
        )
        const trace = core ? letter : letter * 0.25
        const drift = core ? 0 : letter * w * 0.42
        const morph = smooth(
          T.vortex + (1 - Math.abs(letterX * 2 - 1)) * 900,
          T.contraction - 790,
          time
        )
        const settle = core
          ? smooth(T.mark - power ** 2 * 1240, T.iris - 630 - power * 990, time)
          : smooth(T.mark + 200, T.iris - 520, time)
        const outline = core ? 1 : 1 - resolve
        const strength = wingPhase
          ? mix(0.22 + power * 0.47, core ? 0.94 : ambient ? 0.043 : 0, letter)
          : mix(core ? 0.94 : ambient ? 0.043 : 0, (0.23 + power * 0.53) * outline, dissolve)
        if (strength < 0.01) continue

        const ringRadius = radius * (1 + lane * 0.108)
        const tailCut = Math.round((last * (0.26 + power * 0.22)) / step) * step
        const brightCut = Math.round((last * (0.56 + power * 0.2)) / step) * step
        const sweep = 0.94 + 0.06 * Math.sin(seconds * 1.7 * rate + phase)
        const bend = Math.sin(Math.PI * trace) * unit * 0.052
        for (let j = 0; j <= last; j += step) {
          const t = j / last
          const tx = centerX + title[j * 2] * titleScale
          const ty = centerY + title[j * 2 + 1] * titleScale
          if (wingPhase) {
            const u = t * growth
            const arch = Math.sin(u * (2.53 + reach * 0.19)) ** 1.58
            const x = seedX + w * (0.9 * u * reach - 0.027 * band * arch) + drift * u
            const ripple = Math.sin(7.5 * u - seconds * 2.3 * rate + phase) * 0.036
            const y = seedY + h * arch * (sweep * band * 0.43 + ripple)
            const resting = !core && ambient ? unit * 0.043 * focus : 0
            xs[j] = mix(x, tx, trace) + bend * Math.sin(t * 2.8 + phase)
            ys[j] = mix(y, ty, trace) + (bend + resting) * Math.cos(t * 3 + phase - seconds)
          } else {
            const angle = orbit + rotation + t * span + settle * 0.75
            const depth = Math.sin(angle)
            const perspective = 1 / (1 - depth * 0.28)
            const ripple =
              Math.sin(t * 7 + phase - seconds * 1.7) * unit * 0.017 * (1 - collapse * 0.7)
            const x = Math.cos(angle) * (ringRadius + ripple) * perspective
            const y = depth * (ringRadius * 0.48 + ripple) * perspective
            const z = Math.sin(angle * 2 + phase) * unit * 0.033 * (1 - collapse * 0.74)
            const rx = centerX + x * tiltX - y * tiltY
            const ry = centerY + x * tiltY + y * tiltX + z
            xs[j] = mix(mix(tx, rx, morph), centerX + mark[j * 2] * markScale, settle)
            ys[j] = mix(mix(ty, ry, morph), centerY + mark[j * 2 + 1] * markScale, settle)
          }
        }

        const depth = 0.76 + 0.24 * Math.sin(orbit + rotation + span * 0.5)
        const settled = wingPhase ? trace : Math.max(1 - morph, settle)
        const breathing = 0.96 + 0.04 * Math.sin(seconds * 4)
        // Traced spans meet on the same contour. Round caps would double the light at every join.
        front.lineCap = bloom.lineCap = settled > 0.97 ? 'butt' : 'round'
        front.strokeStyle = core && settled > 0.83 ? '#bdb4ff' : color
        front.lineWidth = 0.65 + power * 0.61 + settled * 0.76
        const alpha = strength * (wingPhase ? growth : mix(depth, 1, settle)) * breathing
        if (settled < 0.92) {
          front.globalAlpha = alpha * 0.28
          stroke(front, 0, tailCut, step)
          front.globalAlpha = alpha * 0.62
          stroke(front, tailCut, brightCut, step)
          front.globalAlpha = alpha
          stroke(front, brightCut, last, step)
        } else {
          front.globalAlpha = alpha
          stroke(front, 0, last, step)
        }

        bloom.strokeStyle = color
        bloom.lineWidth = 5 + power * 7.5
        bloom.globalAlpha = alpha * (settled > 0.83 ? 0.44 : 0.32)
        stroke(bloom, 0, last, step)
      }
    }

    if (fill > 0) {
      front.save()
      front.globalCompositeOperation = 'source-over'
      front.globalAlpha = 0.28
      front.fillStyle = markTint
      const width = shapes.markWidth * markScale
      front.beginPath()
      front.rect(centerX - width / 2 - 1, 0, (width + 2) * fill, h)
      front.clip()
      front.translate(
        centerX - shapes.markCenterX * markScale,
        centerY - shapes.markCenterY * markScale
      )
      front.scale(markScale, markScale)
      front.fill(shapes.markFill)
      front.restore()
    }

    front.globalCompositeOperation = 'lighter'
    front.globalAlpha = low ? 0.68 : 0.87
    front.drawImage(light, 0, 0, w, h)
    front.globalAlpha = 1
  }

  function destroy(): void {
    for (const surface of [canvas, light, seed]) surface.width = surface.height = 0
  }

  return { resize, draw, destroy }
}
