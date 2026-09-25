import { describe, expect, it } from 'vitest'
import { isImageGenerationModel } from './image-model'

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
})
