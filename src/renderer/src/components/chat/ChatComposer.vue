<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import ComposerModelPicker from './ComposerModelPicker.vue'
import ComposerOptionMenu from './ComposerOptionMenu.vue'
import {
  clampThinkingLevel,
  composerThinkingLevels,
  resolveAvailableThinkingLevels
} from './thinking-levels'
import { shouldSendComposerKey } from './composer-keys'
import { useWorkspaceStore, type ChatDraftImage } from '@renderer/stores/workspace'
import { useAgentStore } from '@renderer/stores/agent'
import { useSessionStore } from '@renderer/stores/sessions'
import { useModelsStore } from '@renderer/stores/models'
import { useProvidersStore } from '@renderer/stores/providers'
import { useSettingsStore } from '@renderer/stores/settings'
import type { ToolPreset } from '@shared/workspace/tool-presets'
import { useCompactionStore } from '@renderer/stores/compaction'
import {
  canRequestCompaction,
  compactionUsageHint,
  compactionUsageRatio
} from '@shared/workspace/compaction'
import {
  isBase64ImageWithinLimits,
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES
} from '@shared/workspace/image-attachments'
import { ImagePlus, Minimize2, Send, Volume2, VolumeX, Wrench, X } from '@lucide/vue'

defineProps<{ soundEnabled: boolean }>()
const emit = defineEmits<{ send: []; abort: []; toggleSound: []; unlockAudio: [] }>()
const { t } = useI18n()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const sessions = useSessionStore()
const models = useModelsStore()
const providers = useProvidersStore()
const settings = useSettingsStore()
const compaction = useCompactionStore()
const fileInput = ref<HTMLInputElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)
const textareaFocused = ref(false)
const previewImage = ref<ChatDraftImage | null>(null)
const previewOpen = ref(false)
const dragActive = ref(false)
const pendingImageCount = ref(0)
const modelSwitching = ref(false)
let dragDepth = 0

const busy = computed(
  () => agent.sending || agent.streaming.isStreaming || agent.state?.isPromptRunning === true
)
const compactAvailable = computed(() => canRequestCompaction(sessions.currentId))
const compactPhase = computed(() => compaction.buttonPhase(sessions.currentId, 'workspace'))
const compactLabel = computed(() => {
  if (compactPhase.value === 'queued') return t('workspace.compactQueuedLabel')
  if (compactPhase.value === 'compacting') return t('workspace.compacting')
  if (compactPhase.value === 'working') return t('workspace.compactAfterTask')
  return t('workspace.compact')
})
const compactTitle = computed(() => {
  const hintKey = {
    unknown: 'workspace.compactUsageUnknown',
    low: 'workspace.compactUsageLow',
    ready: 'workspace.compactUsageReady',
    recommend: 'workspace.compactUsageRecommend',
    urgent: 'workspace.compactUsageUrgent'
  }[compactionUsageHint(compactionUsageRatio(agent.state?.contextUsage))]
  return `${t(hintKey)} · ${compactLabel.value}`
})

function onTextareaFocus() {
  textareaFocused.value = true
}

function onTextareaBlur() {
  textareaFocused.value = false
}

function focus() {
  textarea.value?.focus({ preventScroll: true })
}

defineExpose({ focus })

const modelOptions = computed(() =>
  models.items
    .filter((m) => m.enabled)
    .map((m) => {
      const provider = providers.items.find((p) => p.id === m.providerId)
      const key = provider?.key ?? m.providerId
      return {
        value: `${key}/${m.modelId}`,
        label: m.displayName || m.modelId,
        group: provider?.displayName || key
      }
    })
)

const modelValue = computed({
  get: () =>
    agent.state?.model
      ? `${agent.state.model.provider}/${agent.state.model.id}`
      : `${models.active.providerKey}/${models.active.modelId}`,
  set: async (value: string) => {
    const [provider, ...rest] = value.split('/')
    const modelId = rest.join('/')
    if (!provider || !modelId) return
    modelSwitching.value = true
    try {
      if (sessions.currentId) await agent.setModel(sessions.currentId, provider, modelId)
      else await models.setActive(provider, modelId)
    } catch (cause) {
      const message =
        cause && typeof cause === 'object' && 'message' in cause
          ? String(cause.message)
          : String(cause)
      toast.error(t('workspace.modelSwitchFailed'), { description: message })
    } finally {
      modelSwitching.value = false
    }
  }
})

