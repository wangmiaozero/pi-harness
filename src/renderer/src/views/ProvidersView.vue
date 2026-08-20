<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Pencil, Copy, Trash2, Zap, Box, Search, Circle } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { ProviderProfile, ConnectionTestResult } from '@shared/ipc/api-types'
import type { ProviderForm } from '@shared/schemas/domain'
import { PROTOCOLS, PROVIDER_PRESETS } from '@shared/constants/protocols'
import { isKeychainCommand, keychainServiceName } from '@shared/utils/api-key'
import { normalizeProviderBaseUrl } from '@shared/utils/base-url'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import Textarea from '@renderer/components/ui/Textarea.vue'
import Select from '@renderer/components/ui/Select.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import SearchField from '@renderer/components/ui/SearchField.vue'
import { useProvidersStore } from '@renderer/stores/providers'
import { useModelsStore } from '@renderer/stores/models'
import { formatRelativeTime } from '@renderer/utils/format'

type ApiKeyUiKind = 'none' | 'literal' | 'env' | 'command' | 'keychain' | 'stored'

/** Sentinel shown in the password field when a secret already exists (never submitted as a real key). */
const KEY_MASK = '••••••••••••••••'

const { t, locale } = useI18n()
const providersStore = useProvidersStore()
const modelsStore = useModelsStore()

const dialogOpen = ref(false)
const deleteOpen = ref(false)
const duplicateOpen = ref(false)
const testOpen = ref(false)
const editingKey = ref<string | null>(null)
const deletingProvider = ref<ProviderProfile | null>(null)
const duplicatingProvider = ref<ProviderProfile | null>(null)
const testingProvider = ref<ProviderProfile | null>(null)
const testModelId = ref('')
const testResult = ref<ConnectionTestResult | null>(null)
const testLoading = ref(false)
const saving = ref(false)
const timeoutStr = ref('')
const headersJson = ref('{}')
const headersPlaceholder = '{"X-Custom":"value"}'
const defaultModelIdStr = ref('')
const query = ref('')

/** Shared column tracks via subgrid — actions always reserved so hover icons never overlap. */
const listGrid = {
  gridTemplateColumns:
    'minmax(0, 1.8fr) minmax(0, 0.95fr) 44px 72px 40px minmax(0, 0.7fr) 120px'
} as const

const defaultForm = (): ProviderForm => ({
  key: '',
  name: '',
  displayName: '',
  enabled: true,
  protocol: 'openai-completions',
  baseUrl: '',
  apiKey: null,
  headers: {},
  authHeader: true,
  timeout: null,
  defaultModelId: null
})

const form = ref<ProviderForm>(defaultForm())
const apiKeyKind = ref<ApiKeyUiKind>('none')
const apiKeyValue = ref('')
/** Preserved !command / keychain binding when editing — never shown as plaintext secret. */
const preservedCommand = ref<string | null>(null)
const keychainService = ref<string | null>(null)

const protocolOptions = computed(() => PROTOCOLS.map((p) => ({ value: p.id, label: p.label })))

const apiKeyTypeOptions = computed(() => [
  { value: 'none', label: t('providers.keyTypeNone') },
  { value: 'literal', label: t('providers.keyTypeLiteral') },
  { value: 'env', label: t('providers.keyTypeEnv') },
  { value: 'command', label: t('providers.keyTypeCommand') },
  { value: 'keychain', label: t('providers.keyTypeKeychain') },
  { value: 'stored', label: t('providers.keyTypeStored') }
])

const isEditing = computed(() => editingKey.value !== null)

const showApiKeyInput = computed(
  () =>
    apiKeyKind.value === 'literal' || apiKeyKind.value === 'env' || apiKeyKind.value === 'command'
)

const showKeychainPanel = computed(
  () => apiKeyKind.value === 'keychain' || apiKeyKind.value === 'stored'
)

