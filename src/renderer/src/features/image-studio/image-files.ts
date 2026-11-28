import type { ImageModelRequest } from '@shared/ipc/api-types'

export const REFERENCE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
type ReferenceMime = (typeof REFERENCE_MIME_TYPES)[number]

export function readImageDataUrl(image: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(image)
  })
}

export async function readReferenceImage(
  image: Blob,
  fileName: string
): Promise<NonNullable<ImageModelRequest['sourceImage']>> {
  if (!REFERENCE_MIME_TYPES.includes(image.type as ReferenceMime)) {
    throw new Error('models.imageUnsupportedType')
  }
  if (image.size > 20 * 1024 * 1024) throw new Error('models.imageTooLarge')
  const dataUrl = await readImageDataUrl(image)
  return {
    mimeType: image.type as ReferenceMime,
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    fileName: fileName.slice(0, 255)
  }
}

export function imageDownloadName(modelId: string, createdAt: number, mimeType: string): string {
  const extension =
    mimeType === 'image/jpeg' ? 'jpg' : (mimeType.match(/^image\/(png|webp|gif)$/)?.[1] ?? 'png')
  return `${modelId.replace(/[^\w.-]+/g, '-').slice(0, 80)}-${createdAt}.${extension}`
}
