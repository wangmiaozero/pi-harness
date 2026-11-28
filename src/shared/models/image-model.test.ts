import { describe, expect, it } from 'vitest'
import { isImageGenerationModel, isImageStudioModel } from './image-model'

describe('isImageGenerationModel', () => {
  it('recognizes explicit image capability and common dedicated image model ids', () => {
    expect(
      isImageGenerationModel({ modelId: 'custom-renderer', capabilities: { image: true } })
    ).toBe(true)
    expect(isImageGenerationModel({ modelId: 'step-image-edit-2', capabilities: {} })).toBe(true)
    expect(isImageGenerationModel({ modelId: 'gpt-4o', capabilities: { vision: true } })).toBe(
      false
    )
  })

  it('keeps chat models that can also render an image available to the chat composer', () => {
    expect(
      isImageGenerationModel({ modelId: 'step-3.7-flash', capabilities: { vision: true } })
    ).toBe(false)
    expect(isImageGenerationModel({ modelId: 'step-5-preview', capabilities: {} })).toBe(false)
  })
})

describe('isImageStudioModel', () => {
  it('lists every configured model that can generate an image', () => {
    expect(isImageStudioModel({ modelId: 'step-3.7-flash', capabilities: { vision: true } })).toBe(
      true
    )
    expect(isImageStudioModel({ modelId: 'step-5-preview', capabilities: {} })).toBe(true)
    expect(isImageStudioModel({ modelId: 'gpt-image-2', capabilities: {} })).toBe(true)
    expect(isImageStudioModel({ modelId: 'seedream-5.0-pro', capabilities: {} })).toBe(true)
    expect(isImageStudioModel({ modelId: 'gpt-6.1-sol', capabilities: {} })).toBe(true)
    expect(isImageStudioModel({ modelId: 'gpt-5.4-2026-03-05', capabilities: {} })).toBe(true)
    expect(isImageGenerationModel({ modelId: 'gpt-6.1-sol', capabilities: {} })).toBe(false)
    expect(isImageStudioModel({ modelId: 'step-3.5-flash', capabilities: {} })).toBe(false)
    expect(isImageStudioModel({ modelId: 'step-router-v1', capabilities: {} })).toBe(false)
    expect(isImageStudioModel({ modelId: 'stepaudio-2.5-chat', capabilities: {} })).toBe(false)
    expect(isImageStudioModel({ modelId: 'gpt-5.4-nano', capabilities: {} })).toBe(false)
    expect(isImageStudioModel({ modelId: 'gpt-4o', capabilities: { vision: true } })).toBe(false)
  })
})
