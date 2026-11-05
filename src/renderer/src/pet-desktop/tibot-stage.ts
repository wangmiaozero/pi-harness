/**
 * One live jelly pet. Ported from the Tibot Studio canvas page: the selected
 * shape, palette, spring motion, eye tracking, particles, automatic
 * performances, and the nine action performances.
 */

import {
  TIBOT_ACTIONS,
  TIBOT_AGENT_ACTIONS,
  TIBOT_COLORS,
  type TibotAction,
  type TibotShape
} from '@shared/pet/tibot'

export interface TibotStageConfig {
  shape: TibotShape
  color: string
  energy: number
  /** Body radius in CSS px. Comes from the desktop pet size. */
  size: number
  light: number
  tracking: boolean
  auto: boolean
  particles: boolean
  paused: boolean
  agentSync: boolean
}

interface Pet {
  shape: TibotShape
  color: string
  base: number
  x: number
  y: number
  ax: number
  ay: number
  vx: number
  vy: number
  theta: number
  spin: number
  stretch: number
  stretchV: number
  blink: number
  blinkCountdown: number
  action: string
  actionElapsed: number
  actionDuration: number
  seed: number
  main: boolean
  drag: boolean
}

interface Bit {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  life: number
  max: number
  color: string
}

const COLORS = TIBOT_COLORS
const ACTION_DURATION: Record<TibotAction, number> = {
  jump: 1.3,
  spin: 1.45,
  dance: 3,
  surprise: 1.4,
  sleep: 3.6,
  celebrate: 2.3,
  wobble: 1.2,
  dash: 1.5,
  wink: 1.1
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const mix = (a: number, b: number, f: number) => a + (b - a) * f

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function tone(hex: string, l: number): string {
  const c = rgb(hex)
  const tar = l >= 0 ? 255 : 0
  const m = Math.abs(l)
  return `rgb(${c.map((v) => Math.round(mix(v, tar, m))).join(',')})`
}

function spring(
  obj: Pet,
  p: 'x' | 'y' | 'stretch',
  v: 'vx' | 'vy' | 'stretchV',
  target: number,
  k: number,
  d: number,
  dt: number
): void {
  obj[v] += (target - obj[p]) * k * dt
  obj[v] *= Math.exp(-d * dt)
  obj[p] += obj[v] * dt
}

function createPet(shape: TibotShape, color: string, size: number, main: boolean): Pet {
  return {
    shape,
    color,
    base: size,
    x: 0,
    y: 0,
    ax: 0,
    ay: 0,
    vx: 0,
    vy: 0,
    theta: 0,
    spin: 0,
    stretch: 0,
    stretchV: 0,
    blink: 0,
    blinkCountdown: rand(1.4, 4.4),
    action: '',
    actionElapsed: 0,
    actionDuration: 0,
    seed: rand(0, 100),
    main,
    drag: false
  }
}

export class TibotStage {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly pets: Pet[] = []
  private readonly bits: Bit[] = []
  private config: TibotStageConfig = {
    shape: 'circle',
    color: COLORS[0],
    energy: 0.65,
    size: 1,
    light: 0.75,
    tracking: true,
    auto: true,
    particles: true,
    paused: false,
    agentSync: true
  }
  private width = 0
  private height = 0
  private dpr = 1
  private last = 0
  private time = 0
  private autoClock = 0
  private holdAuto = false
  private pointer = { x: -1e5, y: -1e5 }
  private frame = 0
  private observer: ResizeObserver | null = null
  private disposed = false

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none'
    const context = this.canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new Error('canvas is unavailable')
    this.ctx = context
    this.pets.push(createPet('circle', COLORS[0], 80, true))
  }

  mount(parent: HTMLElement): void {
    parent.append(this.canvas)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(parent)
    this.resize()
    this.frame = requestAnimationFrame((now) => this.tick(now))
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer?.disconnect()
    this.canvas.remove()
  }

  apply(config: TibotStageConfig): void {
    const shapeChanged = config.shape !== this.config.shape
    const colorChanged = config.color !== this.config.color
    this.config = config
    const main = this.pet
    main.shape = config.shape
    main.color = config.color
    main.base = config.size
    this.resize()
    if (!config.agentSync) this.holdAuto = false
    if (this.width > 0 && shapeChanged) this.play('wobble')
    if (this.width > 0 && colorChanged) this.burst(main.x, main.y, config.color, 12)
  }

  play(action: string): void {
    if (!(TIBOT_ACTIONS as readonly string[]).includes(action)) return
    this.act(this.pet, action as TibotAction)
  }

  /** Play the performance tied to an agent state. Idle does not cancel auto play. */
  react(state: string): void {
    if (!this.config.agentSync) {
      this.holdAuto = false
      return
    }
    this.holdAuto = state !== 'idle'
    const action = TIBOT_AGENT_ACTIONS[state]
    if (action) this.play(action)
  }

  setPointer(x: number, y: number): void {
    this.pointer = { x, y }
  }

  clearPointer(): void {
    this.pointer = { x: -1e5, y: -1e5 }
  }

  hit(x: number, y: number): { main: boolean } | null {
    return this.petAt(x, y) ? { main: true } : null
  }

  surpriseAt(x: number, y: number): void {
    if (this.petAt(x, y)) this.act(this.pet, 'surprise')
  }

  releaseMain(): void {
    this.burst(this.pet.x, this.pet.y, this.pet.color, 10)
  }

  burst(x: number, y: number, color = this.config.color, count = 15): void {
    this.emit(x, y, color, count)
  }

  alphaAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0
    const px = Math.min(this.canvas.width - 1, Math.max(0, Math.floor(x * this.dpr)))
    const py = Math.min(this.canvas.height - 1, Math.max(0, Math.floor(y * this.dpr)))
    return this.ctx.getImageData(px, py, 1, 1).data[3] ?? 0
  }

  private get pet(): Pet {
    return this.pets[0]!
  }

  private petAt(x: number, y: number): Pet | null {
    const pet = this.pet
    return Math.hypot(x - pet.x, y - pet.y) < pet.base * 0.96 ? pet : null
  }

  private resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect()
    if (!rect || rect.width < 1 || rect.height < 1) return
    const first = this.width === 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const bufferWidth = Math.round(rect.width * dpr)
    const bufferHeight = Math.round(rect.height * dpr)
    this.width = rect.width
    this.height = rect.height
    this.dpr = dpr
    if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
      this.canvas.width = bufferWidth
      this.canvas.height = bufferHeight
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const main = this.pet
    const previous = { x: main.ax, y: main.ay }
    main.ax = this.width * 0.5
    main.ay = Math.max(main.base + 8, this.height - main.base - 8)
    if (first) {
      main.x = main.ax
      main.y = main.ay
    } else if (!main.drag) {
      main.x += main.ax - previous.x
      main.y += main.ay - previous.y
    }
  }

  private emit(x: number, y: number, color: string, count: number): void {
    if (!this.config.particles) return
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, Math.PI * 2)
      const sp = rand(65, 180)
      this.bits.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        r: rand(2, 5),
        life: rand(0.45, 1),
        max: 1,
        color
      })
    }
    if (this.bits.length > 240) this.bits.splice(0, this.bits.length - 240)
  }

  private act(pet: Pet, key: TibotAction): void {
    pet.action = key
    pet.actionElapsed = 0
    pet.actionDuration = ACTION_DURATION[key]
    const travel = pet.base / 153
    if (key === 'jump') {
      pet.vy -= 390 * travel
      pet.stretchV -= 3.1
    }
    if (key === 'spin') pet.spin += Math.PI * 2.2
    if (key === 'wobble') pet.stretchV += 2.7
    if (key === 'dash') {
      pet.vx += (pet.x > this.width * 0.7 ? -370 : 370) * travel
      pet.stretchV += 2
    }
    if (key === 'celebrate') {
      pet.vy -= 130 * travel
      this.emit(pet.x, pet.y - pet.base * 0.5, pet.color, 30)
    }
    if (key === 'surprise') pet.stretchV -= 1.3
    if (key === 'wink') pet.blinkCountdown = 0
  }

  private tick(now: number): void {
    if (this.disposed) return
    if (!this.last) this.last = now
    const dt = clamp((now - this.last) / 1000, 0, 0.033)
    this.last = now
    if (!this.config.paused) this.update(dt)
    this.render()
    this.frame = requestAnimationFrame((next) => this.tick(next))
  }

  private update(dt: number): void {
    this.time += dt
    this.autoClock += dt
    const pet = this.pet
    pet.blinkCountdown -= dt
    if (pet.blinkCountdown < 0) {
      pet.blink = 1
      pet.blinkCountdown = rand(2.3, 5)
    }
    pet.blink = Math.max(0, pet.blink - dt * 8)
    if (pet.action) {
      pet.actionElapsed += dt
      if (pet.actionElapsed >= pet.actionDuration) {
        pet.action = ''
        pet.actionElapsed = 0
      }
    }
    if (!pet.drag) {
      spring(pet, 'x', 'vx', pet.ax, 15, 7, dt)
      spring(pet, 'y', 'vy', pet.ay, 15, 7, dt)
    }
    pet.theta += pet.spin * dt
    pet.spin *= Math.exp(-4.7 * dt)
    pet.theta *= Math.exp(-2.3 * dt)
    spring(pet, 'stretch', 'stretchV', 0, 95, 15, dt)
    if (this.config.auto && !this.holdAuto && this.autoClock > rand(4.4, 5.8)) {
      this.autoClock = 0
      const choice: TibotAction[] = ['jump', 'wobble', 'dance', 'wink', 'surprise']
      this.act(pet, choice[Math.floor(Math.random() * choice.length)]!)
    }
    for (let i = this.bits.length - 1; i >= 0; i -= 1) {
      const bit = this.bits[i]!
      bit.life -= dt
      bit.x += bit.vx * dt
      bit.y += bit.vy * dt
      bit.vy += 95 * dt
      bit.vx *= Math.exp(-1.8 * dt)
      if (bit.life <= 0) this.bits.splice(i, 1)
    }
  }

  private render(): void {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    this.drawPet(this.pet)
    for (const bit of this.bits) {
      ctx.globalAlpha = clamp(bit.life / bit.max, 0, 1) * 0.75
      ctx.fillStyle = bit.color
      ctx.beginPath()
      ctx.arc(bit.x, bit.y, bit.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private polygonR(shape: TibotShape, angle: number, ts: number, pet: Pet): number {
    if (shape === 'circle') return 1
    if (shape === 'rounded') {
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      return (Math.abs(c) ** 4.1 + Math.abs(s) ** 4.1) ** (-1 / 4.1)
    }
    if (shape === 'jelly') {
      return 1 + 0.038 * Math.sin(3 * angle + ts * 1.8 + pet.seed) + 0.027 * Math.sin(5 * angle - ts * 1.2)
    }
    if (shape === 'triangle') {
      const phi = angle + Math.PI / 2
      const sector = Math.PI * (2 / 3)
      const sect = (((phi % sector) + sector) % sector) - Math.PI / 3
      return Math.min(1.14, 0.57 / Math.cos(sect))
    }
    if (shape === 'star') return 0.8 + 0.2 * Math.cos(5 * (angle + Math.PI / 2))
    const s = Math.sin(angle)
    return s > 0 ? 0.85 + 0.075 * Math.cos(5 * angle + ts * 2) : 1
  }

  private path(pet: Pet, radius: number, ts: number): void {
    const ctx = this.ctx
    if (pet.shape === 'circle') {
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      return
    }
    const steps = 96
    const points: Array<[number, number]> = []
    for (let i = 0; i < steps; i += 1) {
      const angle = (i * Math.PI * 2) / steps
      const rr = this.polygonR(pet.shape, angle, ts, pet)
      points.push([Math.cos(angle) * radius * rr, Math.sin(angle) * radius * rr])
    }
    ctx.beginPath()
    const last = points[steps - 1]!
    const first = points[0]!
    ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2)
    for (let i = 0; i < steps; i += 1) {
      const current = points[i]!
      const next = points[(i + 1) % steps]!
      ctx.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2)
    }
    ctx.closePath()
  }

  private drawPet(pet: Pet): void {
    const ctx = this.ctx
    const radius = pet.base
    const period = this.time * (1.35 + this.config.energy * 0.8) + pet.seed
    const breath = 1 + Math.sin(period) * 0.01
    const action = pet.action
    const phase = pet.actionElapsed
    let tilt = Math.sin(period * 0.6) * 0.018
    if (action === 'dance') tilt += Math.sin(phase * 9) * 0.11
    if (action === 'wobble') tilt += Math.sin(phase * 17) * 0.09 * Math.exp(-phase * 2)
    if (action === 'surprise') tilt -= Math.sin(phase * 8) * 0.03
    const stretch = clamp(pet.stretch, -0.085, 0.085)
    let sx = (1 + stretch) * breath
    let sy = (1 - stretch) * breath
    if (action === 'jump') sy += Math.sin(Math.min(1, phase / 1.3) * Math.PI) * 0.045
    if (pet.drag) {
      sx *= 1.025
      sy *= 0.975
    }
    const hover = Math.sin(period) * ((pet.main ? 8 : 7) * (0.3 + this.config.energy))
    const y = pet.y + hover
    ctx.save()
    ctx.translate(pet.x, pet.y + radius * 1.18)
    ctx.scale(1, 0.25)
    const shadow = ctx.createRadialGradient(0, 0, 2, 0, 0, radius * 0.92)
    shadow.addColorStop(0, 'rgba(35,42,55,.17)')
    shadow.addColorStop(0.5, 'rgba(35,42,55,.085)')
    shadow.addColorStop(1, 'rgba(35,42,55,0)')
    ctx.fillStyle = shadow
    ctx.beginPath()
    ctx.arc(0, 0, radius * 0.92, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(pet.x, y)
    ctx.rotate(pet.theta + tilt)
    ctx.scale(sx, sy)
    this.path(pet, radius, this.time)
    ctx.save()
    ctx.shadowColor = pet.color
    ctx.shadowBlur = radius * 0.16
    ctx.shadowOffsetY = radius * 0.06
    const depth = this.config.light
    const fill = ctx.createRadialGradient(-radius * 0.35, -radius * 0.53, radius * 0.05, radius * 0.07, radius * 0.05, radius * 1.3)
    fill.addColorStop(0, tone(pet.color, 0.26 * depth))
    fill.addColorStop(0.36, tone(pet.color, 0.12 * depth))
    fill.addColorStop(0.7, pet.color)
    fill.addColorStop(1, tone(pet.color, -0.24 * depth))
    ctx.fillStyle = fill
    ctx.fill()
    ctx.restore()

    ctx.save()
    this.path(pet, radius, this.time)
    ctx.clip()
    const shine = ctx.createRadialGradient(-radius * 0.48, -radius * 0.65, radius * 0.03, -radius * 0.38, -radius * 0.5, radius * 0.8)
    shine.addColorStop(0, `rgba(255,255,255,${0.3 * depth})`)
    shine.addColorStop(0.28, `rgba(255,255,255,${0.095 * depth})`)
    shine.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = shine
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
    const ambient = ctx.createLinearGradient(0, -radius, 0, radius)
    ambient.addColorStop(0, 'rgba(255,255,255,.065)')
    ambient.addColorStop(0.7, 'rgba(255,255,255,0)')
    ambient.addColorStop(1, `rgba(30,12,0,${depth * 0.085})`)
    ctx.fillStyle = ambient
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
    ctx.restore()
    ctx.lineWidth = pet.main ? 1.8 : 1
    ctx.strokeStyle = `rgba(255,255,255,${depth * 0.28})`
    this.path(pet, radius, this.time)
    ctx.stroke()

    const surprised = action === 'surprise'
    const asleep = action === 'sleep'
    const winking = action === 'wink'
    const offsets: Array<[number, number]> = [
      [-0.18, 0.005],
      [0.205, -0.085]
    ]
    for (let i = 0; i < 2; i += 1) {
      const [ox, oy] = offsets[i]!
      const dx = this.config.tracking ? clamp((this.pointer.x - pet.x) / Math.max(1, radius * 5), -0.1, 0.1) : 0
      const dy = this.config.tracking ? clamp((this.pointer.y - y) / Math.max(1, radius * 5), -0.08, 0.08) : 0
      const cx = (ox + dx) * radius + (pet.main ? radius * 0.062 : 0)
      const cy = (oy + dy) * radius - radius * 0.075
      let w = radius * (i === 0 ? 0.092 : 0.073)
      let h = radius * (i === 0 ? 0.17 : 0.14)
      if (surprised) {
        w *= 1.13
        h *= 1.17
      }
      if (asleep || (winking && i === 1)) h = Math.max(1.6, radius * 0.014)
      else h *= 1 - pet.blink * 0.94
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-0.24)
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    if (action === 'surprise') {
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.ellipse(radius * 0.1, radius * 0.31, radius * 0.038, radius * 0.055, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    if (action === 'sleep') {
      ctx.save()
      ctx.fillStyle = tone(pet.color, -0.1)
      ctx.globalAlpha = 0.65
      ctx.font = `bold ${Math.round(radius * 0.22)}px sans-serif`
      ctx.fillText('z', pet.x + radius * 0.8, y - radius * 0.65)
      ctx.font = `bold ${Math.round(radius * 0.14)}px sans-serif`
      ctx.fillText('z', pet.x + radius * 0.99, y - radius * 0.85)
      ctx.restore()
    }
  }
}