const selectedModel = computed(() =>
  models.items.find((model) => {
    const provider = providers.items.find((item) => item.id === model.providerId)
    const providerKey = provider?.key ?? model.providerId
    return `${providerKey}/${model.modelId}` === modelValue.value
  })
)
const supportsImages = computed(() => selectedModel.value?.vision === true)
const hasUnsupportedImages = computed(
  () => workspace.draftImages.length > 0 && !supportsImages.value
)
const canSend = computed(
  () =>
    Boolean(workspace.draft.trim() || workspace.draftImages.length) && !hasUnsupportedImages.value
)

function warnImageUnsupported() {
  toast.warning(t('workspace.imageUnsupported'))
}

const thinkingStops = computed(() =>
  composerThinkingLevels(resolveAvailableThinkingLevels(selectedModel.value?.thinkingLevels))
)

const thinkingValue = computed({
  get: () => clampThinkingLevel(agent.thinkingLevel, thinkingStops.value),
  set: async (value: string) => {
    const level = clampThinkingLevel(value, thinkingStops.value)
    if (level === agent.thinkingLevel) return
    try {
      if (sessions.currentId) await agent.setThinking(sessions.currentId, level)
      else {
        agent.thinkingLevel = level
        agent.rememberComposerSelection(null)
      }
    } catch (cause) {
      const message =
        cause && typeof cause === 'object' && 'message' in cause
          ? String(cause.message)
          : String(cause)
      toast.error(t('workspace.changeThinking'), { description: message })
    }
  }
})

watch(thinkingStops, (levels) => {
  const next = clampThinkingLevel(agent.thinkingLevel, levels)
  if (next !== agent.thinkingLevel) thinkingValue.value = next
})

const toolOptions = computed(() => [
  { value: 'none', label: 'off', description: t('workspace.toolsNone') },
  { value: 'read-only', label: 'read-only', description: t('workspace.toolsReadOnly') },
  { value: 'default', label: 'default', description: t('workspace.toolsDefault') },
  { value: 'full', label: 'full', description: t('workspace.toolsFull') }
])

const toolPreset = computed({
  get: () => (sessions.currentId ? agent.activePreset() : agent.toolPreset),
  set: async (value: string) => {
    const preset = value as ToolPreset
    if (sessions.currentId) await agent.setTools(sessions.currentId, preset)
    else {
      agent.toolPreset = preset
      agent.rememberComposerSelection(null)
      await settings.patch({ defaultToolPreset: preset })
    }
  }
})

function onKeydown(e: KeyboardEvent) {
  if (shouldSendComposerKey(e)) {
    e.preventDefault()
    if (hasUnsupportedImages.value) warnImageUnsupported()
    else if (canSend.value) emit('send')
  }
  if (e.key === 'Escape' && busy.value) {
    e.preventDefault()
    emit('abort')
  }
}

function previewSource(image: ChatDraftImage): string {
  return `data:${image.mimeType};base64,${image.data}`
}

function openPreview(image: ChatDraftImage) {
  previewImage.value = image
  previewOpen.value = true
}

function readImage(file: File): Promise<ChatDraftImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const separator = result.indexOf(',')
      const data = separator >= 0 ? result.slice(separator + 1) : ''
      const attachment = { data, mimeType: file.type }
      if (!isBase64ImageWithinLimits(attachment)) {
        reject(new Error('invalid-image'))
        return
      }
      resolve({
        id: crypto.randomUUID(),
        name: file.name || t('workspace.pastedImage'),
        size: file.size,
        type: 'image',
        ...attachment
      })
    }
    reader.onerror = () => reject(reader.error ?? new Error('image-read-failed'))
    reader.readAsDataURL(file)
  })
}

