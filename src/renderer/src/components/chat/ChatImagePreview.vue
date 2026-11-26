<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Copy, Download, ZoomIn, ZoomOut } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import Dialog from '@renderer/components/ui/Dialog.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import { callApi, getApi } from '@renderer/composables/useApi'

const props = defineProps<{ src: string }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const MIN_ZOOM = 50
const MAX_ZOOM = 400
const ZOOM_STEP = 25
const zoom = ref(100)
const viewport = ref<HTMLElement | null>(null)
const image = ref<HTMLImageElement | null>(null)
const frameSize = ref({ width: 0, height: 0 })
const naturalSize = ref({ width: 0, height: 0 })
const copying = ref(false)

const mimeType = computed(() => {
  const separator = props.src.indexOf(',')
  return props.src.slice(0, separator).match(/^data:(image\/[a-z0-9.+-]+);base64$/i)?.[1]
})
const loaded = computed(() => naturalSize.value.width > 0 && naturalSize.value.height > 0)
const imageStyle = computed(() => {
  if (!loaded.value) return undefined
  const { width, height } = naturalSize.value
  const frame = frameSize.value
  const fit =
    frame.width && frame.height ? Math.min(1, frame.width / width, frame.height / height) : 1
  const scale = (fit * zoom.value) / 100
  return { width: width * scale + 'px', height: height * scale + 'px' }
})

function recordImageSize(): void {
  const element = image.value
  naturalSize.value = { width: element?.naturalWidth ?? 0, height: element?.naturalHeight ?? 0 }
}

watch(viewport, (element, _, onCleanup) => {
  if (!element) return
  const measure = () => {
    frameSize.value = { width: element.clientWidth, height: element.clientHeight }
  }
  measure()
  const observer = new ResizeObserver(measure)
  observer.observe(element)
  onCleanup(() => observer.disconnect())
})

watch([open, () => props.src], () => {
  zoom.value = 100
  naturalSize.value = { width: 0, height: 0 }
})

async function changeZoom(direction: -1 | 1): Promise<void> {
  const scroller = viewport.value
  if (!scroller) return
  const x = (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth
  const y = (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value + direction * ZOOM_STEP))
  await nextTick()
  scroller.scrollLeft = x * scroller.scrollWidth - scroller.clientWidth / 2
  scroller.scrollTop = y * scroller.scrollHeight - scroller.clientHeight / 2
}

async function copyImage(): Promise<void> {
  const element = image.value
  let type = mimeType.value
  if (!element || !type || !loaded.value || copying.value) return
  copying.value = true
  try {
    let dataUrl = props.src
    if (type !== 'image/png' && type !== 'image/jpeg') {
      const canvas = document.createElement('canvas')
      canvas.width = element.naturalWidth
      canvas.height = element.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image conversion unavailable')
      context.drawImage(element, 0, 0)
      type = 'image/png'
      dataUrl = canvas.toDataURL(type)
    }
    const payload = {
      type: 'image' as const,
      mimeType: type,
      data: dataUrl.slice(dataUrl.indexOf(',') + 1)
    }
    await callApi(() => getApi().system.copyImage(payload))
    toast.success(t('diagnostics.copied'))
  } catch {
    toast.error(t('diagnostics.copyFailed'))
  } finally {
    copying.value = false
  }
}

function downloadImage(): void {
  const subtype = mimeType.value?.split('/')[1]
  if (!subtype) return
  const extensions: Readonly<Record<string, string>> = {
    jpeg: 'jpg',
    'svg+xml': 'svg',
    'x-icon': 'ico',
    'vnd.microsoft.icon': 'ico'
  }
  const link = document.createElement('a')
  link.href = props.src
  link.download = 'chat-image.' + (extensions[subtype] ?? subtype)
  link.click()
}
</script>

<template>
  <Dialog
    v-model:open="open"
    sheet
    close-on-escape
    :title="t('workspace.previewImage')"
    body-class="overflow-hidden"
  >
    <template #toolbar>
      <div class="flex items-center gap-0.5" :aria-label="t('workspace.previewImage')" role="group">
        <IconButton
          :label="t('workspace.imageZoomOut')"
          :disabled="!loaded || zoom <= MIN_ZOOM"
          data-testid="chat-image-zoom-out"
          @click="changeZoom(-1)"
        >
          <ZoomOut class="size-4" />
        </IconButton>
        <span
          data-testid="chat-image-zoom"
          class="min-w-9 text-center text-xs tabular-nums text-[var(--text-secondary)]"
        >
          {{ zoom }}%
        </span>
        <IconButton
          :label="t('workspace.imageZoomIn')"
          :disabled="!loaded || zoom >= MAX_ZOOM"
          data-testid="chat-image-zoom-in"
          @click="changeZoom(1)"
        >
          <ZoomIn class="size-4" />
        </IconButton>
        <span aria-hidden="true" class="mx-1 h-4 w-px bg-[var(--border-default)]" />
        <IconButton
          :label="t('workspace.imageCopy')"
          :disabled="!loaded || !mimeType || copying"
          data-testid="chat-image-copy"
          @click="copyImage"
        >
          <Copy class="size-4" />
        </IconButton>
        <IconButton
          :label="t('workspace.imageDownload')"
          :disabled="!loaded || !mimeType"
          data-testid="chat-image-download"
          @click="downloadImage"
        >
          <Download class="size-4" />
        </IconButton>
      </div>
    </template>

    <div
      ref="viewport"
      role="region"
      tabindex="0"
      :aria-label="t('workspace.previewImage')"
      class="h-[min(68vh,820px)] overflow-auto overscroll-contain rounded-[var(--radius-sm)] bg-[var(--bg-workspace)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      data-testid="chat-image-viewport"
    >
      <div class="flex h-max min-h-full w-max min-w-full items-center justify-center">
        <img
          ref="image"
          :src="src"
          :alt="t('workspace.previewImage')"
          :style="imageStyle"
          draggable="false"
          class="block max-w-none shrink-0 select-none"
          data-testid="chat-image-preview"
          @load="recordImageSize"
          @error="recordImageSize"
        />
      </div>
    </div>
  </Dialog>
</template>
