import type { ModelDefinition } from '../types/domain'

export const DEFAULT_COMPATIBLE_IMAGE_SIZE = '1024x1024'
export const IMAGE_MODEL_SIZES = [
  DEFAULT_COMPATIBLE_IMAGE_SIZE,
  '1536x1024',
  '1024x1536',
  '1360x768',
  '768x1360',
  '1184x896',
  '896x1184'
] as const

export type ImageModelSize = (typeof IMAGE_MODEL_SIZES)[number]
export const IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high'] as const
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]

export function isGptImageModel(modelId: string): boolean {
  return /^(gpt-image-[\w.-]+|chatgpt-image-latest)$/i.test(modelId)
}

/**
 * Chat models the image page can render as an image. They stay selectable as chat models.
 * Order is the fallback order when a dedicated image endpoint is unavailable.
 */
export const CHAT_IMAGE_MODEL_IDS = ['step-5-preview', 'step-3.7-flash'] as const

/**
 * Mainline models documented to call the image generation tool.
 * Dated snapshots of the same model are included. Subscription sharing cannot use the tool.
 */
export const IMAGE_TOOL_MODEL_IDS = [
  'chat-latest',
  'gpt-5.2',
  'gpt-5.2-pro',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-pro',
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.6-cyber',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-6-astra',
  'gpt-6-cyber',
  'gpt-6-luna',
  'gpt-6-sol',
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6.2-astra',
  'gpt-6.2-sol'
] as const

const DEDICATED_IMAGE_MODEL_ID =
  /image|dall|flux|sdxl|midjourney|seedream|cogview|ideogram|recraft|kolors|stable-diffusion|step-1x|step-2x/i

export function isChatImageModel(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return CHAT_IMAGE_MODEL_IDS.some((candidate) => candidate === id)
}

export function isImageToolModel(modelId: string): boolean {
  const id = modelId.toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, '')
  return IMAGE_TOOL_MODEL_IDS.some((candidate) => candidate === id)
}

/** Dedicated Images API models must not be sent through Pi's chat agent loop. */
export function isImageGenerationModel(
  model: Pick<ModelDefinition, 'modelId' | 'capabilities'> | null | undefined
): boolean {
  if (!model) return false
  return model.capabilities.image === true || DEDICATED_IMAGE_MODEL_ID.test(model.modelId)
}

/** Models offered on the image page. Chat models that can also generate stay available in chat. */
export function isImageStudioModel(
  model: Pick<ModelDefinition, 'modelId' | 'capabilities'> | null | undefined
): boolean {
  if (!model) return false
  return (
    isImageGenerationModel(model) ||
    isChatImageModel(model.modelId) ||
    isImageToolModel(model.modelId)
  )
}
