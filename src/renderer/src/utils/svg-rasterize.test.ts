import { afterEach, describe, expect, it, vi } from 'vitest'
import { rasterizeSvgImageResult } from './svg-rasterize'

describe('rasterizeSvgImageResult', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('leaves normal image results unchanged', async () => {
    const result = { mimeType: 'image/png', base64: 'iVBORw==', revisedPrompt: null }
    await expect(rasterizeSvgImageResult(result, '1024x1024')).resolves.toBe(result)
  })

  it('renders a sanitized SVG result to PNG dimensions', async () => {
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((callback: (blob: Blob | null) => void) =>
        callback(new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }))
      )
    }
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg-fallback')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    class LoadedImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', LoadedImage)

    const result = await rasterizeSvgImageResult(
      {
        mimeType: 'image/svg+xml',
        base64: btoa('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        revisedPrompt: null,
        fallbackKind: 'svg'
      },
      '768x1360'
    )

    expect(result).toMatchObject({ mimeType: 'image/png', base64: 'AQID' })
    expect(canvas).toMatchObject({ width: 1360, height: 768 })
    expect(drawImage).toHaveBeenCalledWith(expect.any(LoadedImage), 0, 0, 1360, 768)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg-fallback')
  })
})
