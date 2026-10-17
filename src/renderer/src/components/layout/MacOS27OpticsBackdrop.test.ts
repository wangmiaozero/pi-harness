import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MacOS27OpticsBackdrop from './MacOS27OpticsBackdrop.vue'

vi.mock('@renderer/stores/settings', () => ({
  useSettingsStore: () => ({ settings: { macos27Background: 'liquid-ether' } })
}))

let nextFrame: FrameRequestCallback
let wrapper: ReturnType<typeof mount> | undefined

function context() {
  return {
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    useProgram: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    viewport: vi.fn(),
    uniform2f: vi.fn(),
    uniform1f: vi.fn(),
    drawArrays: vi.fn(),
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn()
  } as unknown as WebGL2RenderingContext
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'macos27-light'
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('test-browser')
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(780)
  vi.stubGlobal('devicePixelRatio', 1.25)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback
      return 1
    })
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps software rendering animated within a small pixel and frame budget', async () => {
  const gl = context()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((_, options) =>
    (options as WebGLContextAttributes)?.failIfMajorPerformanceCaveat ? null : (gl as never)
  )
  wrapper = mount(MacOS27OpticsBackdrop)
  await wrapper.vm.$nextTick()
  const canvas = wrapper.get('canvas').element as HTMLCanvasElement
  expect(canvas.width).toBeLessThanOrEqual(320)
  expect(canvas.height).toBeLessThanOrEqual(240)
  expect(wrapper.attributes('data-renderer')).toBe('reduced')
  const before = vi.mocked(gl.drawArrays).mock.calls.length
  nextFrame(1000)
  nextFrame(1040)
  expect(gl.drawArrays).toHaveBeenCalledTimes(before + 1)
  nextFrame(1200)
  expect(gl.drawArrays).toHaveBeenCalledTimes(before + 2)
})

it('uses a static background without retrying every frame when WebGL is unavailable', async () => {
  const create = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  wrapper = mount(MacOS27OpticsBackdrop)
  await wrapper.vm.$nextTick()
  expect(wrapper.attributes('data-renderer')).toBe('static')
  expect(wrapper.get('canvas').isVisible()).toBe(false)
  expect(requestAnimationFrame).not.toHaveBeenCalled()
  expect(create).toHaveBeenCalledTimes(2)
})

it('retains full resolution and animation on accelerated graphics', () => {
  const gl = context()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl as never)
  wrapper = mount(MacOS27OpticsBackdrop)
  const canvas = wrapper.get('canvas').element as HTMLCanvasElement
  expect(canvas.width).toBe(1500)
  expect(canvas.height).toBe(975)
  const before = vi.mocked(gl.drawArrays).mock.calls.length
  nextFrame(1000)
  nextFrame(1040)
  expect(gl.drawArrays).toHaveBeenCalledTimes(before + 2)
})