async function processImageFiles(files: File[]) {
  if (!supportsImages.value) {
    warnImageUnsupported()
    return
  }
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  if (!imageFiles.length) {
    if (files.length) toast.warning(t('workspace.imageOnly'))
    return
  }

  const withinSize = imageFiles.filter((file) => file.size <= MAX_ATTACHED_IMAGE_BYTES)
  if (withinSize.length < imageFiles.length) {
    toast.warning(t('workspace.imageTooLarge', { size: MAX_ATTACHED_IMAGE_BYTES / 1024 / 1024 }))
  }
  const remaining = Math.max(
    0,
    MAX_ATTACHED_IMAGES - workspace.draftImages.length - pendingImageCount.value
  )
  if (remaining === 0) {
    toast.warning(t('workspace.imageLimit', { count: MAX_ATTACHED_IMAGES }))
    return
  }
  const accepted = withinSize.slice(0, remaining)
  if (accepted.length < withinSize.length) {
    toast.warning(t('workspace.imageLimit', { count: MAX_ATTACHED_IMAGES }))
  }
  if (!accepted.length) return

  pendingImageCount.value += accepted.length
  try {
    const results = await Promise.allSettled(accepted.map(readImage))
    const images = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    )
    if (images.length) workspace.addDraftImages(images)
    if (images.length < results.length) toast.error(t('workspace.imageReadFailed'))
  } finally {
    pendingImageCount.value -= accepted.length
  }
}

function chooseImages() {
  emit('unlockAudio')
  if (!supportsImages.value) {
    warnImageUnsupported()
    return
  }
  fileInput.value?.click()
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  void processImageFiles(Array.from(input.files ?? []))
  input.value = ''
}

function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  if (!files.length) return
  event.preventDefault()
  void processImageFiles(files)
}

function draggedFiles(event: DragEvent): File[] {
  return Array.from(event.dataTransfer?.files ?? [])
}

function onDragEnter(event: DragEvent) {
  if (!Array.from(event.dataTransfer?.items ?? []).some((item) => item.type.startsWith('image/')))
    return
  event.preventDefault()
  dragDepth += 1
  dragActive.value = true
}

