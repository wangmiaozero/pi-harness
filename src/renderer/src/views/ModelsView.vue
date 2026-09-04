<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  Star,
  Eye,
  Wrench,
  Brain,
  Radio,
  Cpu,
  Circle,
  Zap
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { ModelDefinition, ConnectionTestResult, ProviderProfile } from '@shared/ipc/api-types'
import type { ModelForm, ProviderForm } from '@shared/schemas/domain'
import { PROTOCOLS } from '@shared/constants/protocols'
import { findProviderPreset } from '@shared/constants/provider-presets'
import { PI_THINKING_LEVELS, type PiThinkingLevel } from '@shared/constants/index'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import Select from '@renderer/components/ui/Select.vue'
import Combobox from '@renderer/components/ui/Combobox.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import SearchField from '@renderer/components/ui/SearchField.vue'
import { useModelsStore } from '@renderer/stores/models'
import { useProvidersStore } from '@renderer/stores/providers'
import { formatRelativeTime } from '@renderer/utils/format'

const { t, locale } = useI18n()
const modelsStore = useModelsStore()
const providersStore = useProvidersStore()

const dialogOpen = ref(false)
const deleteOpen = ref(false)
const testOpen = ref(false)
const editingId = ref<string | null>(null)
const deletingModel = ref<ModelDefinition | null>(null)
const testingModel = ref<ModelDefinition | null>(null)
const testResult = ref<ConnectionTestResult | null>(null)
const testLoading = ref(false)
const saving = ref(false)
const useProviderProtocol = ref(true)
const showAdvanced = ref(false)
/** Editable models.json provider key — may rename the provider on save. */
const providerKeyDraft = ref('')

const listGrid = {
  gridTemplateColumns:
    '20px minmax(8rem, 1.2fr) minmax(6rem, 1fr) max-content max-content 4.75rem max-content 19rem'
} as const

const defaultForm = (): ModelForm => ({
  providerId: '',
  modelId: '',
  displayName: '',
  protocol: 'openai-completions',
  enabled: true,
  reasoning: false,
  vision: true,
  tools: false,
  streaming: true,
  contextWindow: null,
  maxOutputTokens: null,
  thinkingLevels: undefined
})

const form = ref<ModelForm>(defaultForm())
const contextWindowStr = ref('')
const maxOutputStr = ref('')
const thinkingMap = ref<Record<PiThinkingLevel, string>>(
  Object.fromEntries(PI_THINKING_LEVELS.map((l) => [l, ''])) as Record<PiThinkingLevel, string>
)

const protocolOptions = computed(() => PROTOCOLS.map((p) => ({ value: p.id, label: p.label })))
const providerKeyOptions = computed(() =>
  providersStore.items.map((p) => ({
    value: p.key,
    label: p.key,
    hint: p.displayName && p.displayName !== p.key ? p.displayName : undefined
  }))
)

const isEditing = computed(() => editingId.value !== null)

const selectedProvider = computed(() =>
  providersStore.items.find((p) => p.id === form.value.providerId)
)
const selectedProviderPreset = computed(() =>
  findProviderPreset({
    key: providerKeyDraft.value,
    protocol: selectedProvider.value?.protocol ?? form.value.protocol,
    baseUrl: selectedProvider.value?.baseUrl
  })
)
const conflictingModelIds = computed(
  () =>
    new Set(
      modelsStore.items
        .filter(
          (model) => model.providerId === form.value.providerId && model.id !== editingId.value
        )
        .map((model) => model.modelId)
    )
)
const modelIdConflict = computed(() => conflictingModelIds.value.has(form.value.modelId.trim()))
const modelPresetOptions = computed(() =>
  (selectedProviderPreset.value?.models ?? [])
    .filter((model) => !conflictingModelIds.value.has(model.id))
    .map((model) => ({
      value: model.id,
      label: model.name,
      hint: model.contextWindow ? model.contextWindow.toLocaleString() : undefined
    }))
)

function selectModelPreset(modelId: string) {
  if (isEditing.value) return
  const model = selectedProviderPreset.value?.models.find((item) => item.id === modelId)
  if (!model) return
  form.value.displayName = model.name
  form.value.vision = model.input?.includes('image') ?? true
  contextWindowStr.value = model.contextWindow != null ? String(model.contextWindow) : ''
  maxOutputStr.value = model.maxOutputTokens != null ? String(model.maxOutputTokens) : ''
}

