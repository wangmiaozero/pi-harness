import backgroundUrl from './assets/background.mp4?url'
import skinCss from './video-skin.css?raw'

const STYLE_ID = 'dsvs-skin-style'
const ROOT_ID = 'dsvs-backdrop'

let visibilityBound = false

function installStylesheet(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = skinCss
  document.head.appendChild(style)
}

function videoElement(): HTMLVideoElement | null {
  return document.getElementById('dsvs-backdrop-video') as HTMLVideoElement | null
}

function onVisibility(): void {
  const video = videoElement()
  if (!video) return
  if (document.hidden) video.pause()
  else void video.play().catch(() => undefined)
}

function teardown(): void {
  delete document.documentElement.dataset.videoSkin
  videoElement()?.pause()
  document.getElementById(ROOT_ID)?.remove()
}

/** Shows or removes the DeepSeek chat video. The first frame reveals the skin. */
export function syncDeepseekVideoSkin(active: boolean): void {
  if (!active) {
    teardown()
    return
  }
  if (document.getElementById(ROOT_ID)) return
  installStylesheet()
  const layer = document.createElement('div')
  layer.id = ROOT_ID
  const video = document.createElement('video')
  video.id = 'dsvs-backdrop-video'
  video.muted = true
  video.defaultMuted = true
  video.loop = true
  video.playsInline = true
  video.preload = 'auto'
  video.setAttribute('playsinline', '')
  video.setAttribute('muted', '')
  video.setAttribute('aria-hidden', 'true')
  const veil = document.createElement('div')
  veil.id = 'dsvs-backdrop-veil'
  layer.append(video, veil)
  document.body.prepend(layer)
  video.addEventListener('loadeddata', () => {
    video.setAttribute('data-shown', '1')
    document.documentElement.dataset.videoSkin = 'on'
  })
  video.addEventListener('error', () => teardown())
  video.src = backgroundUrl
  void video.play().catch(() => undefined)
  if (!visibilityBound) {
    visibilityBound = true
    document.addEventListener('visibilitychange', onVisibility)
  }
}