function onDragOver(event: DragEvent) {
  if (!Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file')) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragActive.value = false
}

function onDrop(event: DragEvent) {
  const files = draggedFiles(event)
  dragDepth = 0
  dragActive.value = false
  if (!files.length) return
  event.preventDefault()
  void processImageFiles(files)
}

function onSoundToggle() {
  emit('unlockAudio')
  emit('toggleSound')
}

async function onCompact() {
  if (!compactAvailable.value) return
  await compaction.requestSmartCompaction({
    sessionId: sessions.currentId,
    source: 'workspace'
  })
}
</script>

<template>
  <div
    data-testid="chat-composer"
    class="command-console relative border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 transition-colors"
    :class="dragActive ? 'bg-[var(--accent-tint)] shadow-[inset_0_0_0_1px_var(--accent)]' : ''"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div
      class="cockpit-only command-console-label mb-1 font-[family-name:var(--font-mono)] text-[8px] font-semibold tracking-[0.2em] text-[var(--accent)]"
    >
      COMMAND CONSOLE
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onFileChange"
    />
    <div v-if="workspace.draftImages.length" class="mb-2 flex flex-wrap gap-2">
      <div
        v-for="image in workspace.draftImages"
        :key="image.id"
        class="group relative size-14 shrink-0"
      >
        <button
          type="button"
          class="block size-14 overflow-hidden rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :title="$t('workspace.previewImage')"
          @click="openPreview(image)"
        >
          <img :src="previewSource(image)" :alt="image.name" class="size-full object-cover" />
        </button>
        <button
          type="button"
          class="absolute -right-1 -top-1 inline-flex size-4 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface-raised)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)] hover:text-[var(--danger)]"
          :title="$t('workspace.removeImage')"
          :aria-label="$t('workspace.removeImage')"
          @click="workspace.removeDraftImage(image.id)"
        >
          <X aria-hidden="true" class="size-2.5" :stroke-width="2" />
        </button>
      </div>
    </div>
    <p v-if="hasUnsupportedImages" class="mb-2 text-[11px] text-[var(--danger)]">
      {{ $t('workspace.imageUnsupported') }}
    </p>
    <div
      class="command-console-input relative overflow-hidden rounded-[var(--radius-sm)] border bg-[var(--control-bg)] shadow-[var(--control-shadow)] transition-[background-color,border-color] duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--control-bg-hover)]"
      :class="
        textareaFocused
          ? 'border-[var(--accent-border)] bg-[var(--control-bg-hover)]'
          : 'border-[var(--control-border)]'
      "
      :aria-busy="busy"
    >
      <textarea
        ref="textarea"
        v-model="workspace.draft"
        rows="3"
        :placeholder="$t('workspace.composerPlaceholder')"
        class="relative z-10 block w-full resize-none bg-transparent px-2.5 py-2 text-[12.5px] text-[var(--text-primary)] outline-none"
        @focus="onTextareaFocus"
        @blur="onTextareaBlur"
        @keydown="onKeydown"
        @paste="onPaste"
      />
    </div>
    <div class="command-console-controls mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      <button
        type="button"
        class="cockpit-control-button inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        :class="workspace.draftImages.length ? 'text-[var(--accent)]' : ''"
        :disabled="!supportsImages"
        :title="supportsImages ? $t('workspace.attachImage') : $t('workspace.imageUnsupported')"
        :aria-label="$t('workspace.attachImage')"
        @click="chooseImages"
      >
        <ImagePlus aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
      </button>
      <ComposerModelPicker
        v-model:model="modelValue"
        v-model:thinking="thinkingValue"
        :options="modelOptions"
        :thinking-levels="thinkingStops"
        :disabled="busy || modelSwitching"
        @interact="emit('unlockAudio')"
      />
      <div class="console-tool-strip ml-auto flex items-center gap-0.5">
        <ComposerOptionMenu
          v-model="toolPreset"
          :label="$t('workspace.changeTools')"
          :icon="Wrench"
          :options="toolOptions"
          :disabled="busy"
          :menu-width="300"
          @interact="emit('unlockAudio')"
        />
        <Button
          v-if="compactAvailable"
          data-testid="composer-compact"
          variant="ghost"
          size="sm"
          :title="compactTitle"
          @click="onCompact"
        >
          <Minimize2 aria-hidden="true" class="size-3.5" />
          {{ compactLabel }}
        </Button>
        <button
          type="button"
          class="cockpit-control-button inline-flex size-8 items-center justify-center rounded-[8px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          :title="soundEnabled ? $t('workspace.disableSound') : $t('workspace.enableSound')"
          :aria-label="soundEnabled ? $t('workspace.disableSound') : $t('workspace.enableSound')"
          :aria-pressed="soundEnabled"
          @click="onSoundToggle"
        >
          <Volume2 v-if="soundEnabled" aria-hidden="true" class="size-3.5" />
          <VolumeX v-else aria-hidden="true" class="size-3.5 opacity-60" />
        </button>
        <Button v-if="busy" variant="danger" size="sm" @click="emit('abort')">
          {{ $t('workspace.abort') }}
        </Button>
        <Button
          class="command-execute-button"
          variant="primary"
          size="sm"
          :disabled="!canSend"
          :loading="agent.sending"
          @click="emit('send')"
        >
          <Send aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
          {{ $t('workspace.send') }}
        </Button>
      </div>
    </div>
    <p class="command-console-hint mt-1 text-[10.5px] text-[var(--text-tertiary)]">
      {{ $t('workspace.sendHint') }}
    </p>
    <div
      v-if="dragActive"
      class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-[var(--accent)] bg-[var(--bg-surface-raised)]/90 text-[12px] font-medium text-[var(--accent)]"
    >
      <ImagePlus aria-hidden="true" class="mr-2 size-4" />
      {{ $t('workspace.dropImages') }}
    </div>

    <Dialog v-model:open="previewOpen" wide :title="$t('workspace.previewImage')">
      <img
        v-if="previewImage"
        :src="previewSource(previewImage)"
        :alt="previewImage.name"
        class="max-h-[68vh] w-full object-contain"
      />
    </Dialog>
  </div>
</template>
