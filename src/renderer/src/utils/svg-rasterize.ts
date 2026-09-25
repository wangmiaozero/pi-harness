import type { ImageModelRequest, ImageModelResult } from '@shared/ipc/api-types'

export async function rasterizeSvgImageResult(
  result: ImageModelResult,
  size: ImageModelRequest['size']
): Promise<ImageModelResult> {
  if (result.mimeType !== 'image/svg+xml') return result

  const [height, width] = size.split('x').map(Number) as [number, number]
  const bytes = Uint8Array.from(atob(result.base64), (character) => character.charCodeAt(0))
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(objectUrl)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.drawImage(image, 0, 0, width, height)
    const png = await canvasToBlob(canvas)
    return {
      ...result,
      mimeType: 'image/png',
      base64: bytesToBase64(new Uint8Array(await png.arrayBuffer()))
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to render SVG fallback'))
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to encode SVG fallback as PNG'))
    }, 'image/png')
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
