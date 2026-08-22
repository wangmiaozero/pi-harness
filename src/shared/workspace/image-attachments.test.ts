import { describe, expect, it } from 'vitest'
import { promptAgentSchema } from '../schemas/workspace'
import {
  getBase64DecodedByteLength,
  isBase64ImageWithinLimits,
  MAX_ATTACHED_IMAGES,
  validateAgentImages
} from './image-attachments'

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
