import type { ModelDefinition } from '../types/domain'

/** Dedicated Images API models must not be sent through Pi's chat agent loop. */
export function isImageGenerationModel(
  model: Pick<ModelDefinition, 'modelId' | 'capabilities'> | null | undefined
): boolean {
  if (!model) return false
  return (
    model.capabilities.image === true ||
    /image|dall|flux|sdxl|imagen|midjourney/i.test(model.modelId)
  )
}
