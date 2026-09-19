<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { thinkingEffectPalette, type ThinkingEffectPalette } from './thinking-effect'

const props = withDefaults(
  defineProps<{
    power?: number
    max?: boolean
    ultra?: boolean
  }>(),
  { power: 1, max: false, ultra: false }
)

const FLAME_VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FLAME_FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_power;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.1 + vec2(37.4, 17.9);
    a *= 0.5;
  }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float d = 1.0 - uv.x;
  float y = (uv.y - 0.5) * 2.0;
  float turb = fbm(vec2(uv.x * 5.5 + u_time * 3.2, uv.y * 3.5 + u_time * 0.4)) - 0.5;
  float sway = (fbm(vec2(u_time * 1.6, uv.x * 2.0)) - 0.5) * 0.55;
  float width = mix(1.05, 0.12, smoothstep(0.0, 1.0, d)) * mix(0.28, 1.0, u_power);
  float reach = mix(0.16, 1.05, u_power);
  float shape = 1.0 - smoothstep(width * 0.35, width, abs(y + sway * d + turb * (0.35 + d * 0.9)));
  float len = 1.0 - smoothstep(0.15 * u_power, reach, d + turb * 0.45 * u_power);
  float flame = clamp(shape * len, 0.0, 1.0);
  float core = (1.0 - smoothstep(0.0, 0.38 * mix(0.5, 1.0, u_power), d + turb * 0.15)) * (1.0 - smoothstep(0.0, 0.55, abs(y)));
  flame = clamp(flame + core * 0.6, 0.0, 1.0) * mix(0.45, 1.0, u_power);
  float glow = (1.0 - smoothstep(0.0, 0.85, d)) * (1.0 - smoothstep(0.2, 1.15, abs(y))) * 0.4 * u_power;
  vec3 col = mix(u_c0, u_c1, smoothstep(0.2, 0.6, flame));
  col = mix(col, u_c2, smoothstep(0.62, 0.95, flame) * (1.0 - smoothstep(0.1, 0.75, d)));
  col = mix(col, vec3(1.0), smoothstep(0.9, 1.0, flame) * (1.0 - smoothstep(0.02, 0.3, d)) * u_power);
  gl_FragColor = vec4(col, clamp(smoothstep(0.04, 0.55, flame) * 0.96 + glow, 0.0, 1.0));
}
`

const flameCanvas = ref<HTMLCanvasElement | null>(null)
const particleCanvas = ref<HTMLCanvasElement | null>(null)
const pixelCanvas = ref<HTMLCanvasElement | null>(null)
const webglFailed = ref(false)
const palette = ref(thinkingEffectPalette())
const livePower = ref(props.power * (props.ultra ? 1.38 : 1))
const frames: number[] = []

watch(
  () => [props.power, props.ultra] as const,
  ([power, ultra]) => {
    livePower.value = power * (ultra ? 1.38 : 1)
  }
)

onMounted(() => {
  palette.value = thinkingEffectPalette()
  startParticles()
  startFlame()
})

onBeforeUnmount(() => {
  for (const id of frames) cancelAnimationFrame(id)
})

function rgba(color: [number, number, number], alpha: number) {
  return `rgba(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)},${alpha.toFixed(3)})`
}

function startParticles() {
  const canvas = particleCanvas.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const { width, height } = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)
  const kind = palette.value.kind
  const color = palette.value.particle
  const make = (anywhere: boolean) => {
    const depth = Math.random()
    return {
      x: anywhere ? Math.random() * width : width + 4,
      y: 1 + Math.random() * (height - 2),
      speed: kind === 'embers' ? 22 + depth * 70 : kind === 'stars' ? 18 + depth * 90 : 10 + depth * 36,
      lift: kind === 'embers' ? (Math.random() - 0.35) * 14 : 0,
      size: kind === 'motes' ? 1.1 + depth * 1.6 : 0.55 + depth * 1.2,
      alpha: 0.35 + depth * 0.55
    }
  }
  const count = props.ultra ? 54 : kind === 'stars' ? 40 : 28
  const dots = Array.from({ length: count }, () => make(true))
  let shooting: (ReturnType<typeof make> & { life: number }) | null = null
  let last = performance.now()
  const draw = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    const power = livePower.value
    ctx.clearRect(0, 0, width, height)
    for (const dot of dots) {
      dot.x -= dot.speed * dt * (0.55 + power * 0.9)
      dot.y += dot.lift * dt * power
      if (dot.x < -8 || dot.y < -6 || dot.y > height + 6) Object.assign(dot, make(false))
      const streak = kind === 'motes' ? dot.size : dot.speed * (0.03 + power * 0.04)
      const grad = ctx.createLinearGradient(dot.x, dot.y, dot.x + streak, dot.y)
      grad.addColorStop(0, rgba(color, dot.alpha * (0.35 + power * 0.65)))
      grad.addColorStop(1, rgba(color, 0))
      ctx.fillStyle = grad
      ctx.fillRect(dot.x, dot.y - dot.size / 2, streak + dot.size, dot.size)
    }
    if (props.max && !shooting && Math.random() < dt / (props.ultra ? 0.72 : 1.8)) {
      shooting = { ...make(false), speed: 220 + Math.random() * 140, size: 1.3, alpha: 0.95, life: 1 }
    }
    if (shooting) {
      shooting.x -= shooting.speed * dt
      shooting.life -= dt * 0.9
      if (shooting.x < -40 || shooting.life <= 0) {
        shooting = null
      } else {
        const a = shooting.alpha * Math.max(shooting.life, 0)
        const grad = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x + 28, shooting.y)
        grad.addColorStop(0, rgba(color, a))
        grad.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = grad
        ctx.fillRect(shooting.x, shooting.y - 0.6, 28, 1.3)
      }
    }
    frames[0] = requestAnimationFrame(draw)
  }
  frames[0] = requestAnimationFrame(draw)
}

function startPixelation() {
  const canvas = pixelCanvas.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const { width, height } = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)
  const cell = 3
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const colors = [palette.value.deep, palette.value.mid, palette.value.hot]
  let last = 0
  const draw = (time: number) => {
    if (time - last > 70) {
      last = time
      const power = livePower.value
      ctx.clearRect(0, 0, width, height)
      for (let col = 0; col < cols; col++) {
        const t = cols <= 1 ? 1 : col / (cols - 1)
        const density = 0.72 * power * t ** 1.6
        for (let row = 0; row < rows; row++) {
          if (Math.random() < density) {
            const [r, g, b] = colors[(Math.random() * colors.length) | 0]
            ctx.fillStyle = rgba([r, g, b], (0.15 + Math.random() * 0.85) * (0.3 + 0.7 * t) * power)
            ctx.fillRect(col * cell, row * cell, cell - 1, cell - 1)
          }
        }
      }
    }
    frames[1] = requestAnimationFrame(draw)
  }
  frames[1] = requestAnimationFrame(draw)
}

function applyPalette(gl: WebGLRenderingContext, program: WebGLProgram, next: ThinkingEffectPalette) {
  gl.uniform3f(gl.getUniformLocation(program, 'u_c0'), ...next.deep)
  gl.uniform3f(gl.getUniformLocation(program, 'u_c1'), ...next.mid)
  gl.uniform3f(gl.getUniformLocation(program, 'u_c2'), ...next.hot)
}

function startFlame() {
  const canvas = flameCanvas.value
  if (!canvas) return
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false })
  if (!gl) {
    webglFailed.value = true
    void Promise.resolve().then(startPixelation)
    return
  }
  const { width, height } = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = width * dpr
  canvas.height = height * dpr
  gl.viewport(0, 0, canvas.width, canvas.height)
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return shader
  }
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl.VERTEX_SHADER, FLAME_VERT))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FLAME_FRAG))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    webglFailed.value = true
    void Promise.resolve().then(startPixelation)
    return
  }
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(program, 'a_pos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
  gl.uniform2f(gl.getUniformLocation(program, 'u_res'), canvas.width, canvas.height)
  applyPalette(gl, program, palette.value)
  const uTime = gl.getUniformLocation(program, 'u_time')
  const uPower = gl.getUniformLocation(program, 'u_power')
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  const start = performance.now()
  const draw = (now: number) => {
    const elapsed = (now - start) / 1000
    const t = Math.min(elapsed / 1.1, 1)
    gl.uniform1f(uTime, elapsed)
    gl.uniform1f(uPower, livePower.value * (1 - (1 - t) ** 3))
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    frames[1] = requestAnimationFrame(draw)
  }
  frames[1] = requestAnimationFrame(draw)
}
</script>

<template>
  <div
    aria-hidden="true"
    class="thinking-flame pointer-events-none absolute inset-0 overflow-hidden rounded-[8px]"
    :class="ultra ? 'thinking-flame--ultra' : ''"
    :data-thinking-max="max ? 'true' : 'false'"
    :data-thinking-ultra="ultra ? 'true' : 'false'"
    :style="{
      '--thinking-wash': `rgba(${Math.round(palette.wash[0] * 255)} ${Math.round(palette.wash[1] * 255)} ${Math.round(palette.wash[2] * 255)} / ${palette.wash[3] * power})`
    }"
  >
    <div class="thinking-flame__wash absolute inset-0" />
    <canvas ref="particleCanvas" class="absolute inset-0 size-full" />
    <canvas v-if="!webglFailed" ref="flameCanvas" class="absolute inset-0 size-full" />
    <canvas v-else ref="pixelCanvas" class="absolute inset-0 size-full" />
  </div>
</template>

<style scoped>
.thinking-flame {
  animation: thinking-flame-in 0.3s ease-out;
}

.thinking-flame--ultra {
  inset: -7px -12px;
  border-radius: 13px;
  filter:
    saturate(1.25)
    brightness(1.12)
    drop-shadow(0 0 8px var(--thinking-wash))
    drop-shadow(0 0 18px var(--thinking-wash));
}

.thinking-flame__wash {
  background: var(--thinking-wash);
}

@keyframes thinking-flame-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
