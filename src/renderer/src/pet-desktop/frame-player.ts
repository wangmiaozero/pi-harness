/**
 * WebP frame player for the desktop pet window.
 *
 * Clips are frame sequences (`pi-pet://petpack/<packId>/<clip>/<n>.webp`)
 * swapped into a single <img>. Frames of the active clip are preloaded so
 * playback never stutters; the current frame stays available as a canvas
 * for alpha hit-testing (click-through).
 */

import type { PetPackClipInfo, PetPackManifest } from '@shared/pet/desktop'

export const FRAME_NAME_PATTERN = /^[\w][\w.-]*\.webp$/
const CLIP_DIR_PATTERN = /^(clips\/)?[\w][\w.-]*$/
const PRELOAD_BATCH_MS = 24

/** Frame files follow `<clipName>_<1-based 3-digit>.webp`, e.g. idle_001.webp. */
export function frameFileName(clipDir: string, index: number): string {
  const name = clipDir.split('/').pop() ?? clipDir
  return `${name}_${String(index + 1).padStart(3, '0')}.webp`
}

export function frameUrl(packId: string, clipDir: string, file: string): string {
  if (
    !/^[\w-]+$/.test(packId) ||
    !CLIP_DIR_PATTERN.test(clipDir) ||
    !FRAME_NAME_PATTERN.test(file)
  ) {
    throw new Error('Invalid pet frame reference')
  }
  return `pi-pet://petpack/${packId}/${clipDir}/${file}`
}

/** Frames load from `pi-pet://` (cross-origin): CORS-clean for canvas sampling. */
function createFrameImage(): HTMLImageElement {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.draggable = false
  image.alt = ''
  return image
}

interface PlayingClip {
  info: PetPackClipInfo
  frame: number
  /** Non-looping clips report completion once. */
  finished: boolean
}

export class FramePlayer {
  private readonly img: HTMLImageElement
  /** Alpha sampling surface for click-through hit-testing. */
  private readonly sampler: HTMLCanvasElement
  private readonly samplerCtx: CanvasRenderingContext2D | null
  private current: PlayingClip | null = null
  private timer: number | null = null
  private readonly preloaded = new Map<string, HTMLImageElement[]>()

  onClipEnd: (() => void) | null = null

  constructor(
    private readonly packId: string,
    private readonly manifest: PetPackManifest
  ) {
    this.img = createFrameImage()
    this.sampler = document.createElement('canvas')
    this.sampler.width = manifest.baseWidth
    this.sampler.height = manifest.baseHeight
    this.samplerCtx = this.sampler.getContext('2d', { willReadFrequently: true })
  }

  get element(): HTMLImageElement {
    return this.img
  }

  /** True when the given clip exists in the pack. */
  has(clipDir: string): boolean {
    return this.manifest.clips[clipDir] !== undefined
  }

  /** Warm the image cache for a clip (background, capped to keep memory sane). */
  preload(clipDir: string): void {
    const key = `${this.packId}/${clipDir}`
    if (this.preloaded.has(key)) return
    const info = this.manifest.clips[clipDir]
    if (!info) return
    const images: HTMLImageElement[] = []
    for (let i = 0; i < info.frames; i += 1) {
      const image = createFrameImage()
      image.src = frameUrl(this.packId, clipDir, frameFileName(clipDir, i))
      images.push(image)
    }
    this.preloaded.set(key, images)
    // Retire distant clip caches so a long session cannot accumulate frames.
    if (this.preloaded.size > 4) {
      const oldest = this.preloaded.keys().next().value
      if (oldest && oldest !== key) this.preloaded.delete(oldest)
    }
  }

  play(clipDir: string, onEnd?: () => void, loop?: boolean): void {
    const info = this.manifest.clips[clipDir]
    if (!info) {
      onEnd?.()
      return
    }
    this.stop()
    this.current = { info: { ...info, loop: loop ?? info.loop }, frame: 0, finished: false }
    if (onEnd) this.onClipEnd = onEnd
    this.preload(clipDir)
    this.showFrame(0)
    const interval = Math.max(PRELOAD_BATCH_MS, Math.round(1000 / Math.max(1, this.manifest.fps)))
    this.timer = window.setInterval(() => this.advance(), interval)
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    this.current = null
    this.onClipEnd = null
  }

  /** Release all cached frames and stop playback (pack switch / teardown). */
  dispose(): void {
    this.stop()
    for (const images of this.preloaded.values()) {
      for (const image of images) image.src = ''
    }
    this.preloaded.clear()
    this.img.src = ''
    this.sampler.width = 0
    this.sampler.height = 0
  }

  /** Sample the alpha channel under a point (CSS px, image-local scale). */
  alphaAt(localX: number, localY: number): number {
    const ctx = this.samplerCtx
    if (!ctx) return 0
    const { naturalWidth, naturalHeight } = this.img
    if (!naturalWidth || !naturalHeight) return 0
    const x = Math.round((localX / this.img.clientWidth) * naturalWidth)
    const y = Math.round((localY / this.img.clientHeight) * naturalHeight)
    if (x < 0 || y < 0 || x >= naturalWidth || y >= naturalHeight) return 0
    ctx.drawImage(this.img, 0, 0)
    const data = ctx.getImageData(x, y, 1, 1).data
    return data[3]
  }

  private advance(): void {
    const clip = this.current
    if (!clip) return
    const next = clip.frame + 1
    if (next >= clip.info.frames) {
      if (clip.info.loop) {
        clip.frame = 0
      } else {
        if (!clip.finished) {
          clip.finished = true
          const end = this.onClipEnd
          this.onClipEnd = null
          end?.()
        }
        return
      }
    } else {
      clip.frame = next
    }
    this.showFrame(clip.frame)
  }

  private showFrame(frame: number): void {
    const clip = this.current
    if (!clip) return
    this.img.src = frameUrl(this.packId, clip.info.dir, frameFileName(clip.info.dir, frame))
  }
}
