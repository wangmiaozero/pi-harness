import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { ImageModelRequest } from '@shared/ipc/api-types'
import { callApi, getApi, getErrorMessage } from '@renderer/composables/useApi'
import { rasterizeSvgImageResult } from '@renderer/utils/svg-rasterize'
import { readImageLibrary, removeStudioImage, writeStudioImage, type StudioImage } from './library'

function isImageCancelled(failure: unknown): boolean {
  if (!failure || typeof failure !== 'object') return false
  const record = failure as { details?: unknown; context?: unknown }
  return [record.details, record.context].some(
    (value) =>
      !!value && typeof value === 'object' && (value as { cancelled?: boolean }).cancelled === true
  )
}

export const useImageStudio = defineStore('image-studio', () => {
  const images = shallowRef<StudioImage[]>([])
  const prompt = ref('')
  const model = ref('')
  const quality = ref<NonNullable<ImageModelRequest['quality']>>('auto')
  const source = shallowRef<ImageModelRequest['sourceImage']>()
  const section = ref<'featured' | 'templates' | 'library'>('featured')
  const running = ref(false)
  const loadingLibrary = ref(false)
  const libraryError = ref(false)
  const error = ref('')
  let load: Promise<void> | undefined
  let activeRequestId: string | null = null

  function loadLibrary(): Promise<void> {
    if (load) return load
    loadingLibrary.value = true
    libraryError.value = false
    load = readImageLibrary()
      .then((saved) => {
        images.value = saved.sort((a, b) => b.createdAt - a.createdAt)
      })
      .catch(() => {
        libraryError.value = true
        load = undefined
      })
      .finally(() => {
        loadingLibrary.value = false
      })
    return load
  }

  async function run(input: ImageModelRequest): Promise<void> {
    if (running.value) return
    const requestId = crypto.randomUUID()
    activeRequestId = requestId
    running.value = true
    error.value = ''
    section.value = 'library'
    try {
      await loadLibrary()
      const output = await callApi(() => getApi().models.invokeImage({ ...input, requestId }))
      if (activeRequestId !== requestId) return
      const result = await rasterizeSvgImageResult(output, input.size)
      const work: StudioImage = {
        id: crypto.randomUUID(),
        prompt: input.prompt,
        modelId: input.modelId,
        createdAt: Date.now(),
        image: new Blob(
          [Uint8Array.from(atob(result.base64), (character) => character.charCodeAt(0))],
          { type: result.mimeType }
        ),
        fallbackModelId: result.fallbackModelId
      }
      try {
        await writeStudioImage(work)
      } catch {
        libraryError.value = true
      }
      images.value = [work, ...images.value]
    } catch (failure) {
      if (activeRequestId === requestId && !isImageCancelled(failure)) {
        error.value = getErrorMessage(failure)
      }
    } finally {
      if (activeRequestId === requestId) {
        activeRequestId = null
        running.value = false
      }
    }
  }

  async function stop(): Promise<void> {
    const requestId = activeRequestId
    if (!requestId) return
    activeRequestId = null
    running.value = false
    error.value = ''
    await callApi(() => getApi().models.cancelImage(requestId)).catch(() => undefined)
  }

  async function remove(id: string): Promise<void> {
    try {
      await removeStudioImage(id)
      images.value = images.value.filter((work) => work.id !== id)
    } catch {
      libraryError.value = true
    }
  }

  return {
    images,
    prompt,
    model,
    quality,
    source,
    section,
    running,
    error,
    stop,
    loadingLibrary,
    libraryError,
    loadLibrary,
    run,
    remove
  }
})
