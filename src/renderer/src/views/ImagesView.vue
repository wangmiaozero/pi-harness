<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowUp, ChevronDown, Image, Images, LoaderCircle, Plus, Square, X } from '@lucide/vue'
import { PopoverContent, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  IMAGE_QUALITIES,
  isGptImageModel,
  isImageGenerationModel,
  isImageStudioModel
} from '@shared/models/image-model'
import { isSelectableChatGptModel } from '@shared/providers/account-management'
import { useChatGptAccounts } from '@renderer/stores/chatgpt-accounts'
import { useModelsStore } from '@renderer/stores/models'
import { useProvidersStore } from '@renderer/stores/providers'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { useImageStudio } from '@renderer/features/image-studio/store'
import type { StudioImage } from '@renderer/features/image-studio/library'
import {
  imageDownloadName,
  readImageDataUrl,
  readReferenceImage,
  REFERENCE_MIME_TYPES
} from '@renderer/features/image-studio/image-files'
import StudioImageCard from '@renderer/features/image-studio/StudioImageCard.vue'
import ChatImagePreview from '@renderer/components/chat/ChatImagePreview.vue'
import ComposerModelPicker from '@renderer/components/chat/ComposerModelPicker.vue'
import Button from '@renderer/components/ui/Button.vue'
import Select from '@renderer/components/ui/Select.vue'
import Textarea from '@renderer/components/ui/Textarea.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const studio = useImageStudio()
const models = useModelsStore()
const providers = useProvidersStore()
const chatGpt = useChatGptAccounts()
const accountsReady = ref(false)

const input = ref<HTMLInputElement | null>(null)
const promptField = ref<HTMLElement | null>(null)
const templateClose = ref<HTMLButtonElement | null>(null)
const referenceLoading = ref(false)
const promptExpanded = ref(false)
const previewOpen = ref(false)
const previewSrc = ref('')
const previewName = ref('')
const templateIds = [
  'landscape',
  'product',
  'illustration',
  'sculpture',
  'portrait',
  'storybook',
  'food',
  'architecture'
] as const
const activeTemplate = ref<(typeof templateIds)[number] | null>(null)
const visibleTemplates = computed(() =>
  studio.section === 'featured'
    ? ([
        'landscape',
        'portrait',
        'product',
        'sculpture',
        'storybook',
        'illustration',
        'food',
        'architecture'
      ] as const)
    : templateIds
)
const modelOptions = computed(() => {
  const providerNameCounts = new Map<string, number>()
  for (const { displayName } of providers.items) {
    providerNameCounts.set(displayName, (providerNameCounts.get(displayName) ?? 0) + 1)
  }
  const byId = new Map(providers.items.map((provider) => [provider.id, provider]))
  const configured = models.items.flatMap((model) => {
    if (!isImageStudioModel(model)) return []
    const provider = byId.get(model.providerId)
    if (!provider) return []
    const name = provider.displayName || provider.key
    const group = (providerNameCounts.get(name) ?? 0) > 1 ? `${name} · ${provider.key}` : name
    return [
      {
        value: model.id,
        label: model.displayName || model.modelId,
        group,
        providerKey: provider.key,
        modelId: model.modelId
      }
    ]
  })
  const accounts = chatGpt.items.flatMap((account) => {
    if (account.routingOnly) return []
    const group = `ChatGPT · ${chatGpt.displayLabel(account)}`
    return account.models.flatMap((model) => {
      if (
        !isSelectableChatGptModel(model) ||
        !isImageGenerationModel({ modelId: model.id, capabilities: {} })
      )
        return []
      return [
        {
          value: `${account.id}/${model.id}`,
          label: model.name || model.id,
          group,
          providerKey: account.id,
          modelId: model.id
        }
      ]
    })
  })
  return [...configured, ...accounts]
})
const modelMenu = computed(() =>
  modelOptions.value.length
    ? modelOptions.value
    : [
        {
          value: '__no-image-models__',
          label: t('imageStudio.noModels'),
          group: t('imageStudio.noModels'),
          disabled: true
        }
      ]
)
const selectedModel = computed(() =>
  modelOptions.value.find((model) => model.value === studio.model)
)
const supportsQuality = computed(() => isGptImageModel(selectedModel.value?.modelId ?? ''))
const qualityLabel = computed(() =>
  t(`imageStudio.qualities.${supportsQuality.value ? studio.quality : 'auto'}`)
)
const qualityOptions = computed(() =>
  IMAGE_QUALITIES.map((value) => ({
    value,
    label: t(`imageStudio.qualities.${value}`)
  }))
)
const activeTemplatePrompt = computed(() =>
  activeTemplate.value ? t(`imageStudio.templatesData.${activeTemplate.value}.prompt`) : ''
)
const qualityIndex = computed(() => IMAGE_QUALITIES.indexOf(studio.quality))
const lastQualityIndex = IMAGE_QUALITIES.length - 1
const sourceUrl = computed(() =>
  studio.source ? `data:${studio.source.mimeType};base64,${studio.source.base64}` : ''
)
const pendingPrompt = ref('')
const pendingModel = ref('')
const readyToGenerate = computed(
  () =>
    !!selectedModel.value && !!studio.prompt.trim() && !studio.running && !referenceLoading.value
)

