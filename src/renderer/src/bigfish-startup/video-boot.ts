import bootUrl from './assets/boot.mp4?url'
import scanUrl from './assets/whale-girl-scan.mp4?url'
import bootCss from './video-boot.css?raw'
import type { DeepseekBootClip } from './gate'

const FADE_MS = 1000
const SKIP_FADE_MS = 320
const HOLD_MS = 18000
const HOLD_GRACE_MS = 4000
const NO_FRAME_MS = 12000
const UNDER_SPLASH_Z = '2147482000'

const CLIP_URL: Record<DeepseekBootClip, string> = {
  boot: bootUrl,
  scan: scanUrl
}

export interface VideoBootOptions {
  /** The clip stays up until this is true and the video has ended. */
  isReady?: () => boolean
  signal?: AbortSignal
  /** Ignored when a plate was already primed for this launch. */
  clip?: DeepseekBootClip
}

interface PrimedBoot {
  root: HTMLDivElement
  video: HTMLVideoElement
  hint: HTMLDivElement
  fill: HTMLDivElement
  sound: HTMLDivElement
  watch: MutationObserver | null
  clip: DeepseekBootClip
}

let primed: PrimedBoot | null = null

function installStylesheet(): void {
  if (document.getElementById('dsvs-boot-style')) return
  const style = document.createElement('style')
  style.id = 'dsvs-boot-style'
  style.textContent = bootCss
  document.head.appendChild(style)
}

function element(className: string, text?: string): HTMLDivElement {
  const node = document.createElement('div')
  node.className = className
  if (text) node.textContent = text
  return node
}

function mountBoot(underSplash: boolean, clip: DeepseekBootClip): PrimedBoot {
  installStylesheet()
  const root = element('dsvs-boot')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', '启动动画')
  root.setAttribute('data-state', 'idle')
  root.style.setProperty('--dsvs-boot-fade', `${FADE_MS}ms`)
  if (underSplash) root.style.zIndex = UNDER_SPLASH_Z

  const video = document.createElement('video')
  video.className = 'dsvs-boot-video'
  video.playsInline = true
  video.preload = 'auto'
  video.setAttribute('playsinline', '')
  video.setAttribute('aria-hidden', 'true')

  const fill = element('dsvs-boot-fill')
  const bar = element('dsvs-boot-bar')
  bar.appendChild(fill)
  const hint = element('dsvs-boot-hint', underSplash ? '正在进入…' : '正在启动…')
  const ui = element('dsvs-boot-ui')
  ui.append(bar, hint)
  const skip = element('dsvs-boot-skip')
  skip.append(element('dsvs-boot-skip-glyph', '▶'), element('', '点击画面跳过'))
  const sound = element('dsvs-boot-sound')
  sound.setAttribute('data-visible', '0')
  sound.append(element('dsvs-boot-sound-glyph', '🔇'), element('', '开启声音'))
  root.append(video, element('dsvs-boot-veil'), ui, skip, sound)
  document.body.appendChild(root)
  video.src = CLIP_URL[clip]
  video.addEventListener('loadeddata', () => video.setAttribute('data-shown', '1'), { once: true })
  return { root, video, hint, fill, sound, watch: null, clip }
}

/** Puts the video plate under the current startup so its fade reveals this frame. */
export function primeVideoBoot(clip: DeepseekBootClip = 'boot'): void {
  if (primed) return
  const boot = mountBoot(true, clip)
  primed = boot
  const begin = () => {
    if (boot.video.paused) void boot.video.play().catch(() => undefined)
  }
  const watch = new MutationObserver(() => {
    const node = document.getElementById('dsh-startup-root')
    if (!node) return
    if (node.classList.contains('dsu-handoff') || node.classList.contains('dsu-gone')) {
      watch.disconnect()
      begin()
    }
  })
  boot.watch = watch
  watch.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true
  })
}

export function cancelVideoBoot(): void {
  primed?.watch?.disconnect()
  primed?.video.pause()
  primed?.root.remove()
  primed = null
}