const apiKeyPlaceholder = computed(() => {
  if (apiKeyKind.value === 'env') return t('providers.envPlaceholder')
  if (apiKeyKind.value === 'command') return t('providers.commandPlaceholder')
  if (hasSavedSecret.value) return t('providers.keyKeepPlaceholder')
  return t('providers.literalPlaceholder')
})

const hasSavedSecret = computed(
  () =>
    isEditing.value &&
    (apiKeyKind.value === 'stored' ||
      apiKeyKind.value === 'keychain' ||
      apiKeyKind.value === 'literal') &&
    Boolean(keychainService.value || preservedCommand.value || form.value.apiKey)
)

const providersWithNoModels = computed(() =>
  providersStore.items.filter((p) => p.enabled && p.modelCount === 0)
)

const baseUrlHint = computed(() => {
  if (form.value.protocol === 'openai-completions' || form.value.protocol === 'openai-responses') {
    return t('providers.baseUrlHintOpenai')
  }
  if (form.value.protocol === 'anthropic-messages') {
    return t('providers.baseUrlHintAnthropic')
  }
  return t('providers.baseUrlHintGeneric')
})

function isMaskedKey(value: string): boolean {
  return value === KEY_MASK || /^•+$/.test(value.trim())
}

function clearKeyMask() {
  if (isMaskedKey(apiKeyValue.value)) apiKeyValue.value = ''
}

function onBaseUrlBlur() {
  const r = normalizeProviderBaseUrl(form.value.baseUrl)
  if (r.changed) {
    form.value.baseUrl = r.url
    toast.info(t('providers.baseUrlNormalized'))
  }
}

/** Suggest a provider key from free text. Preserves case; only sanitizes. */
function suggestProviderKey(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/-+$/g, '')
    .slice(0, 128)
  if (!cleaned) return ''
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `p-${cleaned}`.slice(0, 128)
}

