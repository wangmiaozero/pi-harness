<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'
import {
  isMacOS27EffectBackground,
  normalizeMacOS27Background,
  normalizeMacOS27BackgroundImage,
  type MacOS27EffectBackground
} from '@shared/constants/macos27-background'

const settings = useSettingsStore()
const canvas = ref<HTMLCanvasElement | null>(null)
const background = computed(() => normalizeMacOS27Background(settings.settings?.macos27Background))
const backgroundImage = computed(() =>
  normalizeMacOS27BackgroundImage(settings.settings?.macos27BackgroundImage)
)
const localImageActive = computed(
  () => background.value === 'local-image' && backgroundImage.value !== null
)
const effectBackground = computed<MacOS27EffectBackground>(() =>
  isMacOS27EffectBackground(background.value) ? background.value : 'liquid-ether'
)

const vertexShader = `#version 300 es
  in vec2 position;

  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const shaderPrelude = `#version 300 es
  precision highp float;

  uniform vec2 resolution;
  uniform vec2 pointer;
  uniform float time;
  uniform float lightMode;
  out vec4 fragColor;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float hash11(float value) {
    value = fract(value * 0.1031);
    value *= value + 33.33;
    value *= value + value;
    return fract(value);
  }

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  float noise21(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    return mix(
      mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), local.x),
      mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + 1.0), local.x),
      local.y
    );
  }

  float fbm(vec2 point) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
    for (int octave = 0; octave < 5; octave++) {
      value += amplitude * noise21(point);
      point = rotation * point * 2.03 + 13.7;
      amplitude *= 0.5;
    }
    return value;
  }

  vec2 normalizedUv() {
    return (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
  }

  vec2 normalizedPointer() {
    vec2 value = pointer * 2.0 - 1.0;
    value.x *= resolution.x / resolution.y;
    return value;
  }
`

const liquidEtherShader = `${shaderPrelude}
  void main() {
    vec2 uv = normalizedUv();
    vec2 mouse = normalizedPointer();
    float t = time * 0.18;

    float mouseDistance = length(uv - mouse);
    vec2 mouseWake = normalize(uv - mouse + vec2(0.0001));
    mouseWake *= exp(-mouseDistance * 2.4) * 0.22;

    vec2 q = vec2(
      fbm(uv * 0.86 + vec2(t * 0.54, -t * 0.24)),
      fbm(uv * 0.92 + vec2(-t * 0.31, t * 0.42) + 7.3)
    );
    vec2 r = vec2(
      fbm(uv * 1.18 + q * 2.8 + mouseWake + vec2(t * 0.22, t * 0.14)),
      fbm(uv * 1.04 + q * 3.2 - mouseWake + vec2(-t * 0.19, t * 0.27) + 4.8)
    );

    float fluid = fbm(uv * 1.08 + r * 4.1 + q * 1.7);
    float current = sin((uv.x + r.x * 1.7) * 3.1 + (uv.y + r.y) * 2.0 - t * 2.6);
    float fold = 1.0 - abs(current);
    float highlight = pow(clamp(fold, 0.0, 1.0), 6.0);
    float wakeGlow = exp(-mouseDistance * mouseDistance * 5.0) * 0.32;

    vec3 violet = vec3(0.28, 0.08, 0.96);
    vec3 pink = vec3(1.0, 0.24, 0.73);
    vec3 blue = vec3(0.04, 0.56, 1.0);
    vec3 ether = mix(violet, pink, smoothstep(0.22, 0.82, fluid));
    ether = mix(ether, blue, smoothstep(0.38, 0.96, r.y) * 0.72);
    ether += vec3(0.42, 0.22, 1.0) * highlight * 0.7;
    ether += vec3(0.16, 0.56, 1.0) * wakeGlow;

    float vignette = 1.0 - smoothstep(0.55, 1.7, length(uv * vec2(0.7, 1.0)));
    vec3 darkColor = vec3(0.015, 0.008, 0.07) + ether * (0.32 + fluid * 0.82);
    darkColor *= 0.68 + vignette * 0.48;

    vec3 lightColor = vec3(0.72, 0.79, 0.98);
    lightColor += ether * (0.12 + fluid * 0.2);
    lightColor = mix(lightColor, vec3(0.96, 0.83, 1.0), highlight * 0.24);

    vec3 color = mix(darkColor, lightColor, lightMode);
    float grain = hash21(gl_FragCoord.xy + floor(time * 16.0)) - 0.5;
    color += grain * mix(0.018, 0.008, lightMode);
    fragColor = vec4(max(color, 0.0), 1.0);
  }
`

const lightfallShader = `${shaderPrelude}
  vec3 palette(float value) {
    vec3 purple = vec3(0.31, 0.08, 1.0);
    vec3 cyan = vec3(0.02, 0.78, 1.0);
    vec3 pink = vec3(1.0, 0.19, 0.67);
    return value < 0.5
      ? mix(purple, cyan, value * 2.0)
      : mix(cyan, pink, (value - 0.5) * 2.0);
  }

  void main() {
    vec2 uv = normalizedUv();
    vec2 mouse = normalizedPointer();
    uv += (mouse - uv) * exp(-length(uv - mouse) * 2.5) * 0.055;

    float t = time * 0.23;
    float radius = max(length(uv), 0.08);
    float angle = atan(uv.y, uv.x) / TAU + 0.5;
    float depth = 1.0 / radius;
    vec3 streakColor = vec3(0.0);

    for (int layer = 0; layer < 3; layer++) {
      float index = float(layer);
      vec2 cellUv = vec2(angle * (34.0 + index * 11.0), depth * 1.7 - t * (2.0 + index));
      vec2 cell = floor(cellUv);
      vec2 local = fract(cellUv) - 0.5;
      float random = hash21(cell + index * 19.3);
      float enabled = step(0.48 - index * 0.08, random);
      float width = 0.018 + random * 0.045;
      float streak = 1.0 - smoothstep(0.0, width, abs(local.x));
      streak *= 1.0 - smoothstep(0.02, 0.52, abs(local.y + 0.18));
      streak *= enabled * smoothstep(0.06, 0.42, radius);
      float intensity = streak * (0.34 + depth * 0.12);
      streakColor += palette(fract(random + index * 0.27)) * intensity;
    }

    float tunnel = exp(-abs(radius - 0.5 - sin(angle * 9.0 + t) * 0.035) * 7.0);
    float centerGlow = exp(-radius * 1.85);
    vec3 darkColor = vec3(0.008, 0.007, 0.05);
    darkColor += streakColor * 1.24;
    darkColor += vec3(0.16, 0.07, 0.5) * tunnel * 0.38;
    darkColor += vec3(0.08, 0.12, 0.38) * centerGlow;

    vec3 lightColor = vec3(0.78, 0.83, 0.98);
    lightColor += streakColor * 0.25;
    lightColor += vec3(0.14, 0.08, 0.34) * tunnel * 0.12;

    vec3 color = mix(darkColor, lightColor, lightMode);
    color += (hash21(gl_FragCoord.xy + floor(time * 12.0)) - 0.5) * 0.012;
    fragColor = vec4(max(color, 0.0), 1.0);
  }
`

const lightningShader = `${shaderPrelude}
  mat2 rotate2d(float theta) {
    float c = cos(theta);
    float s = sin(theta);
    return mat2(c, -s, s, c);
  }

  float lightningFbm(vec2 point) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 8; octave++) {
      value += amplitude * noise21(point);
      point *= rotate2d(0.45);
      point *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = normalizedUv();
    vec2 mouse = normalizedPointer();
    float t = time * 0.72;
    uv.x -= mouse.x * 0.18;
    uv += vec2(2.0 * lightningFbm(uv * 1.05 + vec2(0.8 * t)) - 1.0);

    float distanceToBolt = max(abs(uv.x), 0.0025);
    float flicker = 0.72 + hash11(floor(t * 13.0)) * 0.44;
    float core = 0.022 / distanceToBolt * flicker;
    float halo = 0.11 / (distanceToBolt * distanceToBolt * 7.0 + 0.13);
    vec3 bolt = vec3(0.34, 0.58, 1.0) * core;
    bolt += vec3(0.32, 0.08, 0.86) * halo * 0.32;
    bolt += vec3(0.9, 0.96, 1.0) * pow(clamp(core, 0.0, 1.0), 3.0);

    vec3 darkColor = vec3(0.006, 0.008, 0.045) + bolt;
    vec3 lightColor = vec3(0.76, 0.82, 0.98) + bolt * 0.28;
    fragColor = vec4(max(mix(darkColor, lightColor, lightMode), 0.0), 1.0);
  }
