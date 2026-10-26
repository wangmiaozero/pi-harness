import { describe, expect, it } from 'vitest'
import { promptAgentSchema } from '../schemas/workspace'
import {
  getBase64DecodedByteLength,
  isBase64ImageWithinLimits,
  MAX_ATTACHED_IMAGES,
  stripImageMetadataSuffix,
  validateAgentImages
} from './image-attachments'

describe('stripImageMetadataSuffix', () => {
  const suffix =
    '\n\n[Image: original 3354x2168, displayed at 2000x1293. Multiply coordinates by 1.68 to map to original image.]'

  it('strips the Pi-generated metadata suffix for image messages', () => {
    expect(stripImageMetadataSuffix(`看看这个${suffix}`, true)).toBe('看看这个')
    expect(stripImageMetadataSuffix(`a${suffix}${suffix}`, true)).toBe('a')
  })

  it('keeps user-authored text when the message has no images', () => {
    expect(stripImageMetadataSuffix(`看看这个${suffix}`, false)).toBe(`看看这个${suffix}`)
    expect(stripImageMetadataSuffix('普通消息', true)).toBe('普通消息')
  })
})

describe('image attachments', () => {
  it('calculates decoded base64 byte lengths and rejects malformed data', () => {
    expect(getBase64DecodedByteLength('TQ==')).toBe(1)
    expect(getBase64DecodedByteLength('TWE=')).toBe(2)
    expect(getBase64DecodedByteLength('TWFu')).toBe(3)
    expect(getBase64DecodedByteLength('not base64')).toBeNull()
  })

  it('accepts image-only prompts with valid base64 data', () => {
    const image = { type: 'image' as const, data: 'TQ==', mimeType: 'image/png' }
    expect(isBase64ImageWithinLimits(image)).toBe(true)
    expect(
      promptAgentSchema.safeParse({ sessionId: 'session-1', message: '', images: [image] }).success
    ).toBe(true)
  })

  it('rejects empty prompts, non-image MIME types, and excessive attachment counts', () => {
    expect(promptAgentSchema.safeParse({ sessionId: 'session-1', message: '' }).success).toBe(false)
    expect(
      promptAgentSchema.safeParse({
        sessionId: 'session-1',
        message: '',
        images: [{ type: 'image', data: 'TQ==', mimeType: 'text/plain' }]
      }).success
    ).toBe(false)
    expect(
      promptAgentSchema.safeParse({
        sessionId: 'session-1',
        message: '',
        images: Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => ({
          type: 'image',
          data: 'TQ==',
          mimeType: 'image/png'
        }))
      }).success
    ).toBe(false)
    expect(validateAgentImages([{ type: 'file', data: 'TQ==', mimeType: 'image/png' }])).toBe(
      'Each attachment must be an image'
    )
  })
})