function uniqueProviderKey(base: string): string {
  const existing = new Set(providersStore.items.map((p) => p.key))
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`.slice(0, 128)
}

function openCreate(presetId?: string) {
  editingKey.value = null
  form.value = defaultForm()
  // Only auto-enable when nothing else is enabled (single-active rule).
  form.value.enabled = !providersStore.items.some((p) => p.enabled)
  apiKeyKind.value = 'none'
  apiKeyValue.value = ''
  preservedCommand.value = null
  keychainService.value = null
  timeoutStr.value = ''
  headersJson.value = '{}'
  defaultModelIdStr.value = ''
  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)
  if (preset) {
    form.value.protocol = preset.protocol
    form.value.baseUrl = preset.defaultBaseUrl
    form.value.name = preset.name
    form.value.displayName = preset.name
    // Prefill key so save never hits empty-key validation. Keep preset id casing.
    form.value.key = uniqueProviderKey(suggestProviderKey(preset.id))
    if (preset.placeholderApiKey) {
      apiKeyKind.value = 'literal'
      // Placeholder only — user replaces with real secret (e.g. nvapi-…).
      apiKeyValue.value = ''
    }
  }
  dialogOpen.value = true
}

function openEdit(provider: ProviderProfile) {
  editingKey.value = provider.key
  form.value = {
    key: provider.key,
    name: provider.name,
    displayName: provider.displayName,
    enabled: provider.enabled,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: { ...provider.headers },
    authHeader: provider.authHeader,
    timeout: provider.timeout,
    defaultModelId: provider.defaultModelId ?? null
  }
  apiKeyValue.value = ''
  preservedCommand.value = null
  keychainService.value = null
  defaultModelIdStr.value =
    provider.defaultModelId ??
    modelsStore.items.find((m) => m.providerId === provider.id)?.modelId ??
    ''

  const spec = provider.apiKey
  if (!spec) {
    apiKeyKind.value = 'none'
  } else if (spec.kind === 'stored') {
    apiKeyKind.value = 'stored'
    keychainService.value = provider.apiKeyRef
    apiKeyValue.value = KEY_MASK
  } else if (spec.kind === 'env') {
    apiKeyKind.value = 'env'
    apiKeyValue.value = spec.envRef ?? ''
  } else if (spec.kind === 'command' && isKeychainCommand(spec.command)) {
    // Keychain !security … — NEVER dump the raw command into the value field
    apiKeyKind.value = 'keychain'
    preservedCommand.value = spec.command ?? null
    keychainService.value = keychainServiceName(spec.command)
    apiKeyValue.value = KEY_MASK
  } else if (spec.kind === 'command') {
    apiKeyKind.value = 'command'
    apiKeyValue.value = spec.command ?? ''
    preservedCommand.value = spec.command ?? null
  } else if (spec.kind === 'literal') {
    // Renderer never receives plaintext literals from main — echo mask
    apiKeyKind.value = 'literal'
    apiKeyValue.value = KEY_MASK
  } else {
    apiKeyKind.value = 'none'
  }
  timeoutStr.value = provider.timeout != null ? String(provider.timeout) : ''
  headersJson.value = JSON.stringify(provider.headers ?? {}, null, 2)
  dialogOpen.value = true
}

function buildApiKey(): ProviderForm['apiKey'] {
  const kind = apiKeyKind.value
  const raw = apiKeyValue.value.trim()
  const value = isMaskedKey(raw) ? '' : raw

  if (kind === 'none') return null

  if (kind === 'keychain') {
    if (value) return { kind: 'literal', literal: value }
    if (preservedCommand.value) return { kind: 'command', command: preservedCommand.value }
    return null
  }

  if (kind === 'stored') {
    if (value) return { kind: 'literal', literal: value }
    return { kind: 'stored' }
  }

  if (kind === 'literal') {
    if (!value) return isEditing.value ? { kind: 'literal', literal: '' } : null
    return { kind: 'literal', literal: value }
  }

  if (kind === 'env') {
    if (!value) return null
    return { kind: 'env', envRef: value }
  }

  // command
  if (!value) {
    if (preservedCommand.value) return { kind: 'command', command: preservedCommand.value }
    return null
  }
  return { kind: 'command', command: value.startsWith('!') ? value : `!${value}` }
}

async function save() {
  saving.value = true
  try {
    // Auto-fill key from displayName when creating and key left blank.
    // Preserve user casing — never force lowercase (nvapi-…, OpenAI, …).
    if (!isEditing.value && !form.value.key.trim()) {
      const fromName = suggestProviderKey(form.value.displayName || form.value.name)
      if (fromName) form.value.key = uniqueProviderKey(fromName)
    }
    if (!form.value.key.trim()) {
      toast.error(t('providers.keyRequired'))
      return
    }
    if (!form.value.displayName.trim()) {
      toast.error(t('providers.displayNameRequired'))
      return
    }
    let headers: Record<string, string> = {}
    try {
      const parsed = JSON.parse(headersJson.value || '{}') as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Headers must be a JSON object')
      }
      headers = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)])
      )
    } catch (e) {
      toast.error((e as Error).message || 'Invalid headers JSON')
      return
    }
    const timeoutTrim = timeoutStr.value.trim()
    const timeout = timeoutTrim
      ? (() => {
          const n = parseInt(timeoutTrim, 10)
          return Number.isFinite(n) && n > 0 ? n : null
        })()
      : null
    const normalized = normalizeProviderBaseUrl(form.value.baseUrl)
    if (normalized.changed) {
      form.value.baseUrl = normalized.url
      toast.info(t('providers.baseUrlNormalized'))
    }
    const payload: ProviderForm = {
      ...form.value,
      baseUrl: normalized.url,
      name: form.value.name || form.value.displayName || form.value.key,
      apiKey: buildApiKey(),
      headers,
      timeout,
      defaultModelId: defaultModelIdStr.value.trim() || null
    }
    if (isEditing.value && editingKey.value) {
      await providersStore.update(editingKey.value, payload)
      toast.success(t('providers.updated'))
    } else {
      await providersStore.create(payload)
      toast.success(t('providers.created'))
      if (payload.defaultModelId) {
        toast.info(t('providers.defaultModelCreated', { id: payload.defaultModelId }))
      } else {
        toast.info(t('providers.addModelHint'))
      }
    }
    dialogOpen.value = false
    await modelsStore.fetchList()
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    saving.value = false
  }
}

async function duplicateProvider() {
  if (!duplicatingProvider.value) return
  try {
    await providersStore.duplicate(duplicatingProvider.value.key)
    toast.success(t('providers.duplicated'))
    duplicateOpen.value = false
    duplicatingProvider.value = null
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

function confirmDuplicate(provider: ProviderProfile) {
  duplicatingProvider.value = provider
  duplicateOpen.value = true
}

function confirmDelete(provider: ProviderProfile) {
  deletingProvider.value = provider
  deleteOpen.value = true
}

async function doDelete() {
  if (!deletingProvider.value) return
  try {
    await providersStore.remove(deletingProvider.value.key)
    toast.success(t('providers.deleted'))
    deleteOpen.value = false
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function toggleEnabled(provider: ProviderProfile, enabled: boolean) {
  if (provider.enabled === enabled) return
  try {
    await providersStore.setEnabled(provider.key, enabled)
    if (enabled) {
      await modelsStore.fetchList()
      const active = modelsStore.active
      const label =
        active.providerKey && active.modelId
          ? `${active.providerKey}/${active.modelId}`
          : provider.displayName
      toast.success(t('providers.enabledWithModelToast', { name: provider.displayName, model: label }))
    } else {
      toast.success(t('providers.disabledToast', { name: provider.displayName }))
    }
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

function openTest(provider: ProviderProfile) {
  testingProvider.value = provider
  const firstModel = modelsStore.items.find((m) => m.providerId === provider.id)
  const active = modelsStore.active.providerKey === provider.key ? modelsStore.active.modelId : null
  testModelId.value = provider.defaultModelId || active || firstModel?.modelId || ''
  testResult.value = null
  testOpen.value = true
}

async function runTest() {
  if (!testingProvider.value) return
  testLoading.value = true
  testResult.value = null
  try {
    const result = await providersStore.testConnection(
      testingProvider.value.key,
      testModelId.value.trim() || undefined
    )
    testResult.value = result
    if (result.ok) toast.success(t('providers.testOk'))
    else toast.error(result.message)
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    testLoading.value = false
  }
}

function keyBadge(provider: ProviderProfile): string {
  const spec = provider.apiKey
  if (!spec) return t('providers.keyTypeNone')
  if (spec.kind === 'stored') return t('providers.keyTypeStored')
  if (spec.kind === 'env') return t('providers.keyTypeEnv')
  if (spec.kind === 'command' && isKeychainCommand(spec.command))
    return t('providers.keyTypeKeychain')
  if (spec.kind === 'command') return t('providers.keyTypeCommand')
  return t('providers.keyTypeLiteral')
}

function protocolLabel(protocol: string): string {
  return PROTOCOLS.find((p) => p.id === protocol)?.label ?? protocol
}

const filteredProviders = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return providersStore.items
  return providersStore.items.filter((p) => {
    return (
      p.displayName.toLowerCase().includes(q) ||
      p.key.toLowerCase().includes(q) ||
      (p.baseUrl ?? '').toLowerCase().includes(q) ||
      p.protocol.toLowerCase().includes(q)
    )
  })
})

onMounted(() => {
  void providersStore.fetchList()
  void modelsStore.fetchList()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Page header — compact, single line, page title + description on the
         left, search + primary action on the right. -->
    <header
      class="flex shrink-0 items-center justify-between gap-3 px-5 h-[var(--height-page-header)] border-b border-[var(--border-subtle)]"
    >
      <div class="min-w-0">
        <h1 class="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          {{ $t('providers.title') }}
        </h1>
        <p class="text-[11.5px] text-[var(--text-tertiary)] -mt-0.5">
          {{ $t('providers.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <SearchField
          v-model="query"
          :placeholder="$t('providers.filterPlaceholder')"
          class="w-[220px]"
        />
        <Button variant="primary" size="sm" @click="openCreate()">
          <Plus class="size-3.5" />
          {{ $t('providers.create') }}
        </Button>
      </div>
    </header>

    <!-- Presets as inline toolbar actions, not navigation tabs. -->
    <div
      v-if="PROVIDER_PRESETS.length > 0"
      class="flex shrink-0 items-center gap-1 px-5 h-[40px] border-b border-[var(--border-subtle)]"
    >
      <span
        class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)] pr-1"
      >
        {{ $t('providers.presetsLabel') }}
      </span>
      <button
        v-for="preset in PROVIDER_PRESETS.filter((p) => p.id !== 'custom')"
        :key="preset.id"
        type="button"
        class="inline-flex h-[26px] items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        @click="openCreate(preset.id)"
      >
        <Box class="size-3 text-[var(--text-tertiary)]" :stroke-width="1.75" />
        {{ preset.name }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto px-5 pt-4 pb-6 space-y-4">
      <div
        v-if="providersWithNoModels.length > 0"
        class="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--warning)]/30 bg-[var(--warning-tint)] px-3 py-2.5"
      >
        <Circle
          class="mt-0.5 size-2 shrink-0 fill-current text-[var(--warning)]"
          :stroke-width="0"
        />
        <div class="min-w-0 flex-1">
          <p class="text-[12px] font-medium text-[var(--text-primary)]">
            {{ $t('providers.zeroModelsTitle') }}
            <span
              class="ml-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-secondary)]"
            >
              ({{ providersWithNoModels.map((p) => p.key).join(', ') }})
            </span>
          </p>
          <p class="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">
            {{ $t('providers.zeroModelsHint') }}
          </p>
        </div>
        <Button variant="secondary" size="sm" @click="$router.push('/models')">
          {{ $t('providers.goAddModels') }}
        </Button>
      </div>

      <div
        v-if="providersStore.loading"
        class="py-12 text-center text-[11.5px] text-[var(--text-tertiary)]"
      >
        {{ $t('common.loading') }}
      </div>

      <EmptyState
        v-else-if="providersStore.items.length === 0"
        :title="$t('providers.empty')"
        :description="$t('providers.emptyHint')"
        :icon="Box"
      >
        <Button variant="primary" size="sm" class="mt-3" @click="openCreate()">
          {{ $t('providers.createShort') }}
        </Button>
      </EmptyState>

      <EmptyState
        v-else-if="filteredProviders.length === 0"
        :title="$t('providers.filterEmpty')"
        :description="$t('providers.filterEmptyHint')"
        :icon="Search"
      />

      <!-- One parent grid + subgrid rows: shared tracks, reserved action column. -->
      <div
        v-else
        class="rounded-[var(--radius-md)] border border-[var(--border-subtle)] overflow-hidden"
      >
        <div class="grid gap-x-3" :style="listGrid">
          <div
            class="col-span-full grid grid-cols-subgrid items-center px-3 h-[30px] text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)] border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]"
          >
            <span class="min-w-0 truncate">{{ $t('providers.colName') }}</span>
            <span class="min-w-0 truncate">{{ $t('providers.colProtocol') }}</span>
            <span class="tabular-nums">{{ $t('providers.colModels') }}</span>
            <span class="min-w-0 truncate">{{ $t('providers.colKey') }}</span>
            <span>{{ $t('providers.colEnabled') }}</span>
            <span class="min-w-0 truncate">{{ $t('providers.colUpdated') }}</span>
            <span />
          </div>

          <div
            v-for="provider in filteredProviders"
            :key="provider.id"
            class="group relative col-span-full grid grid-cols-subgrid items-center px-3 overflow-hidden border-b border-[var(--border-subtle)] last:border-b-0 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--bg-hover)]"
            :style="{ height: 'var(--height-row)' }"
          >
            <span
              v-if="provider.enabled"
              class="pointer-events-none absolute left-0 top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
            />

            <div class="min-w-0 overflow-hidden">
              <div
                class="truncate whitespace-nowrap text-[13px] font-medium leading-tight text-[var(--text-primary)]"
                :title="provider.displayName"
              >
                {{ provider.displayName }}
              </div>
              <div
                class="truncate whitespace-nowrap font-[family-name:var(--font-mono)] text-[10.5px] leading-tight text-[var(--text-tertiary)]"
                :title="provider.baseUrl || $t('common.unknown')"
              >
                {{ provider.baseUrl || $t('common.unknown') }}
              </div>
            </div>

            <div
              class="min-w-0 truncate whitespace-nowrap text-[12px] text-[var(--text-secondary)]"
              :title="protocolLabel(provider.protocol)"
            >
              {{ protocolLabel(provider.protocol) }}
            </div>

            <div class="tabular-nums text-[12px] text-[var(--text-secondary)]">
              {{ provider.modelCount }}
            </div>

            <div class="min-w-0 overflow-hidden">
              <Badge tone="muted" class="max-w-full truncate" :title="keyBadge(provider)">
                {{ keyBadge(provider) }}
              </Badge>
            </div>

            <div class="flex items-center">
              <Switch
                :model-value="provider.enabled"
                :label="$t('providers.colEnabled')"
                @update:model-value="(v) => toggleEnabled(provider, v)"
              />
            </div>

            <div
              class="min-w-0 truncate whitespace-nowrap text-[11.5px] text-[var(--text-tertiary)]"
              :title="formatRelativeTime(provider.updatedAt, locale === 'zh-CN' ? 'zh-CN' : 'en-US')"
            >
              {{ formatRelativeTime(provider.updatedAt, locale === 'zh-CN' ? 'zh-CN' : 'en-US') }}
            </div>

            <div
              class="flex w-full items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            >
              <IconButton :label="$t('providers.testAction')" @click="openTest(provider)">
                <Zap class="size-3.5" :stroke-width="1.75" />
              </IconButton>
              <IconButton :label="$t('common.edit')" @click="openEdit(provider)">
                <Pencil class="size-3.5" :stroke-width="1.75" />
              </IconButton>
              <IconButton :label="$t('common.duplicate')" @click="confirmDuplicate(provider)">
                <Copy class="size-3.5" :stroke-width="1.75" />
              </IconButton>
              <IconButton
                variant="danger"
                :label="$t('common.delete')"
                @click="confirmDelete(provider)"
              >
                <Trash2 class="size-3.5" :stroke-width="1.75" />
              </IconButton>
            </div>
          </div>
        </div>
      </div>
      <p
        v-if="providersStore.items.length > 0"
        class="px-1 text-[11.5px] text-[var(--text-tertiary)]"
      >
        {{ $t('providers.exclusiveEnabledHint') }}
      </p>
    </div>

    <Dialog
      v-model:open="dialogOpen"
      :title="isEditing ? $t('providers.edit') : $t('providers.create')"
      wide
    >
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <Input
            v-model="form.key"
            :label="$t('providers.fieldKey')"
            placeholder="my-provider"
            :disabled="isEditing"
            mono
          />
          <Input v-model="form.displayName" :label="$t('providers.fieldDisplayName')" />
        </div>
        <Input v-model="form.name" :label="$t('providers.fieldInternalName')" />
        <Select
          v-model="form.protocol"
          :label="$t('providers.fieldProtocol')"
          :options="protocolOptions"
        />
        <Input
          v-model="form.baseUrl"
          :label="$t('providers.fieldBaseUrl')"
          placeholder="https://api.example.com/v1"
          :hint="baseUrlHint"
          mono
          @blur="onBaseUrlBlur"
        />
        <Select
          v-model="apiKeyKind"
          :label="$t('providers.fieldApiKeyType')"
          :options="apiKeyTypeOptions"
        />

        <div
          v-if="showKeychainPanel"
          class="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        >
          <p class="text-[12px] text-[var(--text-secondary)]">
            <template v-if="apiKeyKind === 'keychain'">
              {{ $t('providers.keychainBound') }}
              <code
                v-if="keychainService"
                class="ml-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--accent)]"
              >
                {{ keychainService }}
              </code>
            </template>
            <template v-else>{{ $t('providers.storedHint') }}</template>
          </p>
          <Input
            v-model="apiKeyValue"
            :label="$t('providers.fieldApiKeyValue')"
            :placeholder="apiKeyPlaceholder"
            type="password"
            mono
            autocomplete="off"
            @focus="clearKeyMask"
          />
        </div>

        <template v-else-if="showApiKeyInput">
          <Input
            v-model="apiKeyValue"
            :label="$t('providers.fieldApiKeyValue')"
            :placeholder="apiKeyPlaceholder"
            :type="apiKeyKind === 'literal' ? 'password' : 'text'"
            mono
            autocomplete="off"
            @focus="apiKeyKind === 'literal' ? clearKeyMask() : undefined"
          />
          <p v-if="apiKeyKind === 'command'" class="text-[11px] text-[var(--text-tertiary)]">
            {{ $t('providers.commandHint') }}
          </p>
        </template>

        <Input
          v-model="defaultModelIdStr"
          :label="$t('providers.fieldDefaultModel')"
          :placeholder="$t('providers.defaultModelPlaceholder')"
          :hint="$t('providers.defaultModelHint')"
          mono
        />

        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[12px] text-[var(--text-secondary)]">{{ $t('common.enabled') }}</div>
            <p class="mt-0.5 text-[10.5px] text-[var(--text-tertiary)]">
              {{ $t('providers.exclusiveEnabledHint') }}
            </p>
          </div>
          <Switch v-model="form.enabled" :label="$t('common.enabled')" />
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-[12px] text-[var(--text-secondary)]">{{
            $t('providers.fieldAuthHeader')
          }}</span>
          <Switch v-model="form.authHeader" :label="$t('providers.fieldAuthHeader')" />
        </div>
        <Input
          v-model="timeoutStr"
          :label="$t('providers.fieldTimeout')"
          placeholder="15000"
          mono
        />
        <Textarea
          v-model="headersJson"
          :label="$t('providers.fieldHeaders')"
          :placeholder="headersPlaceholder"
          :hint="$t('providers.headersHint')"
          :rows="3"
          mono
        />
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
      v-model:open="duplicateOpen"
      :title="$t('providers.duplicateTitle')"
      :description="
        $t('providers.duplicateConfirm', { name: duplicatingProvider?.displayName ?? '' })
      "
    >
      <template #footer>
        <Button variant="ghost" @click="duplicateOpen = false">
          {{ $t('common.cancel') }}
        </Button>
        <Button variant="primary" @click="duplicateProvider">
          {{ $t('providers.duplicateAction') }}
        </Button>
      </template>
    </Dialog>

    <Dialog
      v-model:open="deleteOpen"
      :title="$t('providers.deleteTitle')"
      :description="$t('providers.deleteConfirm', { name: deletingProvider?.displayName ?? '' })"
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
      :description="testingProvider ? testingProvider.key : undefined"
    >
      <div class="space-y-3">
        <Input
          v-model="testModelId"
          :label="$t('providers.testModelId')"
          :placeholder="testingProvider?.defaultModelId || 'gpt-4o'"
          :hint="$t('providers.testModelHint')"
          mono
        />
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