watch(
  [() => route.query.model, modelOptions],
  ([requested, options]) => {
    const preferred = options.find((option) => option.value === requested)
    if (preferred) {
      studio.model = preferred.value
      const query = { ...route.query }
      delete query.model
      void router.replace({ query })
    } else if (
      !options.some((option) => option.value === studio.model) &&
      !models.loading &&
      !providers.loading &&
      accountsReady.value
    ) {
      studio.model = ''
    }
  },
  { immediate: true }
)

onMounted(() => {
  void studio.loadLibrary()
  if (!models.items.length && !models.loading) void models.fetchList()
  if (!providers.items.length && !providers.loading) void providers.fetchList()
  void chatGpt
    .load()
    .catch(() => {})
    .finally(() => {
      accountsReady.value = true
    })
})

function openTemplate(id: (typeof templateIds)[number]) {
  activeTemplate.value = id
  promptExpanded.value = false
  void nextTick(() => templateClose.value?.focus())
}

async function applyTemplate() {
  if (!activeTemplate.value) return
  studio.prompt = t(`imageStudio.templatesData.${activeTemplate.value}.prompt`)
  activeTemplate.value = null
  await focusPrompt()
}

function setTemplateQuality(value: string) {
  if ((IMAGE_QUALITIES as readonly string[]).includes(value)) {
    studio.quality = value as (typeof IMAGE_QUALITIES)[number]
  }
}

async function focusPrompt() {
  await nextTick()
  promptField.value?.querySelector('textarea')?.focus()
}

async function addReference(blob: Blob, name: string) {
  if (referenceLoading.value) return
  referenceLoading.value = true
  try {
    studio.source = await readReferenceImage(blob, name)
  } catch (error) {
    const key = (error as Error)?.message
    toast.error(
      t(
        key === 'models.imageUnsupportedType' || key === 'models.imageTooLarge'
          ? key
          : 'common.failed'
      )
    )
  } finally {
    referenceLoading.value = false
  }
}

function upload(event: Event) {
  const element = event.target as HTMLInputElement
  const file = element.files?.[0]
  if (file) void addReference(file, file.name)
  element.value = ''
}

function paste(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.items ?? [])
    .find((item) => item.type.startsWith('image/'))
    ?.getAsFile()
  if (!file) return
  event.preventDefault()
  void addReference(file, file.name || 'reference.png')
}

async function preview(work: StudioImage) {
  try {
    previewSrc.value = await readImageDataUrl(work.image)
    previewName.value = imageDownloadName(work.modelId, work.createdAt, work.image.type)
    previewOpen.value = true
  } catch {
    toast.error(t('common.failed'))
  }
}

async function useAsReference(work: StudioImage) {
  await addReference(work.image, imageDownloadName(work.modelId, work.createdAt, work.image.type))
  await focusPrompt()
}

async function remove(work: StudioImage) {
  if (
    await askConfirm({ title: t('imageStudio.removeConfirm'), confirmLabel: t('common.delete') })
  ) {
    await studio.remove(work.id)
  }
}

function handlePromptKey(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  generate()
}

function setQuality(event: Event) {
  const index = (event.target as HTMLInputElement).valueAsNumber
  studio.quality = IMAGE_QUALITIES[index] ?? 'auto'
}

function generate() {
  const model = selectedModel.value
  if (!model || !readyToGenerate.value) return
  pendingPrompt.value = studio.prompt.trim()
  pendingModel.value = model.label
  void studio.run({
    providerKey: model.providerKey,
    modelId: model.modelId,
    prompt: studio.prompt.trim(),
    quality: supportsQuality.value ? studio.quality : undefined,
    sourceImage: studio.source
  })
}
</script>