/** Plays the DeepSeek video boot. Resolves after the fade, a skip, or a failure. */
export function playVideoBoot(options: VideoBootOptions = {}): Promise<void> {
  const clip = primed?.clip ?? options.clip ?? 'boot'
  const boot = primed ?? mountBoot(false, clip)
  boot.watch?.disconnect()
  primed = null
  const { root, video, hint, fill, sound } = boot
  root.style.zIndex = '2147483647'
  const isReady = options.isReady ?? (() => true)

  let leaving = false
  let clipDone = false
  let appReady = false
  const timers: number[] = []
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timers.push(id)
    return id
  }
  const clearTimers = () => {
    for (const id of timers) window.clearTimeout(id)
    timers.length = 0
  }

  return new Promise((resolve) => {
    const finish = () => {
      clearTimers()
      window.removeEventListener('keydown', onKey)
      options.signal?.removeEventListener('abort', skipNow)
      video.pause()
      root.remove()
      resolve()
    }
    const leave = (ms: number) => {
      if (leaving) return
      leaving = true
      root.style.setProperty('--dsvs-boot-fade', `${ms}ms`)
      root.setAttribute('data-state', 'leaving')
      const from = video.muted ? 0 : video.volume
      const frames = Math.max(1, Math.round(ms / 16))
      let done = 0
      const fade = () => {
        done += 1
        video.volume = Math.max(0, from * (1 - done / frames))
        if (done < frames) requestAnimationFrame(fade)
      }
      if (from > 0) requestAnimationFrame(fade)
      later(finish, ms + 140)
    }
    const skipNow = () => leave(SKIP_FADE_MS)
    const maybeEnter = () => {
      if (leaving) return
      if (!clipDone) return
      if (!appReady) {
        hint.textContent = '界面就绪后自动进入'
        return
      }
      leave(FADE_MS)
    }
    const markClipDone = () => {
      clipDone = true
      maybeEnter()
    }
    const markReady = () => {
      if (appReady) return
      appReady = true
      if (!leaving) hint.textContent = '正在进入…'
      maybeEnter()
    }
    const pollReady = () => {
      if (leaving) return
      if (isReady()) {
        markReady()
        return
      }
      later(pollReady, 120)
    }

    video.addEventListener('timeupdate', () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return
      fill.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100).toFixed(1)}%`
    })
    video.addEventListener('ended', markClipDone)
    video.addEventListener('error', () => {
      if (video.dataset.retried === '1') {
        markClipDone()
        return
      }
      video.dataset.retried = '1'
      video.src = CLIP_URL[clip]
      void video.play().catch(() => markClipDone())
    })
    later(() => {
      if (video.readyState < 2) markClipDone()
    }, NO_FRAME_MS)
    later(() => {
      if (leaving || appReady) return
      root.setAttribute('data-attention', '1')
      hint.textContent = '启动较慢，正在进入…'
      markReady()
      later(() => {
        if (!leaving) leave(FADE_MS)
      }, HOLD_GRACE_MS)
    }, HOLD_MS)

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') skipNow()
    }
    root.addEventListener(
      'pointerdown',
      (event) => {
        if ((event.target as Element | null)?.closest('.dsvs-boot-sound')) return
        event.preventDefault()
        skipNow()
      },
      true
    )
    sound.addEventListener('click', (event) => {
      event.stopPropagation()
      event.preventDefault()
      video.muted = false
      video.volume = 1
      void video.play().then(
        () => sound.setAttribute('data-visible', '0'),
        () => sound.setAttribute('data-visible', '1')
      )
    })
    window.addEventListener('keydown', onKey)
    options.signal?.addEventListener('abort', skipNow, { once: true })

    const played = video.play()
    if (played) {
      void played.catch(() => {
        video.muted = true
        sound.setAttribute('data-visible', '1')
        hint.textContent = '点左下角开声音'
        void video.play().catch(() => markClipDone())
      })
    }
    pollReady()
  })
}
