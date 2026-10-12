import { afterEach, describe, expect, it } from 'vitest'
import { ARCHITECTURE_INTERACTIONS } from './viewer-interactions'
import { secureViewer } from './archify'

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})
function camera() {
  document.body.innerHTML = '<div class="diagram-container"><svg></svg></div>'
  const container = document.querySelector('.diagram-container')!
  const svg = container.querySelector('svg')!
  const state = { scale: 1, x: 0, y: 0 }
  Object.defineProperties(svg, {
    clientWidth: { value: 1000 },
    clientHeight: { value: 500 },
    viewBox: { value: { baseVal: { x: 0, y: 0, width: 1000, height: 500 } } }
  })
  svg.getBoundingClientRect = () => ({ left: state.x, top: state.y }) as DOMRect
  const api = {
    view: {
      state: () => ({ ...state }),
      centerAt: (x: number, y: number, options: { scale: number }) => {
        state.scale = options.scale
        state.x = 500 - x * state.scale
        state.y = 250 - y * state.scale
      }
    }
  }
  const host = { Archify: api }
  new Function('document', 'window', 'Archify', ARCHITECTURE_INTERACTIONS)(document, host, api)
  return { state, container }
}
describe('diagram gestures', () => {
  it('zooms continuously around the pointer and leaves ordinary scrolling unchanged', () => {
    const { state, container } = camera()
    const normal = new WheelEvent('wheel', { deltaY: -30, cancelable: true })
    container.dispatchEvent(normal)
    expect(normal.defaultPrevented).toBe(false)
    expect(state.scale).toBe(1)
    const pinch = new WheelEvent('wheel', {
      deltaY: -30,
      ctrlKey: true,
      clientX: 400,
      clientY: 100,
      cancelable: true
    })
    container.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)
    expect(state.scale).toBeGreaterThan(1)
    expect(state.scale).toBeLessThan(1.5)
    expect(state.x + 400 * state.scale).toBeCloseTo(400)
    expect(state.y + 100 * state.scale).toBeCloseTo(100)
    container.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 30,
        ctrlKey: true,
        clientX: 400,
        clientY: 100,
        cancelable: true
      })
    )
    expect(state.scale).toBeCloseTo(1)
    expect(state.x).toBeCloseTo(0)
    expect(state.y).toBeCloseTo(0)
  })
  it('normalizes wheel units, bounds scale and supports gesture events', () => {
    const { state, container } = camera()
    container.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -1000, deltaMode: 1 }))
    container.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -1000, deltaMode: 2 }))
    expect(state.scale).toBe(3)
    container.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 1000 }))
    expect(state.scale).toBeGreaterThanOrEqual(1)
    const start = new Event('gesturestart', { cancelable: true })
    Object.defineProperty(start, 'scale', { value: 1 })
    container.dispatchEvent(start)
    const change = new Event('gesturechange', { cancelable: true })
    Object.defineProperty(change, 'scale', { value: 1.5 })
    container.dispatchEvent(change)
    expect(change.defaultPrevented).toBe(true)
    expect(state.scale).toBeGreaterThan(1)
  })
  it('upgrades older saved HTML and installs gesture and selection bridges once', () => {
    const old =
      '<html><head></head><body><script data-pi-architecture-bridge></script></body></html>'
    const upgraded = secureViewer(old)
    expect(upgraded).toContain('data-pi-architecture-gestures')
    expect(secureViewer(upgraded)).toBe(upgraded)
    expect([...upgraded.matchAll(/<script data-pi-architecture-gestures>/g)]).toHaveLength(1)
  })
})