<template>
  <div class="image-studio" data-testid="image-studio">
    <div class="image-studio__page">
      <header class="image-studio__header">
        <div class="image-studio__title">
          <Image class="size-5" aria-hidden="true" />
          <h1>{{ t('imageStudio.title') }}</h1>
        </div>
        <div class="image-studio__sections" :aria-label="t('imageStudio.title')">
          <button
            v-for="section in ['featured', 'templates', 'library'] as const"
            :key="section"
            type="button"
            :aria-pressed="studio.section === section"
            :data-testid="'image-studio-' + section"
            @click="studio.section = section"
          >
            {{ t(`imageStudio.${section}`) }}
          </button>
        </div>
      </header>

      <main class="image-studio__gallery">
        <div
          v-if="studio.section !== 'library'"
          class="image-studio__grid"
          :class="{ 'image-studio__grid--templates': studio.section === 'templates' }"
        >
          <button
            v-for="id in visibleTemplates"
            :key="id"
            :data-testid="'image-template-' + id"
            type="button"
            class="image-template"
            :aria-label="t(`imageStudio.templatesData.${id}.name`)"
            @click="openTemplate(id)"
          >
            <span
              class="image-template__art"
              :class="'image-template__art--' + id"
              aria-hidden="true"
            >
              <span class="image-template__caption">{{
                t(`imageStudio.templatesData.${id}.name`)
              }}</span>
            </span>
            <span v-if="studio.section === 'templates'" class="image-template__prompt">{{
              t(`imageStudio.templatesData.${id}.prompt`)
            }}</span>
          </button>
        </div>
        <template v-else>
          <p v-if="studio.libraryError" class="image-studio__error" role="alert">
            {{ t('imageStudio.libraryError') }}
          </p>
          <div v-if="studio.loadingLibrary" class="image-studio__progress" role="status">
            <LoaderCircle
              class="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {{ t('common.loading') }}
          </div>
          <div v-if="studio.running || studio.images.length" class="image-studio__grid">
            <article
              v-if="studio.running"
              class="image-pending"
              role="status"
              :aria-label="t('imageStudio.running')"
              data-testid="image-studio-pending"
            >
              <div class="image-pending__frame" aria-hidden="true">
                <LoaderCircle class="size-5 animate-spin motion-reduce:animate-none" />
                <span>{{ t('imageStudio.running') }}</span>
              </div>
              <p class="image-pending__prompt" :title="pendingPrompt || studio.prompt">
                {{ pendingPrompt || studio.prompt }}
              </p>
              <p class="image-pending__model">{{ pendingModel || selectedModel?.label }}</p>
            </article>
            <StudioImageCard
              v-for="work in studio.images"
              :key="work.id"
              :work="work"
              @preview="preview(work)"
              @reference="useAsReference(work)"
              @remove="remove(work)"
            />
          </div>
          <div v-else-if="!studio.running && !studio.loadingLibrary" class="image-studio__empty">
            <Images class="size-7" aria-hidden="true" />
            <p>{{ t('imageStudio.empty') }}</p>
          </div>
        </template>
      </main>

      <footer class="image-studio__dock">
        <form
          class="image-studio__composer"
          :aria-label="t('imageStudio.create')"
          @submit.prevent="generate"
          @paste="paste"
        >
          <p v-if="studio.error" class="image-studio__error" role="alert">{{ studio.error }}</p>
          <div v-if="studio.source" class="image-studio__reference">
            <img :src="sourceUrl" alt="" />
            <span :title="studio.source.fileName">{{ studio.source.fileName }}</span>
            <button
              type="button"
              :aria-label="t('models.imageRemove')"
              @click="studio.source = undefined"
            >
              <X class="size-4" />
            </button>
          </div>
          <div class="image-studio__actions">
            <input
              ref="input"
              type="file"
              :accept="REFERENCE_MIME_TYPES.join(',')"
              hidden
              data-testid="image-studio-reference"
              @change="upload"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              :loading="referenceLoading"
              :aria-label="t(studio.source ? 'models.imageReplace' : 'models.imageSelect')"
              :title="t(studio.source ? 'models.imageReplace' : 'models.imageSelect')"
              @click="input?.click()"
            >
              <Plus class="size-[18px]" />
            </Button>
            <div ref="promptField" class="image-studio__prompt">
              <Textarea
                v-model="studio.prompt"
                :aria-label="t('models.imagePrompt')"
                :placeholder="t('models.imagePromptPlaceholder')"
                :rows="1"
                :maxlength="8000"
                data-testid="image-studio-prompt"
                @keydown="handlePromptKey"
              />
            </div>
            <div class="image-studio__options">
              <ComposerModelPicker
                v-model:model="studio.model"
                :options="modelMenu"
                :show-thinking="false"
                :aria-label="t('imageStudio.model')"
                test-id="image-studio-model"
                class="image-studio__model"
              />
              <PopoverRoot>
                <PopoverTrigger as-child>
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="!supportsQuality"
                    :aria-label="t('imageStudio.quality')"
                    :title="t('imageStudio.quality')"
                    class="image-studio__quality"
                  >
                    {{ qualityLabel }}
                    <ChevronDown class="size-3" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  :side-offset="14"
                  style="z-index: 10"
                  :aria-label="t('imageStudio.quality')"
                >
                  <div class="image-studio__quality-panel">
                    <div class="image-studio__quality-title">
                      <span>{{ t('imageStudio.quality') }}</span>
                      <span>{{ qualityLabel }}</span>
                    </div>
                    <input
                      class="image-studio__quality-slider"
                      type="range"
                      min="0"
                      :max="lastQualityIndex"
                      :value="qualityIndex"
                      :aria-label="t('imageStudio.quality')"
                      :aria-valuetext="qualityLabel"
                      :style="{ '--quality-fill': `${(qualityIndex / lastQualityIndex) * 100}%` }"
                      @input="setQuality"
                    />
                  </div>
                </PopoverContent>
              </PopoverRoot>
            </div>
            <Button
              v-if="studio.running"
              type="button"
              variant="secondary"
              data-testid="image-studio-stop"
              :aria-label="t('imageStudio.stop')"
              :title="t('imageStudio.stop')"
              @click="studio.stop()"
            >
              <Square class="size-3.5 fill-current" />
            </Button>
            <Button
              type="submit"
              variant="primary"
              :loading="studio.running"
              :disabled="!readyToGenerate"
              :aria-label="t(studio.source ? 'models.imageEdit' : 'models.imageGenerate')"
              :title="t(studio.source ? 'models.imageEdit' : 'models.imageGenerate')"
              data-testid="image-studio-generate"
            >
              <ArrowUp class="size-4" />
            </Button>
          </div>
        </form>
      </footer>
    </div>
    <div v-if="activeTemplate" class="image-template-layer">
      <div class="image-template-layer__scrim" @click="activeTemplate = null" />
      <div
        role="dialog"
        aria-modal="true"
        data-testid="image-template-dialog"
        class="image-template-dialog"
        :aria-labelledby="'image-template-title'"
        @keydown.esc.stop="activeTemplate = null"
      >
        <div
          class="image-template__art image-template-dialog__preview"
          :class="'image-template__art--' + activeTemplate"
        />
        <div class="image-template-dialog__body">
          <div class="image-template-dialog__heading">
            <h2 id="image-template-title">
              {{ t(`imageStudio.templatesData.${activeTemplate}.name`) }}
            </h2>
            <button
              ref="templateClose"
              type="button"
              :aria-label="t('common.close')"
              @click="activeTemplate = null"
            >
              <X class="size-4" />
            </button>
          </div>
          <p class="image-template-dialog__copy" :class="{ 'is-clamped': !promptExpanded }">
            {{ activeTemplatePrompt }}
          </p>
          <button
            type="button"
            class="image-template-dialog__more"
            @click="promptExpanded = !promptExpanded"
          >
            {{ t(promptExpanded ? 'imageStudio.showLess' : 'imageStudio.showMore') }}
          </button>
          <div class="image-template-dialog__row">
            <span>{{ t('imageStudio.quality') }}</span>
            <Select
              :model-value="supportsQuality ? studio.quality : 'auto'"
              :options="qualityOptions"
              :disabled="!supportsQuality"
              :aria-label="t('imageStudio.quality')"
              size="sm"
              data-testid="image-template-quality"
              @update:model-value="setTemplateQuality"
            />
          </div>
          <p class="image-template-dialog__hint">{{ t('imageStudio.referenceHint') }}</p>
          <button
            type="button"
            class="image-template-dialog__photo"
            :aria-label="t(studio.source ? 'models.imageReplace' : 'models.imageSelect')"
            @click="input?.click()"
          >
            <img v-if="sourceUrl" :src="sourceUrl" alt="" />
            <Plus v-else class="size-5" />
          </button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="image-template-apply"
            @click="applyTemplate"
          >
            {{ t('imageStudio.useTemplate') }}
          </Button>
        </div>
      </div>
    </div>
    <ChatImagePreview
      v-model:open="previewOpen"
      :src="previewSrc"
      :download-name="previewName"
      @update:open="
        (open) => {
          if (!open) previewSrc = ''
        }
      "
    />
  </div>