`

const webThreadsShader = `${shaderPrelude}
  float threadGlow(float distanceToThread, float strength, float width) {
    return width / pow(max(distanceToThread, 0.0001), strength);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec2 mouse = pointer;
    float pinchX = mix(0.5, mouse.x, 0.42);
    float spread = 0.2 * abs(uv.x - pinchX);
    float baseTime = time * 0.24;
    float glowSum = 0.0;
    vec3 color = vec3(0.0);

    for (int index = 0; index < 8; index++) {
      float i = float(index);
      float amplitude = spread * (1.0 + i * 0.13);
      float shimmer = sin(time * 1.7 + i * 1.3) * 0.16;
      float phase = baseTime + i * TAU / 8.0 + shimmer;
      float wave = sin(uv.x * 5.6 + phase) * amplitude;
      float distanceToThread = abs((uv.y - mix(0.5, mouse.y, 0.16)) + wave) / 1.08;
      float glow = threadGlow(distanceToThread, 0.62, 0.0085);
      float colorIndex = i / 7.0;
      vec3 threadColor = colorIndex < 0.5
        ? mix(vec3(0.31, 0.12, 1.0), vec3(1.0, 0.31, 0.86), colorIndex * 2.0)
        : mix(vec3(1.0, 0.31, 0.86), vec3(0.22, 0.78, 1.0), (colorIndex - 0.5) * 2.0);
      color += glow * threadColor;
      glowSum += glow;
    }

    float core = smoothstep(0.48, 2.2, glowSum);
    color = mix(color, vec3(0.92, 0.96, 1.0) * glowSum, core * 0.4);
    float cursorLight = exp(-dot(uv - mouse, uv - mouse) * 7.0) * 0.26;
    color += vec3(0.18, 0.42, 1.0) * cursorLight;

    vec3 darkColor = vec3(0.008, 0.006, 0.042) + color * 0.72;
    vec3 lightColor = vec3(0.78, 0.83, 0.98) + color * 0.18;
    vec3 outputColor = mix(darkColor, lightColor, lightMode);
    outputColor += (hash21(gl_FragCoord.xy + floor(time * 15.0)) - 0.5) * 0.014;
    fragColor = vec4(max(outputColor, 0.0), 1.0);
  }
