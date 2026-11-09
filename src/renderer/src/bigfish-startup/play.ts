import { marketFileUrl } from '@shared/market/urls'
import { themePackForStyle } from '@shared/market/style-packs'
import type { MascotStyle } from '@shared/constants/mascot'
import { finaleLineKey, startupBrandCopy } from './gate'
import { startupLogo } from './logos'
import splashCss from './splash.css?raw'
import splashUrl from './splash.js?url'

export { cancelVideoBoot, playVideoBoot, primeVideoBoot } from './video-boot'
export { syncDeepseekVideoSkin } from './video-skin'

export interface BigfishStartupPlayOptions {
  theme?: 'light' | 'dark'
  mascotStyle?: MascotStyle
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

function startupAsset(style: MascotStyle | undefined, file: string): string {
  const pack = themePackForStyle(style)
  if (pack && pack !== 'phoebe') return marketFileUrl('theme', pack, `assets/startup/${file}`)
  return marketFileUrl('pet', 'bigfish', `assets/startup/${file}`)
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
  const asset = (file: string) => startupAsset(options.mascotStyle, file)
  win.__DSH_STARTUP_ASSETS__ = {
    'line-1': asset('line-1.mp3'),
    'line-2': asset('line-2.mp3'),
    'line-3': asset('line-3.mp3'),
    'line-4': asset('line-4.mp3'),
    'line-5': asset('line-5.mp3'),
    'line-6': asset(`${finaleLineKey(options.mascotStyle)}.mp3`),
    'sfx-tick': asset('sfx-tick.mp3'),
    'sfx-ticks-run': asset('sfx-ticks-run.mp3')
  }
  const logo = startupLogo(options.mascotStyle)
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
    glassBackdropBlur: 28,
    ...startupBrandCopy(options.mascotStyle),
    ...(logo ? { logoViewBox: logo.viewBox, logoPaths: logo.paths } : {})
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
