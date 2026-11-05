import line1 from './assets/line-1.mp3?url'
import line2 from './assets/line-2.mp3?url'
import line3 from './assets/line-3.mp3?url'
import line4 from './assets/line-4.mp3?url'
import line5 from './assets/line-5.mp3?url'
import line6 from './assets/line-6.mp3?url'
import sfxTick from './assets/sfx-tick.mp3?url'
import sfxTicksRun from './assets/sfx-ticks-run.mp3?url'
import splashCss from './splash.css?raw'
import splashUrl from './splash.js?url'

export interface BigfishStartupPlayOptions {
  theme?: 'light' | 'dark'
  /** Fires once the overlay is in the document and covering the window. */
  onReady?: () => void
}

interface StartupHostWindow extends Window {
  __DSH_STARTUP__?: Record<string, unknown>
  __DSH_STARTUP_ASSETS__?: Record<string, string>
  __DSH_STARTUP_LOADED__?: boolean
  __DSH_STARTUP_SKIP__?: boolean
  __DSH_STARTUP_FAILED__?: boolean
  __DSH_STARTUP_FINISHED__?: boolean
}

const ASSETS: Record<string, string> = {
  'line-1': line1,
  'line-2': line2,
  'line-3': line3,
  'line-4': line4,
  'line-5': line5,
  'line-6': line6,
  'sfx-tick': sfxTick,
  'sfx-ticks-run': sfxTicksRun
}

function installStylesheet(): void {
  if (document.getElementById('dsh-startup-style')) return
  const style = document.createElement('style')
  style.id = 'dsh-startup-style'
  style.textContent = splashCss
  document.head.appendChild(style)
}

function whenFinished(win: StartupHostWindow): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearInterval(timer)
      window.removeEventListener('dsh-startup:done', finish)
      resolve()
    }
    const timer = window.setInterval(() => {
      const root = document.getElementById('dsh-startup-root')
      if (!root || win.__DSH_STARTUP_FAILED__) finish()
    }, 200)
    window.addEventListener('dsh-startup:done', finish)
  })
}

/** Plays the vendored boot sequence. Resolves when it finishes or is skipped. */
export function playBigfishStartup(options: BigfishStartupPlayOptions = {}): Promise<void> {
  const win = window as StartupHostWindow
  win.__DSH_STARTUP_LOADED__ = false
  win.__DSH_STARTUP_SKIP__ = false
  win.__DSH_STARTUP_FAILED__ = false
  win.__DSH_STARTUP_FINISHED__ = false
  win.__DSH_STARTUP_ASSETS__ = ASSETS
  win.__DSH_STARTUP__ = {
    enabled: true,
    mode: 'always',
    theme: options.theme === 'dark' ? 'dark' : 'light',
    requireInteraction: true,
    allowSkip: true,
    glass: true,
    glassOpacity: 0.75,
    glassBlur: 22,
    glassSaturate: 160,
    glassBackdropBlur: 28
  }
  installStylesheet()

  const mounted = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = splashUrl
    script.async = false
    script.onload = () => {
      if (!document.getElementById('dsh-startup-root')) {
        reject(new Error('startup screen did not mount'))
        return
      }
      options.onReady?.()
      resolve()
    }
    script.onerror = () => reject(new Error('startup screen failed to load'))
    document.head.appendChild(script)
  })
  // The finish watch starts only after the overlay exists. Before that the
  // missing root would look like the sequence had already ended.
  return mounted.then(() => whenFinished(win))
}
