import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STICK_TO_BOTTOM_THRESHOLD, useStickToBottom } from './useStickToBottom'
import { ref } from 'vue'

class FakeScroller {
  clientWidth = 320
  clientHeight = 400
  scrollHeight = 0
  listeners = new Map<string, Set<EventListener>>()
  private _scrollTop = 0
  onScrollTop: (() => void) | null = null

  get scrollTop() {
    return this._scrollTop
  }

  set scrollTop(value: number) {
    const max = Math.max(0, this.scrollHeight - this.clientHeight)
    this._scrollTop = Math.min(Math.max(0, value), max)
    this.onScrollTop?.()
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 320, bottom: 400, width: 320, height: 400 }
  }

  scrollTo(options: { top?: number }) {
    this.scrollTop = options.top ?? this.scrollTop
  }

  addEventListener(type: string, listener: EventListener) {
    const bucket = this.listeners.get(type) ?? new Set()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener)
  }
}

function flushFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

describe('useStickToBottom', () => {
  let observed: ResizeObserverCallback | null = null

  beforeEach(() => {
    observed = null
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observed = callback
        }
        observe() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup(initial: { scrollHeight: number; scrollTop?: number }) {
    const scroller = new FakeScroller()
    scroller.scrollHeight = initial.scrollHeight
    scroller.scrollTop =
      initial.scrollTop ?? Math.max(0, initial.scrollHeight - scroller.clientHeight)
    const scrollerRef = ref<HTMLElement | null>(scroller as unknown as HTMLElement)
    const contentRef = ref<HTMLElement | null>(document.createElement('div'))
    const api = useStickToBottom(scrollerRef, contentRef)
    scroller.onScrollTop = () => api.onScroll()
    api.bind()
    return { scroller, api }
  }

  it('pins to the latest content while stuck during streaming growth', async () => {
    const { scroller, api } = setup({ scrollHeight: 800 })
    expect(scroller.scrollTop).toBe(400)

    scroller.scrollHeight = 1400
    observed?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver)
    await flushFrames()

    expect(api.isStuck()).toBe(true)
    expect(scroller.scrollTop).toBe(1000)
    expect(api.atBottom.value).toBe(true)
  })

  it('does not treat a programmatic pin as the user leaving the bottom', async () => {
    const { scroller, api } = setup({ scrollHeight: 800 })
    scroller.scrollHeight = 1600
    api.scheduleSync()

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    // Pin has assigned scrollTop; the browser scroll event can still report a
    // stale offset for a frame. That must not clear the stick flag.
    scroller.scrollTop = 400
    expect(api.isStuck()).toBe(true)

    api.scheduleSync()
    await flushFrames()
    expect(api.isStuck()).toBe(true)
    expect(scroller.scrollTop).toBe(1200)
  })

  it('stops following after the user scrolls up, then resumes at the bottom', async () => {
    const { scroller, api } = setup({ scrollHeight: 800 })

    api.onWheel({ deltaY: -80 } as WheelEvent)
    scroller.scrollTop = 40
    expect(api.isStuck()).toBe(false)

    scroller.scrollHeight = 1800
    api.scheduleSync()
    await flushFrames()
    expect(scroller.scrollTop).toBe(40)

    scroller.scrollTop = 1800 - scroller.clientHeight
    expect(api.isStuck()).toBe(true)

    scroller.scrollHeight = 2200
    api.scheduleSync()
    await flushFrames()
    expect(scroller.scrollTop).toBe(1800)
  })

  it('unsticks on an upward touch drag without moving the user viewport', async () => {
    const { scroller, api } = setup({ scrollHeight: 900 })
    const startTop = scroller.scrollTop

    api.onTouchStart({ touches: [{ clientY: 120 }] } as unknown as TouchEvent)
    api.onTouchMove({ touches: [{ clientY: 180 }] } as unknown as TouchEvent)
    expect(api.isStuck()).toBe(false)

    scroller.scrollHeight = 1600
    api.scheduleSync()
    await flushFrames()
    expect(scroller.scrollTop).toBe(startTop)
  })

  it('reports the edge threshold used by the scroll controls', () => {
    const { scroller, api } = setup({ scrollHeight: 800 })
    scroller.scrollTop = 800 - 400 - STICK_TO_BOTTOM_THRESHOLD
    expect(api.atBottom.value).toBe(true)
    expect(api.hasOverflow.value).toBe(true)

    scroller.scrollTop = 0
    expect(api.atTop.value).toBe(true)
    expect(api.atBottom.value).toBe(false)
  })
})
