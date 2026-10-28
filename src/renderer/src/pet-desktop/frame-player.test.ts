import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FramePlayer, frameFileName, frameUrl } from './frame-player'

function manifest() {
  return {
    formatVersion: 1 as const,
    id: 'testpack',
    name: 'Test Pack',
    nameEn: 'Test Pack',
    author: 'tester',
    version: '1.0.0',
    license: 'MIT',
    licenseFiles: ['LICENSE'],
    baseWidth: 128,
    baseHeight: 128,
    fps: 8,
    clips: { idle: { dir: 'clips/idle', frames: 2, loop: true } }
  }
}

describe('FramePlayer image loading', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Image',
      class extends window.Image {
        constructor() {
          super()
          created.push(this)
        }
      }
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    created.length = 0
  })

  const created: HTMLImageElement[] = []

  it('marks the playback image crossOrigin anonymous so the alpha sampler canvas is not tainted', () => {
    const player = new FramePlayer('testpack', manifest())
    expect(player.element.crossOrigin).toBe('anonymous')
  })

  it('finishes an interaction even when its pack clip normally loops', () => {
    vi.useFakeTimers()
    const player = new FramePlayer('testpack', manifest())
    const finished = vi.fn()
    player.play('idle', finished, false)
    vi.advanceTimersByTime(750)
    expect(finished).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(750)
    expect(finished).toHaveBeenCalledOnce()
    player.dispose()
  })

  it('marks preloaded frames crossOrigin anonymous too', () => {
    const player = new FramePlayer('testpack', manifest())
    expect(created.length).toBe(1) // playback image from the constructor
    player.preload('idle')
    expect(created.length).toBe(3) // + 2 preloaded frames
    for (const image of created) expect(image.crossOrigin).toBe('anonymous')
  })
})

describe('frameFileName', () => {
  it('pads the 1-based frame index to three digits', () => {
    expect(frameFileName('clips/idle', 0)).toBe('idle_001.webp')
    expect(frameFileName('clips/idle', 11)).toBe('idle_012.webp')
  })
})

describe('frameUrl', () => {
  it('rejects traversal and hostile inputs', () => {
    expect(() => frameUrl('../etc', 'clips/idle', 'idle_001.webp')).toThrow()
    expect(() => frameUrl('pack', '../..', 'idle_001.webp')).toThrow()
    expect(() => frameUrl('pack', 'clips/idle', 'x.png')).toThrow()
    expect(frameUrl('pack', 'clips/idle', 'idle_001.webp')).toBe(
      'pi-pet://petpack/pack/clips/idle/idle_001.webp'
    )
  })
})