function bindProvider(p: ProviderProfile | undefined) {
  if (!p) return
  form.value.providerId = p.id
  providerKeyDraft.value = p.key
  if (useProviderProtocol.value) form.value.protocol = p.protocol
}

function providerToForm(p: ProviderProfile, key: string): ProviderForm {
  return {
    key,
    name: p.name || p.displayName || key,
    displayName: p.displayName,
    enabled: p.enabled,
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    headers: { ...p.headers },
    authHeader: p.authHeader,
    timeout: p.timeout,
    defaultModelId: p.defaultModelId
  }
}

watch(
  () => form.value.providerId,
  (id) => {
    const p = providersStore.items.find((x) => x.id === id)
    if (p && p.key !== providerKeyDraft.value.trim()) providerKeyDraft.value = p.key
    if (p && useProviderProtocol.value) form.value.protocol = p.protocol
  }
)

watch(providerKeyDraft, (v) => {
  const match = providersStore.items.find((p) => p.key === v.trim())
  if (match && match.id !== form.value.providerId) form.value.providerId = match.id
})

function providerKeyFor(model: ModelDefinition): string | undefined {
  return providersStore.items.find((p) => p.id === model.providerId)?.key
}

const providerFilter = ref<string | 'all'>('all')
const query = ref('')

const filteredModels = computed(() => {
  const q = query.value.trim().toLowerCase()
  return modelsStore.items.filter((m) => {
    if (providerFilter.value !== 'all' && m.providerId !== providerFilter.value) return false
    if (!q) return true
    const pk = providerKeyFor(m)?.toLowerCase() ?? ''
    return (
      m.displayName.toLowerCase().includes(q) ||
      m.modelId.toLowerCase().includes(q) ||
      pk.includes(q) ||
      m.protocol.toLowerCase().includes(q)
    )
  })
})

const activeModel = computed(
  () => modelsStore.items.find((m) => modelsStore.isActive(m, providerKeyFor(m))) ?? null
)

/** Heuristic: dedicated image APIs are not usable as Pi chat active models. */
function looksLikeImageModel(model: ModelDefinition): boolean {
  return /image|dall|flux|sdxl|imagen|midjourney/i.test(model.modelId)
}

function protocolLabel(protocol: string): string {
  return PROTOCOLS.find((p) => p.id === protocol)?.label ?? protocol
}

function resetThinkingMap(src?: ModelDefinition['thinkingLevels']) {
  thinkingMap.value = Object.fromEntries(
    PI_THINKING_LEVELS.map((l) => [l, src?.[l] ?? ''])
  ) as Record<PiThinkingLevel, string>
}

function buildThinkingLevels(): ModelForm['thinkingLevels'] {
  const entries = PI_THINKING_LEVELS.map((l) => {
    const v = thinkingMap.value[l]?.trim()
    return v ? ([l, v] as const) : null
  }).filter((x): x is readonly [PiThinkingLevel, string] => x != null)
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries) as NonNullable<ModelForm['thinkingLevels']>
}

function openCreate() {
  editingId.value = null
  form.value = defaultForm()
  contextWindowStr.value = ''
  maxOutputStr.value = ''
  useProviderProtocol.value = true
  showAdvanced.value = false
  resetThinkingMap()
  if (providersStore.items.length > 0) {
    bindProvider(providersStore.items[0])
  }
  dialogOpen.value = true
}

