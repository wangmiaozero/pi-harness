import { ref, type Ref } from 'vue'

export const STICK_TO_BOTTOM_THRESHOLD = 24

/**
 * Pin a chat transcript to the latest message while content is growing
 * (streaming), without yanking the viewport if the user has scrolled away.
 *
 * Layout, content-visibility, and programmatic `scrollTop` assignments all
 * fire `scroll` events that look identical to user input. Those must not
 * clear the stick flag; only wheel / touch / scrollbar gestures do.
 */
export function useStickToBottom(
  scroller: Ref<HTMLElement | null>,
  content: Ref<HTMLElement | null>,
  options?: { threshold?: number }
) {
  const threshold = options?.threshold ?? STICK_TO_BOTTOM_THRESHOLD
  const hasOverflow = ref(false)
  const atTop = ref(true)
  const atBottom = ref(true)

  let stickToBottom = true
  let programmatic = false
  let programmaticGeneration = 0
  let syncFrame: number | null = null
  let resizeObserver: ResizeObserver | null = null
  let touchY = 0
  const guardFrames = new Set<number>()
  let removeScrollend: (() => void) | null = null
  let scrollendTimer: ReturnType<typeof setTimeout> | null = null

  function updateState() {
    const el = scroller.value
    if (!el) return
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    hasOverflow.value = maxScrollTop > 1
    atTop.value = el.scrollTop <= threshold
    atBottom.value = maxScrollTop - el.scrollTop <= threshold
  }

  function clearScrollendTimer() {
    removeScrollend?.()
    removeScrollend = null
    if (scrollendTimer === null) return
    clearTimeout(scrollendTimer)
    scrollendTimer = null
  }

  function afterFrame(callback: () => void) {
    const frame = requestAnimationFrame(() => {
      guardFrames.delete(frame)
      callback()
    })
    guardFrames.add(frame)
  }

  function beginProgrammatic(until: 'frame' | 'settle' = 'frame') {
    programmatic = true
    const generation = ++programmaticGeneration
    clearScrollendTimer()
    if (until === 'frame') {
      afterFrame(() => {
        afterFrame(() => {
          if (generation !== programmaticGeneration) return
          programmatic = false
        })
      })
    }
    return generation
  }

  function endProgrammatic() {
    programmaticGeneration += 1
    for (const frame of guardFrames) cancelAnimationFrame(frame)
    guardFrames.clear()
    programmatic = false
    clearScrollendTimer()
  }

  function pinToBottom() {
    const el = scroller.value
    if (!el || !stickToBottom) return
    beginProgrammatic('frame')
    el.scrollTop = el.scrollHeight
  }

  function distanceFromBottom(el: HTMLElement): number {
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  function syncAfterContentResize() {
    pinToBottom()
    updateState()
    const el = scroller.value
    if (!el || !stickToBottom) return
    // content-visibility / late markdown layout can grow the transcript after
    // the first pin; one extra assignment catches the remainder in-frame.
    if (distanceFromBottom(el) > threshold) {
      pinToBottom()
      updateState()
    }
  }

  function scheduleSync() {
    if (syncFrame !== null) return
    syncFrame = requestAnimationFrame(() => {
      syncFrame = null
      syncAfterContentResize()
    })
  }

  function onScroll() {
    updateState()
    if (programmatic) return
    // A late layout/scroll event can arrive after the programmatic guard has
    // expired. Only explicit gestures should release follow mode.
    if (atBottom.value) stickToBottom = true
    else if (stickToBottom) scheduleSync()
  }

  function onWheel(event: WheelEvent) {
    endProgrammatic()
    if (event.deltaY < 0) stickToBottom = false
  }

  function onTouchStart(event: TouchEvent) {
    touchY = event.touches[0]?.clientY ?? 0
  }

  function onTouchMove(event: TouchEvent) {
    const y = event.touches[0]?.clientY ?? 0
    const dy = y - touchY
    touchY = y
    if (dy > 2) {
      endProgrammatic()
      stickToBottom = false
    }
  }

  function onPointerDown(event: PointerEvent) {
    const el = scroller.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (event.clientX - rect.left >= el.clientWidth) {
      endProgrammatic()
      stickToBottom = false
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable="true"]')) return
    if (
      !event.defaultPrevented &&
      (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey))
    ) {
      endProgrammatic()
      stickToBottom = false
    }
  }

  function scrollToEdge(edge: 'top' | 'bottom', behavior?: ScrollBehavior) {
    const el = scroller.value
    if (!el) return
    stickToBottom = edge === 'bottom'
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const resolved = behavior ?? (reducedMotion ? 'auto' : 'smooth')
    const generation = beginProgrammatic(resolved === 'smooth' ? 'settle' : 'frame')
    el.scrollTo({
      top: edge === 'top' ? 0 : el.scrollHeight,
      behavior: resolved
    })
    if (resolved !== 'smooth') return

    const settle = () => {
      if (generation !== programmaticGeneration) return
      clearScrollendTimer()
      programmatic = false
      updateState()
    }
    el.addEventListener('scrollend', settle, { once: true })
    removeScrollend = () => el.removeEventListener('scrollend', settle)
    scrollendTimer = setTimeout(() => {
      scrollendTimer = null
      settle()
    }, 400)
  }

  function stick() {
    stickToBottom = true
  }

  /** Leave follow mode without a user gesture: minimap jumps call this first. */
  function release() {
    stickToBottom = false
  }

  function bind() {
    resizeObserver?.disconnect()
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleSync)
      if (scroller.value) resizeObserver.observe(scroller.value)
      if (content.value) resizeObserver.observe(content.value)
    }
    syncAfterContentResize()
  }

  function unbind() {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (syncFrame !== null) {
      cancelAnimationFrame(syncFrame)
      syncFrame = null
    }
    endProgrammatic()
  }

  return {
    hasOverflow,
    atTop,
    atBottom,
    onScroll,
    onWheel,
    onTouchStart,
    onTouchMove,
    onPointerDown,
    onKeyDown,
    scrollToEdge,
    stick,
    release,
    scheduleSync,
    bind,
    unbind,
    /** Test seam: whether the next content resize should pin to the latest message. */
    isStuck: () => stickToBottom
  }
}
