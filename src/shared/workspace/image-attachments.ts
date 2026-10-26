export const MAX_ATTACHED_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHED_IMAGES = 10
export const MAX_ATTACHED_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_ATTACHED_IMAGE_BYTES / 3)

export interface Base64ImageAttachment {
  data: string
  mimeType: string
}

function isBase64DataChar(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f
  )
}

export function getBase64DecodedByteLength(data: string): number | null {
  if (!data || data.length % 4 !== 0) return null
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const dataEnd = data.length - padding
  for (let index = 0; index < dataEnd; index += 1) {
    if (!isBase64DataChar(data.charCodeAt(index))) return null
  }
  for (let index = dataEnd; index < data.length; index += 1) {
    if (data[index] !== '=') return null
  }
  return (data.length / 4) * 3 - padding
}

export function isBase64ImageWithinLimits(value: unknown): value is Base64ImageAttachment {
  if (!value || typeof value !== 'object') return false
  const image = value as Partial<Base64ImageAttachment>
  if (
    typeof image.data !== 'string' ||
    image.data.length > MAX_ATTACHED_IMAGE_BASE64_LENGTH ||
    typeof image.mimeType !== 'string' ||
    !image.mimeType.startsWith('image/')
  ) {
    return false
  }
  const bytes = getBase64DecodedByteLength(image.data)
  return bytes !== null && bytes <= MAX_ATTACHED_IMAGE_BYTES
}

/**
 * Pi appends image resize metadata (e.g. "[Image: original 3354x2168, displayed at
 * 2000x1293. Multiply coordinates by 1.68 to map to original image.]") to persisted
 * prompts that carry images. It is model-facing context, not user-authored text,
 * so it must never be rendered back to the user.
 */
export const IMAGE_METADATA_SUFFIX =
  /(?:\s*\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by [\d.]+ to map to original image\.\])+\s*$/

/** Strip Pi's generated image metadata suffix from user message text. */
export function stripImageMetadataSuffix(text: string, hasImages: boolean): string {
  return hasImages ? text.replace(IMAGE_METADATA_SUFFIX, '') : text
}

export function validateAgentImages(value: unknown): string | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) return 'images must be an array'
  if (value.length > MAX_ATTACHED_IMAGES) {
    return `A message can include at most ${MAX_ATTACHED_IMAGES} images`
  }
  for (const image of value) {
    if (!image || typeof image !== 'object' || (image as { type?: unknown }).type !== 'image') {
      return 'Each attachment must be an image'
    }
    if (!isBase64ImageWithinLimits(image)) {
      return `Each image must be valid base64 image data of ${MAX_ATTACHED_IMAGE_BYTES / 1024 / 1024}MB or smaller`
    }
  }
  return null
}