`

const fragmentShaders: Record<MacOS27EffectBackground, string> = {
  'liquid-ether': liquidEtherShader,
  lightfall: lightfallShader,
  lightning: lightningShader,
  'web-threads': webThreadsShader
}

let observer: MutationObserver | undefined
let resizeObserver: ResizeObserver | undefined
let frame = 0
let gl: WebGL2RenderingContext | null = null
let program: WebGLProgram | null = null
let vertexBuffer: WebGLBuffer | null = null
let resolutionLocation: WebGLUniformLocation | null = null
let pointerLocation: WebGLUniformLocation | null = null
let timeLocation: WebGLUniformLocation | null = null
let lightModeLocation: WebGLUniformLocation | null = null
let renderedBackground: MacOS27EffectBackground | null = null
let startedAt = 0
let lastRenderAt = 0
let active = false
let lightMode = false
let reducedMotion = false
const pointerTarget = { x: 0.5, y: 0.5 }
const pointerCurrent = { x: 0.5, y: 0.5 }

const FRAME_INTERVAL_MS = 1000 / 30

function compileShader(context: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = context.createShader(type)
  if (!shader) throw new Error('Unable to create macOS 27 background shader')
  context.shaderSource(shader, source)
  context.compileShader(shader)
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    const message = context.getShaderInfoLog(shader) ?? 'Unknown shader compile error'
    context.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram(
  context: WebGL2RenderingContext,
  mode: MacOS27EffectBackground
): WebGLProgram {
  const vertex = compileShader(context, context.VERTEX_SHADER, vertexShader)
  const fragment = compileShader(context, context.FRAGMENT_SHADER, fragmentShaders[mode])
  const nextProgram = context.createProgram()
  if (!nextProgram) throw new Error('Unable to create macOS 27 background program')
  context.attachShader(nextProgram, vertex)
  context.attachShader(nextProgram, fragment)
  context.linkProgram(nextProgram)
  context.deleteShader(vertex)
  context.deleteShader(fragment)
  if (!context.getProgramParameter(nextProgram, context.LINK_STATUS)) {
    const message = context.getProgramInfoLog(nextProgram) ?? 'Unknown shader link error'
    context.deleteProgram(nextProgram)
    throw new Error(message)
  }
  return nextProgram
}

function bindProgram(mode: MacOS27EffectBackground): boolean {
  if (!gl) return false
  if (program && renderedBackground === mode) return true
  if (program) gl.deleteProgram(program)
  program = createProgram(gl, mode)
  renderedBackground = mode
  gl.useProgram(program)

  const position = gl.getAttribLocation(program, 'position')
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  resolutionLocation = gl.getUniformLocation(program, 'resolution')
  pointerLocation = gl.getUniformLocation(program, 'pointer')
  timeLocation = gl.getUniformLocation(program, 'time')
  lightModeLocation = gl.getUniformLocation(program, 'lightMode')
  return true
}

function initializeRenderer(): boolean {
  const element = canvas.value
  if (!element || /jsdom/i.test(navigator.userAgent)) return false
  gl = element.getContext('webgl2', {
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance'
  })
  if (!gl) return false

  vertexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  )
  startedAt = performance.now()
  return bindProgram(effectBackground.value)
}

function resize(): void {
  const element = canvas.value
  if (!element || !gl) return
  const ratio = Math.min(window.devicePixelRatio || 1, 1.25)
  const width = Math.max(Math.round(element.clientWidth * ratio), 1)
  const height = Math.max(Math.round(element.clientHeight * ratio), 1)
  if (element.width !== width || element.height !== height) {
    element.width = width
    element.height = height
  }
  gl.viewport(0, 0, width, height)
}

function render(now = performance.now()): void {
  if (!active) return
  if (!gl && !initializeRenderer()) return
  if (!gl || !bindProgram(effectBackground.value) || !program) return

  pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * 0.075
  pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * 0.075
  resize()
  gl.useProgram(program)
  gl.uniform2f(resolutionLocation, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.uniform2f(pointerLocation, pointerCurrent.x, pointerCurrent.y)
  gl.uniform1f(timeLocation, reducedMotion ? 8 : (now - startedAt) / 1000)
  gl.uniform1f(lightModeLocation, lightMode ? 1 : 0)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
}

function animate(now: number): void {
  if (!active || document.hidden || reducedMotion) return
  if (now - lastRenderAt >= FRAME_INTERVAL_MS - 4) {
    lastRenderAt = now
    render(now)
  }
  frame = requestAnimationFrame(animate)
}

function syncTheme(): void {
  const theme = document.documentElement.dataset.theme
  const nextActive = (theme === 'macos27' || theme === 'macos27-light') && !localImageActive.value
  lightMode = theme === 'macos27-light'
  if (nextActive === active) {
    if (active) render()
    return
  }

  active = nextActive
  cancelAnimationFrame(frame)
  if (!active) return
  render()
  if (!reducedMotion && !document.hidden) frame = requestAnimationFrame(animate)
}

function onPointerMove(event: PointerEvent): void {
  pointerTarget.x = Math.min(1, Math.max(0, event.clientX / Math.max(window.innerWidth, 1)))
  pointerTarget.y = 1 - Math.min(1, Math.max(0, event.clientY / Math.max(window.innerHeight, 1)))
}

function onVisibilityChange(): void {
  cancelAnimationFrame(frame)
  if (active && !document.hidden && !reducedMotion) frame = requestAnimationFrame(animate)
}

watch([background, backgroundImage], () => {
  renderedBackground = null
  syncTheme()
})

onMounted(() => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  observer = new MutationObserver(syncTheme)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  if (canvas.value) {
    resizeObserver = new ResizeObserver(() => render())
    resizeObserver.observe(canvas.value)
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  syncTheme()
})

onBeforeUnmount(() => {
  active = false
  cancelAnimationFrame(frame)
  observer?.disconnect()
  resizeObserver?.disconnect()
  window.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (gl && program) gl.deleteProgram(program)
  if (gl && vertexBuffer) gl.deleteBuffer(vertexBuffer)
})
</script>

<template>
  <div
    class="macos27-optics-backdrop"
    data-testid="macos27-optics-backdrop"
    :data-background="background"
    aria-hidden="true"
  >
    <canvas v-show="!localImageActive" ref="canvas" class="macos27-optics-backdrop__canvas" />
    <div
      v-if="localImageActive"
      class="macos27-optics-backdrop__image"
      :style="{ backgroundImage: `url(${backgroundImage})` }"
      data-testid="macos27-local-background-image"
    />
  </div>
</template>