</template>

<style scoped>
.image-studio {
  height: 100%;
  overflow: hidden;
  background: var(--bg-workspace);
  color: var(--text-primary);
}
.image-studio__page {
  display: grid;
  height: 100%;
  position: relative;
  grid-template-rows: auto minmax(0, 1fr);
}
.image-studio__header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 15px;
  width: min(100%, 1500px);
  margin: 0 auto;
  padding: 24px clamp(20px, 4vw, 52px) 15px;
}
.image-studio__title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.image-studio__title svg {
  color: var(--accent);
}
.image-studio__title h1 {
  margin: 0;
  font-size: 25px;
  font-weight: 650;
  letter-spacing: -0.025em;
}
.image-studio__sections {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.image-studio__sections button {
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-secondary);
}
.image-studio__sections button:hover {
  background: var(--bg-hover);
}
.image-studio__sections button[aria-pressed='true'] {
  background: var(--bg-surface);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: var(--control-shadow);
}
.image-studio__gallery {
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}
.image-studio__grid,
.image-studio__progress,
.image-studio__empty,
.image-studio__gallery > .image-studio__error {
  max-width: 1500px;
  margin: 0 auto;
  padding-inline: clamp(20px, 4vw, 52px);
}
.image-studio__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 205px), 1fr));
  gap: 14px;
  padding-bottom: 140px;
}
.image-studio__dock {
  position: absolute;
  z-index: 5;
  inset: auto 0 18px;
  padding-inline: clamp(16px, 5vw, 48px);
  pointer-events: none;
}
.image-studio__composer {
  display: grid;
  gap: 5px;
  max-width: 790px;
  margin: 0 auto;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--bg-surface-raised);
  box-shadow:
    0 8px 28px #19113926,
    var(--control-shadow);
  pointer-events: auto;
}
.image-studio__prompt {
  flex: 1;
  min-width: 0;
}
.image-studio__prompt :deep(textarea) {
  min-height: 32px;
  max-height: 118px;
  field-sizing: content;
  resize: none;
  border: 0;
  background: transparent;
  box-shadow: none;
  font-size: 14px;
}
.image-studio__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.image-studio__options {
  display: flex;
  align-items: center;
  gap: 5px;
}
.image-studio__model {
  min-width: 132px;
  max-width: 240px;
}
.image-studio__quality[data-state='open'] {
  background: var(--bg-hover);
}
.image-studio__quality-panel {
  display: grid;
  gap: 12px;
  width: 210px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface-raised);
  box-shadow: var(--shadow-popover);
}
.image-studio__quality-title {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
}
.image-studio__quality-title > :last-child {
  color: var(--text-primary);
}
.image-studio__quality-slider {
  width: 100%;
  height: 16px;
  margin: 0;
  appearance: none;
  border-radius: 8px;
  background: linear-gradient(
    to right,
    var(--accent-solid) var(--quality-fill),
    var(--bg-hover) var(--quality-fill)
  );
  cursor: pointer;
}
.image-studio__quality-slider::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  appearance: none;
  border: 1px solid var(--control-border);
  border-radius: 50%;
  background: var(--bg-surface-raised);
  box-shadow: var(--shadow-sm);
}
.image-studio__quality-slider:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.image-studio__reference {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
  max-width: min(100%, 180px);
  margin-left: 8px;
  font-size: 12px;
}
.image-studio__reference img {
  width: 29px;
  height: 29px;
  object-fit: cover;
  border-radius: 5px;
}
.image-studio__reference span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-studio__reference button {
  padding: 4px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.image-studio__reference button:hover {
  background: var(--bg-hover);
}
.image-studio__error {
  color: var(--error);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.image-studio__progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-block: 9px 15px;
  color: var(--text-secondary);
  font-size: 13px;
}
.image-pending {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
.image-pending__frame {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  aspect-ratio: 4 / 3;
  background:
    linear-gradient(100deg, transparent 20%, var(--bg-hover) 50%, transparent 80%),
    var(--bg-surface-raised);
  background-size:
    220% 100%,
    auto;
  color: var(--text-tertiary);
  font-size: 12px;
  animation: image-pending-sheen 1.6s ease-in-out infinite;
}
.image-pending__prompt {
  overflow: hidden;
  margin: 11px 12px 2px;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 550;
}
.image-pending__model {
  overflow: hidden;
  margin: 0 12px 12px;
  color: var(--text-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes image-pending-sheen {
  from {
    background-position:
      120% 0,
      0 0;
  }
  to {
    background-position:
      -120% 0,
      0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .image-pending__frame {
    animation: none;
  }
}
.image-studio__empty {
  display: grid;
  min-height: 243px;
  place-content: center;
  justify-items: center;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}
.image-template {
  overflow: hidden;
  text-align: left;
  border-radius: 12px;
  background: transparent;
}
.image-template:hover {
  filter: brightness(1.03);
}
.image-template__art {
  position: relative;
  display: block;
  aspect-ratio: 1.15;
  overflow: hidden;
  border-radius: 12px;
  background-size: 200% 200%;
  background-repeat: no-repeat;
  background-image: url('../assets/image-studio-templates.webp');
}
.image-template__art--landscape {
  background-position: left top;
  background-color: #25274b;
}
.image-template__art--product {
  background-position: right top;
  background-color: #c3c4ab;
}
.image-template__art--illustration {
  background-position: left bottom;
  background-color: #224456;
}
.image-template__art--sculpture {
  background-position: right bottom;
  background-color: #b193ae;
}
.image-template__art--portrait,
.image-template__art--storybook,
.image-template__art--food,
.image-template__art--architecture {
  background-image: url('../assets/image-studio-editorial.webp');
}
.image-template__art--portrait {
  background-position: left top;
  background-color: #233961;
}
.image-template__art--storybook {
  background-position: right top;
  background-color: #86adba;
}
.image-template__art--food {
  background-position: left bottom;
  background-color: #d9939e;
}
.image-template__art--architecture {
  background-position: right bottom;
  background-color: #c8b19a;
}
.image-template__caption {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 28px 10px 8px;
  color: #fff;
  background: linear-gradient(transparent, rgb(0 0 0 / 0.62));
  font-size: 13px;
  font-weight: 550;
}
.image-template-layer {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
}
.image-template-layer__scrim {
  position: absolute;
  inset: 0;
  background: rgb(20 20 24 / 0.18);
}
.image-template-dialog {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(240px, 0.85fr);
  width: min(760px, 100%);
  max-height: min(560px, calc(100% - 48px));
  overflow: hidden;
  border-radius: 16px;
  background: var(--bg-surface-raised);
  box-shadow:
    0 18px 60px rgb(20 16 40 / 0.28),
    var(--control-shadow);
}
.image-template-dialog__preview {
  height: 100%;
  min-height: 320px;
  border-radius: 0;
  aspect-ratio: auto;
}
.image-template-dialog__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  padding: 16px 16px 14px;
}
.image-template-dialog__heading {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.image-template-dialog__heading h2 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.image-template-dialog__heading button {
  display: grid;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 999px;
  color: var(--text-secondary);
}
.image-template-dialog__heading button:hover {
  background: var(--bg-hover);
}
.image-template-dialog__copy {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}
.image-template-dialog__copy.is-clamped {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.image-template-dialog__more {
  align-self: flex-start;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}
.image-template-dialog__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.image-template-dialog__row > :last-child {
  width: 112px;
}
.image-template-dialog__hint {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}
.image-template-dialog__photo {
  display: grid;
  width: 72px;
  height: 72px;
  place-items: center;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  color: var(--text-secondary);
  background: var(--bg-surface);
}
.image-template-dialog__photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}
.image-template-dialog__apply {
  align-self: flex-end;
  margin-top: auto;
}
.image-template__prompt {
  display: -webkit-box;
  overflow: hidden;
  min-height: calc(2em * 1.35);
  margin: 0 12px 10px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
@media (max-width: 640px) {
  .image-studio__actions {
    flex-wrap: wrap;
  }
  .image-studio__prompt {
    flex: 1 1 calc(100% - 45px);
  }
  .image-studio__options {
    flex: 1;
  }
  .image-studio__model {
    max-width: min(46vw, 200px);
  }
  .image-studio__header {
    padding-top: 14px;
    gap: 9px;
  }
  .image-studio__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .image-template-dialog {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .image-template-dialog__preview {
    min-height: 180px;
    aspect-ratio: 1.4;
  }
}
</style>