function openEdit(model: ModelDefinition) {
  editingId.value = model.id
  const provider = providersStore.items.find((p) => p.id === model.providerId)
  useProviderProtocol.value = !provider || provider.protocol === model.protocol
  form.value = {
    providerId: model.providerId,
    modelId: model.modelId,
    displayName: model.displayName,
    protocol: model.protocol,
    enabled: model.enabled,
    reasoning: model.reasoning,
    vision: model.vision,
    tools: model.tools,
    streaming: model.streaming,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    thinkingLevels: model.thinkingLevels as ModelForm['thinkingLevels']
  }
  contextWindowStr.value = model.contextWindow != null ? String(model.contextWindow) : ''
  maxOutputStr.value = model.maxOutputTokens != null ? String(model.maxOutputTokens) : ''
  providerKeyDraft.value = provider?.key ?? model.providerId
  resetThinkingMap(model.thinkingLevels)
  showAdvanced.value = Boolean(model.thinkingLevels && Object.keys(model.thinkingLevels).length)
  dialogOpen.value = true
}

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = parseInt(trimmed, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function resolveProviderIdForSave(): Promise<string | null> {
  const nextKey = providerKeyDraft.value.trim()
  if (!nextKey) {
    toast.error(t('providers.keyRequired'))
    return null
  }
  const exact = providersStore.items.find((p) => p.key === nextKey)
  if (exact) return exact.id

  const current = selectedProvider.value
  if (!current) {
    toast.error(t('models.providerMissing'))
    return null
  }
  const renamed = await providersStore.update(current.key, providerToForm(current, nextKey))
  if (!renamed) return null
  toast.success(t('providers.updated'))
  return renamed.key
}

async function save() {
  if (modelIdConflict.value) {
    toast.error(t('models.modelExists', { id: form.value.modelId.trim() }))
    return
  }
  saving.value = true
  try {
    const providerId = await resolveProviderIdForSave()
    if (!providerId) return
    form.value.providerId = providerId
    const provider = providersStore.items.find((p) => p.id === providerId)
    if (useProviderProtocol.value && provider) {
      form.value.protocol = provider.protocol
    }
    const payload: ModelForm = {
      ...form.value,
      providerId,
      contextWindow: parseOptionalInt(contextWindowStr.value),
      maxOutputTokens: parseOptionalInt(maxOutputStr.value),
      thinkingLevels: buildThinkingLevels()
    }
    if (isEditing.value && editingId.value) {
      await modelsStore.update(editingId.value, payload)
      toast.success(t('models.updated'))
    } else {
      await modelsStore.create(payload)
      toast.success(t('models.created'))
    }
    dialogOpen.value = false
    await providersStore.fetchList()
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(model: ModelDefinition) {
  if (!canDeleteModel(model)) {
    toast.error(t('models.keepAtLeastOne'))
    return
  }
  deletingModel.value = model
  deleteOpen.value = true
}

/** Each provider must retain ≥1 model — hide delete when it's the last one. */
function canDeleteModel(model: ModelDefinition): boolean {
  return modelsStore.items.filter((m) => m.providerId === model.providerId).length > 1
}

async function doDelete() {
  if (!deletingModel.value) return
  if (!canDeleteModel(deletingModel.value)) {
    toast.error(t('models.keepAtLeastOne'))
    deleteOpen.value = false
    return
  }
  try {
    await modelsStore.remove(deletingModel.value.id)
    toast.success(t('models.deleted'))
    deleteOpen.value = false
    await providersStore.fetchList()
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function setActive(model: ModelDefinition) {
  const key = providerKeyFor(model)
  if (!key) {
    toast.error(t('models.providerMissing'))
    return
  }
  try {
    await modelsStore.setActive(key, model.modelId)
    toast.success(t('models.activated'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

function openTest(model: ModelDefinition) {
  testingModel.value = model
  testResult.value = null
  testOpen.value = true
}

async function runTest() {
  const model = testingModel.value
  if (!model) return
  const key = providerKeyFor(model)
  if (!key) {
    toast.error(t('models.providerMissing'))
    return
  }
  testLoading.value = true
  testResult.value = null
  try {
    const result = await providersStore.testConnection(key, model.modelId)
    testResult.value = result
    if (result.ok) toast.success(t('providers.testOk'))
    else toast.error(result.message)
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    testLoading.value = false
  }
}

onMounted(() => {
  void Promise.all([providersStore.fetchList(), modelsStore.fetchList()])
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <PageHeader>
      <div class="flex min-w-0 flex-col justify-center self-stretch">
        <h1
          class="text-[15px] font-semibold leading-[18px] tracking-tight text-[var(--text-primary)]"
        >
          {{ $t('models.title') }}
        </h1>
        <p class="mt-[3px] text-[11.5px] leading-[14px] text-[var(--text-tertiary)]">
          {{ $t('models.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <SearchField
          v-model="query"
          :placeholder="$t('models.filterPlaceholder')"
          class="w-[220px]"
        />
        <Button
          variant="primary"
          size="sm"
          :disabled="providersStore.items.length === 0"
          @click="openCreate"
        >
          <Plus class="size-3.5" />
          {{ $t('models.create') }}
        </Button>
      </div>
    </PageHeader>

    <div class="flex-1 overflow-y-auto px-5 pt-4 pb-6 space-y-4">
      <!-- Active Model summary — single line, not a Card. -->
      <div
        v-if="modelsStore.items.length > 0"
        class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
          >
            {{ $t('models.active') }}
          </span>
          <template v-if="activeModel">
            <span
              class="font-[family-name:var(--font-mono)] text-[12.5px] text-[var(--text-primary)]"
              :title="`${providerKeyFor(activeModel)} / ${activeModel.modelId}`"
            >
              {{ providerKeyFor(activeModel) }}
              <span class="text-[var(--text-tertiary)]"> / </span>
              {{ activeModel.modelId }}
            </span>
            <span
              class="truncate text-[11.5px] text-[var(--text-tertiary)]"
              :title="activeModel.displayName"
            >
              — {{ activeModel.displayName }}
            </span>
          </template>
          <span v-else class="text-[12px] text-[var(--text-tertiary)]">
            {{ $t('models.noActiveHint') }}
          </span>
        </div>
        <div class="ml-auto flex items-center gap-3 text-[11.5px] text-[var(--text-tertiary)]">
          <span>
            <span class="tabular-nums text-[var(--text-primary)] font-medium">{{
              filteredModels.length
            }}</span>
            <span> / {{ modelsStore.items.length }} {{ $t('models.colModel') }}</span>
          </span>
        </div>
      </div>

      <!-- Provider filter chips -->
      <div v-if="modelsStore.items.length > 0" class="flex flex-wrap items-center gap-1">
        <button
          type="button"
          class="h-[26px] rounded-[var(--radius-sm)] px-2 text-[11.5px] transition-colors"
          :class="
            providerFilter === 'all'
              ? 'bg-[var(--accent-tint)] text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          "
          @click="providerFilter = 'all'"
        >
          {{ $t('models.filterAll') }}
        </button>
        <button
          v-for="p in providersStore.items"
          :key="p.id"
          type="button"
          class="h-[26px] rounded-[var(--radius-sm)] px-2 font-[family-name:var(--font-mono)] text-[11px] transition-colors"
          :class="
            providerFilter === p.id
              ? 'bg-[var(--accent-tint)] text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          "
          @click="providerFilter = p.id"
        >
          {{ p.key }}
        </button>
      </div>

      <div
        v-if="modelsStore.loading"
        class="py-12 text-center text-[11.5px] text-[var(--text-tertiary)]"
      >
        {{ $t('common.loading') }}
      </div>

      <EmptyState
        v-else-if="modelsStore.items.length === 0"
        :title="$t('models.empty')"
        :description="$t('models.emptyHint')"
        :icon="Cpu"
      >
        <Button
          variant="primary"
          size="sm"
          class="mt-3"
          :disabled="providersStore.items.length === 0"
          @click="openCreate"
        >
          {{ $t('models.createShort') }}
        </Button>
      </EmptyState>

      <EmptyState
        v-else-if="filteredModels.length === 0"
        :title="$t('models.filterEmpty')"
        :description="$t('models.filterEmptyHint')"
      />

      <!-- One parent grid + subgrid rows so every column shares the same tracks. -->
      <div
        v-else
        data-testid="models-table-scroll"
        class="overflow-x-auto overflow-y-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      >
        <div class="grid min-w-[1150px] gap-x-2" :style="listGrid">
          <div
            class="col-span-full grid h-[30px] grid-cols-subgrid items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-3 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
          >
            <span />
            <span class="min-w-0 truncate">{{ $t('models.colModel') }}</span>
            <span class="min-w-0 truncate">{{ $t('models.fieldModelId') }}</span>
            <span class="min-w-0 truncate">{{ $t('models.colProvider') }}</span>
            <span class="min-w-0 truncate">{{ $t('models.colProtocol') }}</span>
            <span class="min-w-0 truncate">{{ $t('models.colCapabilities') }}</span>
            <span class="min-w-0 truncate">{{ $t('models.colUpdated') }}</span>
            <span
              class="sticky right-0 z-20 flex self-stretch items-center justify-end border-l border-[var(--border-subtle)] bg-[inherit] pl-2 pr-3"
            >
              {{ $t('common.actions') }}
            </span>
          </div>

          <div
            v-for="model in filteredModels"
            :key="model.id"
            class="group relative col-span-full grid grid-cols-subgrid items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-3 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] last:border-b-0 hover:bg-[var(--bg-hover)]"
            :class="
              modelsStore.isActive(model, providerKeyFor(model))
                ? '!bg-[var(--bg-selected)] hover:!bg-[var(--bg-hover)]'
                : ''
            "
            :style="{ height: 'var(--height-row)' }"
          >
            <span
              v-if="modelsStore.isActive(model, providerKeyFor(model))"
              class="pointer-events-none absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
            />

            <div class="flex size-3 shrink-0 items-center justify-center">
              <Check
                v-if="modelsStore.isActive(model, providerKeyFor(model))"
                class="size-3 text-[var(--accent)]"
                :stroke-width="2.5"
              />
              <Circle
                v-else
                class="size-1.5 fill-current text-[var(--text-disabled)]"
                :stroke-width="0"
              />
            </div>

            <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
              <span
                class="min-w-0 truncate whitespace-nowrap text-[13px] font-medium"
                :class="
                  modelsStore.isActive(model, providerKeyFor(model))
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--text-primary)]'
                "
                :title="
                  modelsStore.isActive(model, providerKeyFor(model))
                    ? `${model.displayName} · ${$t('models.active')}`
                    : model.displayName
                "
              >
                {{ model.displayName }}
              </span>
              <Badge v-if="!model.enabled" tone="muted" class="shrink-0">
                {{ $t('common.disabled') }}
              </Badge>
              <Badge v-if="looksLikeImageModel(model)" tone="warning" class="shrink-0">
                {{ $t('models.imageModelBadge') }}
              </Badge>
            </div>

            <div
              class="min-w-0 truncate whitespace-nowrap font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)]"
              :title="model.modelId"
            >
              {{ model.modelId }}
            </div>

            <div
              class="min-w-0 truncate whitespace-nowrap font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-tertiary)]"
              :title="providerKeyFor(model) ?? $t('common.unknown')"
            >
              {{ providerKeyFor(model) ?? $t('common.unknown') }}
            </div>

            <div
              class="min-w-0 truncate whitespace-nowrap text-[11.5px] text-[var(--text-secondary)]"
              :title="protocolLabel(model.protocol)"
            >
              {{ protocolLabel(model.protocol) }}
            </div>

            <div class="flex min-w-0 items-center gap-1 overflow-hidden">
              <span
                v-if="model.vision"
                class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px] bg-[var(--tone-vision-bg)] text-[var(--tone-vision-text)]"
                :title="$t('models.flagVision')"
              >
                <Eye class="size-3" :stroke-width="1.75" />
              </span>
              <span
                v-if="model.tools"
                class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px] bg-[var(--tone-tools-bg)] text-[var(--tone-tools-text)]"
                :title="$t('models.flagTools')"
              >
                <Wrench class="size-3" :stroke-width="1.75" />
              </span>
              <span
                v-if="model.reasoning"
                class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px] bg-[var(--tone-reasoning-bg)] text-[var(--tone-reasoning-text)]"
                :title="$t('models.flagReasoning')"
              >
                <Brain class="size-3" :stroke-width="1.75" />
              </span>
              <span
                v-if="model.streaming"
                class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px] bg-[var(--tone-streaming-bg)] text-[var(--tone-streaming-text)]"
                :title="$t('models.flagStreaming')"
              >
                <Radio class="size-3" :stroke-width="1.75" />
              </span>
              <span
                v-if="!model.vision && !model.tools && !model.reasoning && !model.streaming"
                class="text-[10.5px] text-[var(--text-disabled)]"
              >
                —
              </span>
            </div>

            <div
              class="whitespace-nowrap text-[10.5px] text-[var(--text-tertiary)]"
              :title="formatRelativeTime(model.updatedAt, locale === 'zh-CN' ? 'zh-CN' : 'en-US')"
            >
              {{ formatRelativeTime(model.updatedAt, locale === 'zh-CN' ? 'zh-CN' : 'en-US') }}
            </div>

            <div
              data-testid="model-action-cell"
              class="sticky right-0 z-10 grid h-full grid-cols-[6rem_3.5rem_3.5rem_3.5rem] items-center border-l border-[var(--border-subtle)] bg-[inherit] pl-2 pr-3"
            >
              <div class="flex min-w-0 items-center justify-center">
                <IconButton
                  v-if="!modelsStore.isActive(model, providerKeyFor(model))"
                  show-label
                  class="w-full"
                  :label="$t('models.setActive')"
                  :disabled="!model.enabled"
                  @click="setActive(model)"
                >
                  <Star class="size-3.5 shrink-0" :stroke-width="1.75" />
                </IconButton>
              </div>
              <div class="flex min-w-0 items-center justify-center">
                <IconButton
                  show-label
                  class="w-full"
                  :label="$t('common.test')"
                  @click="openTest(model)"
                >
                  <Zap class="size-3.5 shrink-0" :stroke-width="1.75" />
                </IconButton>
              </div>
              <div class="flex min-w-0 items-center justify-center">
                <IconButton
                  show-label
                  class="w-full"
                  :label="$t('common.edit')"
                  @click="openEdit(model)"
                >
                  <Pencil class="size-3.5 shrink-0" :stroke-width="1.75" />
                </IconButton>
              </div>
              <div class="flex min-w-0 items-center justify-center">
                <IconButton
                  v-if="canDeleteModel(model)"
                  show-label
                  class="w-full"
                  variant="danger"
                  :label="$t('common.delete')"
                  @click="confirmDelete(model)"
                >
                  <Trash2 class="size-3.5 shrink-0" :stroke-width="1.75" />
                </IconButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Dialog
      v-model:open="dialogOpen"
      :title="isEditing ? $t('models.edit') : $t('models.create')"
      wide
    >
      <div class="space-y-2.5">
        <Combobox
          v-model="providerKeyDraft"
          :label="$t('models.fieldProvider')"
          :hint="$t('models.fieldProviderKeyHint')"
          :placeholder="$t('providers.keyPlaceholder')"
          :options="providerKeyOptions"
          mono
        />
        <div class="grid grid-cols-2 gap-3">
          <Combobox
            v-model="form.modelId"
            :label="$t('models.fieldModelId')"
            :placeholder="$t('models.modelIdPlaceholder')"
            :options="modelPresetOptions"
            :error="
              modelIdConflict ? $t('models.modelExists', { id: form.modelId.trim() }) : undefined
            "
            mono
            @select="selectModelPreset"
          />
          <Input
            v-model="form.displayName"
            :label="$t('models.fieldDisplayName')"
            :placeholder="$t('models.displayNamePlaceholder')"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex h-[var(--height-input)] items-center justify-between gap-2">
            <span class="text-[12px] text-[var(--text-secondary)]">{{ $t('common.enabled') }}</span>
            <Switch v-model="form.enabled" :label="$t('common.enabled')" />
          </div>
          <div class="flex h-[var(--height-input)] items-center justify-between gap-2">
            <span class="min-w-0 truncate text-[12px] text-[var(--text-secondary)]">{{
              $t('models.useProviderProtocol')
            }}</span>
            <Switch v-model="useProviderProtocol" :label="$t('models.useProviderProtocol')" />
          </div>
        </div>
        <Select
          v-if="!useProviderProtocol"
          v-model="form.protocol"
          :label="$t('models.fieldProtocol')"
          :options="protocolOptions"
        />
        <div class="grid grid-cols-2 gap-3">
          <Input
            v-model="contextWindowStr"
            :label="$t('models.fieldContext')"
            type="number"
            :placeholder="$t('models.contextPlaceholder')"
          />
          <Input
            v-model="maxOutputStr"
            :label="$t('models.fieldMaxOutput')"
            type="number"
            :placeholder="$t('models.maxOutputPlaceholder')"
          />
        </div>

        <!-- Capabilities as compact pill toggles (enabled is a Switch above). -->
        <div class="space-y-2">
          <p
            class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
          >
            {{ $t('models.colCapabilities') }}
          </p>
          <div class="flex flex-wrap gap-1.5">
            <label
              v-for="opt in [
                { key: 'vision', label: $t('models.flagVision') },
                { key: 'tools', label: $t('models.flagTools') },
                { key: 'reasoning', label: $t('models.flagReasoning') },
                { key: 'streaming', label: $t('models.flagStreaming') }
              ] as const"
              :key="opt.key"
              class="inline-flex cursor-pointer items-center gap-1.5 h-[26px] rounded-[var(--radius-sm)] border px-2.5 text-[11.5px] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)]"
              :class="
                form[opt.key]
                  ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)]'
                  : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
              "
            >
              <input v-model="form[opt.key]" type="checkbox" class="sr-only" />
              {{ opt.label }}
            </label>
          </div>
        </div>

        <button
          type="button"
          class="text-[11.5px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)]"
          @click="showAdvanced = !showAdvanced"
        >
          {{ showAdvanced ? $t('models.hideAdvanced') : $t('models.showAdvanced') }}
        </button>
        <div
          v-if="showAdvanced"
          class="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        >
          <p class="text-[10.5px] text-[var(--text-tertiary)]">
            {{ $t('models.thinkingLevelsHint') }}
          </p>
          <div class="grid grid-cols-2 gap-2">
            <label
              v-for="level in PI_THINKING_LEVELS"
              :key="level"
              class="flex flex-col gap-1 text-[11px]"
            >
              <span class="font-[family-name:var(--font-mono)] text-[var(--text-secondary)]">{{
                level
              }}</span>
              <Input v-model="thinkingMap[level]" :placeholder="level" mono />
            </label>
          </div>
        </div>
      </div>
      <template #footer>
        <Button variant="ghost" @click="dialogOpen = false">
          {{ $t('common.cancel') }}
        </Button>
        <Button variant="primary" :disabled="modelIdConflict" :loading="saving" @click="save">
          {{ $t('common.save') }}
        </Button>
      </template>
    </Dialog>

    <Dialog
      v-model:open="deleteOpen"
      :title="$t('models.deleteTitle')"
      :description="$t('models.deleteConfirm', { name: deletingModel?.displayName ?? '' })"
    >
      <template #footer>
        <Button variant="ghost" @click="deleteOpen = false">
          {{ $t('common.cancel') }}
        </Button>
        <Button variant="danger" @click="doDelete">
          {{ $t('common.delete') }}
        </Button>
      </template>
    </Dialog>

    <Dialog
      v-model:open="testOpen"
      :title="$t('providers.testTitle')"
      :description="
        testingModel ? `${providerKeyFor(testingModel) ?? ''} / ${testingModel.modelId}` : undefined
      "
    >
      <div class="space-y-3">
        <p class="text-[12px] text-[var(--text-secondary)]">
          {{ $t('providers.testModelHint') }}
        </p>
        <div
          v-if="testResult"
          class="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <Badge
              :tone="
                testResult.ok
                  ? 'success'
                  : testResult.status === 'rate_limited'
                    ? 'warning'
                    : 'error'
              "
            >
              {{
                testResult.ok
                  ? $t('providers.testSuccess')
                  : testResult.status === 'rate_limited'
                    ? $t('providers.testRateLimited')
                    : testResult.status === 'auth_error'
                      ? $t('providers.testUnauthorized')
                      : testResult.status === 'forbidden'
                        ? $t('providers.testForbidden')
                        : $t('providers.testFailed')
              }}
            </Badge>
            <Badge v-if="testResult.httpStatus != null" tone="muted">
              HTTP {{ testResult.httpStatus }}
            </Badge>
          </div>
          <p class="text-[12px] text-[var(--text-secondary)]">{{ testResult.message }}</p>
          <dl
            class="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-[10.5px] text-[var(--text-tertiary)]"
          >
            <dt>{{ $t('providers.testStatus') }}</dt>
            <dd class="font-[family-name:var(--font-mono)] text-[var(--text-secondary)]">
              {{ testResult.status }}
            </dd>
            <dt>{{ $t('providers.testHttp') }}</dt>
            <dd class="font-[family-name:var(--font-mono)] text-[var(--text-secondary)]">
              {{ testResult.httpStatus ?? '—' }}
            </dd>
            <dt>{{ $t('providers.testLatency') }}</dt>
            <dd class="font-[family-name:var(--font-mono)] text-[var(--text-secondary)]">
              {{ testResult.latencyMs }} ms
            </dd>
            <dt>{{ $t('providers.testProtocol') }}</dt>
            <dd class="font-[family-name:var(--font-mono)] text-[var(--text-secondary)]">
              {{ testResult.protocol ?? '—' }}
            </dd>
            <dt>{{ $t('providers.testEndpoint') }}</dt>
            <dd
              class="truncate font-[family-name:var(--font-mono)] text-[var(--text-secondary)]"
              :title="testResult.endpoint ?? ''"
            >
              {{ testResult.endpoint ?? '—' }}
            </dd>
            <dt>{{ $t('providers.testModel') }}</dt>
            <dd class="font-[family-name:var(--font-mono)] text-[var(--text-secondary)]">
              {{ testResult.modelId ?? '—' }}
            </dd>
          </dl>
        </div>
      </div>
      <template #footer>
        <Button variant="ghost" @click="testOpen = false">
          {{ $t('common.close') }}
        </Button>
        <Button variant="primary" :loading="testLoading" @click="runTest">
          {{ $t('providers.testRun') }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
