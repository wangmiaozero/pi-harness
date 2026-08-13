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
  Circle
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { ModelDefinition } from '@shared/ipc/api-types'
import type { ModelForm } from '@shared/schemas/domain'
import { PROTOCOLS } from '@shared/constants/protocols'
import { PI_THINKING_LEVELS, type PiThinkingLevel } from '@shared/constants/index'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import Select from '@renderer/components/ui/Select.vue'
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
const editingId = ref<string | null>(null)
const deletingModel = ref<ModelDefinition | null>(null)
const saving = ref(false)
const useProviderProtocol = ref(true)
const showAdvanced = ref(false)

const defaultForm = (): ModelForm => ({
  providerId: '',
  modelId: '',
  displayName: '',
  protocol: 'openai-completions',
  enabled: true,
  reasoning: false,
  vision: false,
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
const providerOptions = computed(() =>
  providersStore.items.map((p) => ({ value: p.id, label: `${p.displayName} (${p.key})` }))
)

const isEditing = computed(() => editingId.value !== null)

const selectedProvider = computed(() =>
  providersStore.items.find((p) => p.id === form.value.providerId)
)

watch(
  () => form.value.providerId,
  (id) => {
    if (!useProviderProtocol.value) return
    const p = providersStore.items.find((x) => x.id === id)
    if (p) form.value.protocol = p.protocol
  }
)

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
    form.value.providerId = providersStore.items[0]!.id
    form.value.protocol = providersStore.items[0]!.protocol
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

async function save() {
  saving.value = true
  try {
    if (useProviderProtocol.value && selectedProvider.value) {
      form.value.protocol = selectedProvider.value.protocol
    }
    const payload: ModelForm = {
      ...form.value,
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
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(model: ModelDefinition) {
  deletingModel.value = model
  deleteOpen.value = true
}

async function doDelete() {
  if (!deletingModel.value) return
  try {
    await modelsStore.remove(deletingModel.value.id)
    toast.success(t('models.deleted'))
    deleteOpen.value = false
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

onMounted(() => {
  void Promise.all([providersStore.fetchList(), modelsStore.fetchList()])
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header
      class="flex shrink-0 items-center justify-between gap-3 px-5 h-[var(--height-page-header)] border-b border-[var(--border-subtle)]"
    >
      <div class="min-w-0">
        <h1 class="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          {{ $t('models.title') }}
        </h1>
        <p class="text-[11.5px] text-[var(--text-tertiary)] -mt-0.5">
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
    </header>

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
            >
              {{ providerKeyFor(activeModel) }}
              <span class="text-[var(--text-tertiary)]"> / </span>
              {{ activeModel.modelId }}
            </span>
            <span class="truncate text-[11.5px] text-[var(--text-tertiary)]">
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

      <!-- Resource list — each row is a "cardless" line with primary name +
           model id + capabilities. Active row gets an accent edge + soft tint. -->
      <div
        v-else
        class="rounded-[var(--radius-md)] border border-[var(--border-subtle)] overflow-hidden divide-y divide-[var(--border-subtle)]"
      >
        <div
          v-for="model in filteredModels"
          :key="model.id"
          class="group relative flex items-center gap-3 px-4 py-1.5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--bg-hover)]"
          :class="
            modelsStore.isActive(model, providerKeyFor(model)) ? 'bg-[var(--accent-tint-soft)]' : ''
          "
        >
          <span
            v-if="modelsStore.isActive(model, providerKeyFor(model))"
            class="pointer-events-none absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
          />

          <!-- Active check / inactive status indicator -->
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

          <!-- Primary / secondary text -->
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="truncate text-[13px] font-medium"
                :class="
                  modelsStore.isActive(model, providerKeyFor(model))
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--text-primary)]'
                "
              >
                {{ model.displayName }}
              </span>
              <span
                v-if="modelsStore.isActive(model, providerKeyFor(model))"
                class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--accent)]"
              >
                · {{ $t('models.active') }}
              </span>
              <Badge v-if="!model.enabled" tone="muted">
                {{ $t('common.disabled') }}
              </Badge>
              <Badge v-if="looksLikeImageModel(model)" tone="warning">
                {{ $t('models.imageModelBadge') }}
              </Badge>
            </div>

            <div
              class="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]"
            >
              <span class="text-[var(--text-secondary)]">{{ model.modelId }}</span>
              <span class="text-[var(--border-strong)]">·</span>
              <span>{{ providerKeyFor(model) ?? $t('common.unknown') }}</span>
              <span class="text-[var(--border-strong)]">·</span>
              <span>{{ protocolLabel(model.protocol) }}</span>
              <span v-if="model.contextWindow" class="tabular-nums text-[var(--border-strong)]">
                · {{ (model.contextWindow / 1000).toFixed(0) }}k ctx
              </span>
              <span class="flex flex-wrap items-center gap-1 font-[family-name:var(--font-sans)]">
                <span
                  v-if="model.vision"
                  class="inline-flex items-center gap-1 rounded-[4px] border border-transparent bg-[var(--tone-vision-bg)] px-1.5 h-[18px] text-[10.5px] text-[var(--tone-vision-text)]"
                >
                  <Eye class="size-3" :stroke-width="1.75" />
                  {{ $t('models.flagVision') }}
                </span>
                <span
                  v-if="model.tools"
                  class="inline-flex items-center gap-1 rounded-[4px] border border-transparent bg-[var(--tone-tools-bg)] px-1.5 h-[18px] text-[10.5px] text-[var(--tone-tools-text)]"
                >
                  <Wrench class="size-3" :stroke-width="1.75" />
                  {{ $t('models.flagTools') }}
                </span>
                <span
                  v-if="model.reasoning"
                  class="inline-flex items-center gap-1 rounded-[4px] border border-transparent bg-[var(--tone-reasoning-bg)] px-1.5 h-[18px] text-[10.5px] text-[var(--tone-reasoning-text)]"
                >
                  <Brain class="size-3" :stroke-width="1.75" />
                  {{ $t('models.flagReasoning') }}
                </span>
                <span
                  v-if="model.streaming"
                  class="inline-flex items-center gap-1 rounded-[4px] border border-transparent bg-[var(--tone-streaming-bg)] px-1.5 h-[18px] text-[10.5px] text-[var(--tone-streaming-text)]"
                >
                  <Radio class="size-3" :stroke-width="1.75" />
                  {{ $t('models.flagStreaming') }}
                </span>
              </span>
            </div>
          </div>

          <!-- Trailing meta + actions -->
          <div class="flex shrink-0 items-center gap-2 self-center">
            <span class="hidden text-[10.5px] text-[var(--text-tertiary)] sm:inline">
              {{ formatRelativeTime(model.updatedAt, locale) }}
            </span>
            <Button
              v-if="!modelsStore.isActive(model, providerKeyFor(model))"
              variant="ghost"
              size="sm"
              :disabled="!model.enabled"
              :title="$t('models.setActive')"
              @click="setActive(model)"
            >
              <Star class="size-3.5" :stroke-width="1.75" />
              <span>{{ $t('models.setActive') }}</span>
            </Button>
            <div
              class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            >
              <IconButton :label="$t('common.edit')" @click="openEdit(model)">
                <Pencil class="size-3.5" :stroke-width="1.75" />
              </IconButton>
              <IconButton
                variant="danger"
                :label="$t('common.delete')"
                @click="confirmDelete(model)"
              >
                <Trash2 class="size-3.5" :stroke-width="1.75" />
              </IconButton>
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
      <div class="space-y-3">
        <Select
          v-model="form.providerId"
          :label="$t('models.fieldProvider')"
          :options="providerOptions"
        />
        <div class="grid grid-cols-2 gap-3">
          <Input
            v-model="form.modelId"
            :label="$t('models.fieldModelId')"
            placeholder="gpt-4o"
            mono
          />
          <Input v-model="form.displayName" :label="$t('models.fieldDisplayName')" />
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-[12px] text-[var(--text-secondary)]">{{ $t('common.enabled') }}</span>
          <Switch v-model="form.enabled" :label="$t('common.enabled')" />
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-[12px] text-[var(--text-secondary)]">{{
            $t('models.useProviderProtocol')
          }}</span>
          <Switch v-model="useProviderProtocol" :label="$t('models.useProviderProtocol')" />
        </div>
        <Select
          v-model="form.protocol"
          :label="$t('models.fieldProtocol')"
          :options="protocolOptions"
          :disabled="useProviderProtocol"
        />
        <div class="grid grid-cols-2 gap-3">
          <Input
            v-model="contextWindowStr"
            :label="$t('models.fieldContext')"
            type="number"
            placeholder="128000"
          />
          <Input
            v-model="maxOutputStr"
            :label="$t('models.fieldMaxOutput')"
            type="number"
            placeholder="4096"
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
        <Button variant="primary" :loading="saving" @click="save">
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
  </div>
</template>
