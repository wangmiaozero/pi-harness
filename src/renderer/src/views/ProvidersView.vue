<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onDeactivated, onMounted, provide, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  Plus,
  Pencil,
  Copy,
  Trash2,
  Zap,
  Box,
  Cpu,
  Gauge,
  Search,
  Circle,
  Sparkles,
  RefreshCw,
  Eye,
  EyeOff,
  ChevronRight,
  Network,
  UserRound
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { getApi } from '@renderer/composables/useApi'
import type {
  ProviderProfile,
  ConnectionTestResult,
  DiscoveredProviderModel
} from '@shared/ipc/api-types'
import type { ProviderForm } from '@shared/schemas/domain'
import { PROTOCOLS, PROVIDER_PRESETS, type ProviderPreset } from '@shared/constants/protocols'
import { findProviderPreset } from '@shared/constants/provider-presets'
import { isKeychainCommand, keychainServiceName } from '@shared/utils/api-key'
import {
  isMissingModelCatalogMessage,
  normalizeProviderBaseUrl,
  volcenginePlanKind
} from '@shared/utils/base-url'
import { isLocalOllamaEndpoint } from '@shared/providers/local-ollama'
import { providerIdentityUrlReady, suggestProviderIdentity } from '@shared/utils/provider-identity'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import Button from '@renderer/components/ui/Button.vue'
import { flatButtonStyle } from '@renderer/components/ui/button-style'
import Input from '@renderer/components/ui/Input.vue'
import Textarea from '@renderer/components/ui/Textarea.vue'
import ProviderAdvancedFields from '@renderer/components/providers/ProviderAdvancedFields.vue'
import ProviderConnectionDetails from '@renderer/components/providers/ProviderConnectionDetails.vue'
import LocalGatewayDialog from '@renderer/components/providers/LocalGatewayDialog.vue'
import {
  advancedProviderDraft,
  parseAdvancedProviderDraft
} from '@renderer/components/providers/advanced-provider-draft'
import Select from '@renderer/components/ui/Select.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import SearchField from '@renderer/components/ui/SearchField.vue'
import Combobox from '@renderer/components/ui/Combobox.vue'
import { useProvidersStore } from '@renderer/stores/providers'
import { useModelsStore } from '@renderer/stores/models'
import { useChatGptAccounts } from '@renderer/stores/chatgpt-accounts'
import type { AddCatalogSubscriptionId } from '@shared/providers/add-catalog'
import AddProviderCatalog from '@renderer/components/providers/AddProviderCatalog.vue'
import ProviderMark from '@renderer/components/providers/ProviderMark.vue'
import { useChatGptAccountSummaries } from '@renderer/components/providers/use-chatgpt-account-summaries'
import ModelsView from './ModelsView.vue'
import { formatRelativeTime } from '@renderer/utils/format'
import {
  apiKeyKindsForPlatform,
  rendererPlatformHint,
  type ApiKeyUiKind
} from '@renderer/utils/provider-credentials'

/** Sentinel shown in the password field when a secret already exists (never submitted as a real key). */
const KEY_MASK = '••••••••••••••••'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const providersStore = useProvidersStore()
const modelsStore = useModelsStore()
provide(flatButtonStyle, true)

const ProviderUsagePanel = defineAsyncComponent(
  () => import('@renderer/components/providers/ProviderUsagePanel.vue')
)
const section = ref<'providers' | 'usage'>('providers')
const modelScope = ref<string | null>(null)
const modelCreate = ref(false)

function openSection(value: typeof section.value) {
  section.value = value
  modelScope.value = null
}

function openModels(provider = 'all', create = false) {
  section.value = 'providers'
  modelCreate.value = create
  modelScope.value = provider
}
const catalogOpen = ref(false)
const catalogAddOnly = ref(true)
const catalogDetail = ref<AddCatalogSubscriptionId | null>(null)
const catalogAccountId = ref<string>()
const catalogQuery = ref('')
const chatGptAccounts = useChatGptAccounts()
const chatGptSummaries = useChatGptAccountSummaries()
const subscriptionShortcuts = [
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'claude', name: 'Claude' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'gateway', name: null }
] as const
const configuredCatalogIds = computed(() => [
  ...providersStore.items.flatMap((provider) => [
    provider.key,
    findProviderPreset({
      key: provider.key,
      baseUrl: provider.baseUrl,
      protocol: provider.protocol
    })?.id ?? provider.key
  ]),
  ...(chatGptAccounts.items.length > 0 ? ['chatgpt'] : [])
])
onDeactivated(() => {
  section.value = 'providers'
  modelScope.value = null
})

const dialogOpen = ref(false)
const gatewayOpen = ref(false)
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
let testGeneration = 0
let testRequestId: string | undefined
let draftRequestId: string | undefined
const draftTestResult = ref<ConnectionTestResult | null>(null)
const draftTesting = ref(false)
const saving = ref(false)
const saveError = ref('')
const timeoutStr = ref('')
const headersJson = ref('')
const advancedDraft = ref(advancedProviderDraft())
const defaultModelIdStr = ref('')
const query = ref('')
const activePreset = ref<ProviderPreset | null>(null)
const identityPreset = ref<ProviderPreset | null>(null)
const advancedProviderOptions = ref(false)
const hasPresetEndpoint = computed(() => !!activePreset.value?.defaultBaseUrl)
const showProviderOptions = computed(
  () => !hasPresetEndpoint.value || advancedProviderOptions.value
)
const platform = ref(
  rendererPlatformHint(typeof navigator === 'undefined' ? undefined : navigator.platform)
)
const discoveredModels = ref<DiscoveredProviderModel[]>([])
const discoveredSource = ref('')
const discoveringModels = ref(false)
type ModelDiscoveryFeedbackKind = 'loading' | 'success' | 'empty' | 'error'
const modelDiscoveryFeedback = ref<{
  kind: ModelDiscoveryFeedbackKind
  message: string
  source: string
} | null>(null)

/** Share column widths across rows; leave room for the name and its icon. */
const listGrid = {
  gridTemplateColumns:
    'minmax(10rem, 1fr) minmax(9rem, max-content) max-content max-content max-content minmax(14.5rem, max-content)'
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
const customLocalAuth = ref(false)
const savedLocalNoAuth = ref(false)
const apiKeyRevealed = ref(false)
const copyingApiKey = ref(false)
/** Preserved !command / keychain binding when editing — never shown as plaintext secret. */
const preservedCommand = ref<string | null>(null)
const keychainService = ref<string | null>(null)

const protocolOptions = computed(() => PROTOCOLS.map((p) => ({ value: p.id, label: p.label })))
const currentDiscoveredModels = computed(() =>
  discoveredSource.value === modelDiscoverySource() ? discoveredModels.value : []
)
const visibleModelDiscoveryFeedback = computed(() => {
  const feedback = modelDiscoveryFeedback.value
  return feedback?.source === modelDiscoverySource() ? feedback : null
})
const modelDiscoveryFeedbackClass = computed(() => {
  switch (visibleModelDiscoveryFeedback.value?.kind) {
    case 'success':
      return 'text-[var(--success)]'
    case 'error':
      return 'text-[var(--error)]'
    case 'empty':
      return 'text-[var(--warning)]'
    default:
      return 'text-[var(--text-tertiary)]'
  }
})
const modelOptions = computed(() => {
  const options = new Map<string, { value: string; label: string; hint?: string }>()
  for (const model of (identityPreset.value ?? activePreset.value)?.models ?? []) {
    options.set(model.id, {
      value: model.id,
      label: model.name,
      hint: model.contextWindow
        ? t('providers.modelContext', { count: model.contextWindow.toLocaleString() })
        : undefined
    })
  }
  for (const model of modelsStore.items.filter((item) => item.providerId === editingKey.value)) {
    if (!options.has(model.modelId)) {
      options.set(model.modelId, {
        value: model.modelId,
        label: model.displayName,
        hint: t('providers.existingModelHint')
      })
    }
  }
  for (const model of currentDiscoveredModels.value) {
    if (!options.has(model.id)) {
      options.set(model.id, {
        value: model.id,
        label: model.name,
        hint: t('providers.discoveredModelHint')
      })
    }
  }
  return [...options.values()]
})
const selectedDefaultModel = computed(() => {
  const id = defaultModelIdStr.value.trim()
  const preset =
    identityPreset.value?.models.find((model) => model.id === id) ??
    activePreset.value?.models.find((model) => model.id === id)
  if (preset) return preset
  const existing = modelsStore.items.find(
    (model) => model.providerId === editingKey.value && model.modelId === id
  )
  if (existing) {
    return {
      id,
      name: existing.displayName,
      contextWindow: existing.contextWindow,
      maxOutputTokens: existing.maxOutputTokens,
      input: existing.vision ? (['text', 'image'] as const) : (['text'] as const)
    }
  }
  const discovered = currentDiscoveredModels.value.find((model) => model.id === id)
  return discovered ? { ...discovered, contextWindow: null, maxOutputTokens: null } : undefined
})

const apiKeyTypeOptions = computed(() => {
  const labels: Record<ApiKeyUiKind, string> = {
    none: t('providers.keyTypeNone'),
    literal: t('providers.keyTypeLiteral'),
    env: t('providers.keyTypeEnv'),
    command: t('providers.keyTypeCommand'),
    keychain: t('providers.keyTypeKeychain'),
    stored: t('providers.keyTypeStored')
  }
  return apiKeyKindsForPlatform(platform.value).map((value) => ({ value, label: labels[value] }))
})

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

const keylessLocalOllama = computed(() => {
  if (!isLocalOllamaEndpoint(form.value.baseUrl) || customLocalAuth.value) return false
  try {
    if (
      Object.keys(JSON.parse(headersJson.value || '{}')).some((name) =>
        /^(authorization|x-api-key|api-key)$/i.test(name)
      )
    )
      return false
  } catch {
    return false
  }
  return (
    savedLocalNoAuth.value ||
    apiKeyKind.value === 'none' ||
    (apiKeyKind.value === 'literal' && !hasSavedSecret.value && !apiKeyValue.value.trim())
  )
})

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

function configureLocalAuth() {
  advancedProviderOptions.value = true
  customLocalAuth.value = true
  apiKeyKind.value = 'literal'
  form.value.authHeader = true
}

function clearApiKeyReveal() {
  apiKeyRevealed.value = false
}

function toggleApiKeyReveal() {
  if (apiKeyValue.value && !isMaskedKey(apiKeyValue.value))
    apiKeyRevealed.value = !apiKeyRevealed.value
}

async function copySavedApiKey() {
  if (!editingKey.value || !hasSavedSecret.value || copyingApiKey.value) return
  copyingApiKey.value = true
  try {
    await getApi().providers.copyApiKey(editingKey.value)
    toast.success(t('diagnostics.copied'))
  } catch {
    toast.error(t('providers.keyRevealFailed'))
  } finally {
    copyingApiKey.value = false
  }
}

watch(apiKeyKind, clearApiKeyReveal)

let identityTimer: ReturnType<typeof setTimeout> | null = null
let appliedIdentityUrl = ''
let seededIdentity: { key: string; displayName: string; name: string } | null = null
let generatedIdentity: { key: string; displayName: string; name: string } | null = null
let generatedModelId: string | null = null

function identitySnapshot(): { key: string; displayName: string; name: string } {
  return {
    key: form.value.key,
    displayName: form.value.displayName,
    name: form.value.name
  }
}

function sameIdentity(
  left: { key: string; displayName: string; name: string } | null,
  right: { key: string; displayName: string; name: string } | null
): boolean {
  return (
    !!left &&
    !!right &&
    left.key === right.key &&
    left.displayName === right.displayName &&
    left.name === right.name
  )
}

function identityUntouched(): boolean {
  const current = identitySnapshot()
  return sameIdentity(current, seededIdentity) || sameIdentity(current, generatedIdentity)
}

function rememberSeededIdentity(): void {
  seededIdentity = identitySnapshot()
  generatedIdentity = null
  appliedIdentityUrl = ''
  generatedModelId = null
  identityPreset.value = null
}

function recognizedPreset(baseUrl: string, key: string): ProviderPreset | undefined {
  const byUrl =
    findProviderPreset({ baseUrl, protocol: form.value.protocol }) ?? findProviderPreset({ baseUrl })
  if (byUrl && !byUrl.id.endsWith('-compatible')) return byUrl
  return PROVIDER_PRESETS.find((preset) => preset.id === key && preset.defaultModelId.trim())
}

function canFillModelId(): boolean {
  const current = defaultModelIdStr.value.trim()
  return current === '' || current === generatedModelId
}

watch(dialogOpen, (open) => {
  if (!open) {
    if (draftRequestId) void cancelTest(draftRequestId)
    draftRequestId = undefined
    draftTesting.value = false
    draftTestResult.value = null
    clearApiKeyReveal()
    if (identityTimer) clearTimeout(identityTimer)
    identityTimer = null
    appliedIdentityUrl = ''
    seededIdentity = null
    generatedIdentity = null
    generatedModelId = null
    identityPreset.value = null
  }
})

function applyProviderIdentity(manual: boolean): void {
  const normalized = normalizeProviderBaseUrl(form.value.baseUrl)
  const suggestion = suggestProviderIdentity(normalized.url)
  if (!suggestion) {
    if (manual) toast.error(t('providers.identityInvalidUrl'))
    return
  }
  const preset = recognizedPreset(normalized.url, suggestion.key)
  const { key, displayName } = newProviderIdentity(
    preset?.id ?? suggestion.key,
    preset?.name ?? suggestion.displayName
  )
  const name = preset?.id ?? suggestion.internalName
  const modelId = preset?.defaultModelId.trim() || preset?.models[0]?.id || ''
  const same =
    form.value.baseUrl === normalized.url &&
    form.value.key === key &&
    form.value.displayName === displayName &&
    form.value.name === name
  if (!manual && !identityUntouched()) return
  if (manual || (normalized.url !== appliedIdentityUrl && !same)) {
    form.value.baseUrl = normalized.url
    form.value.key = key
    form.value.displayName = displayName
    form.value.name = name
    generatedIdentity = { key, displayName, name }
    appliedIdentityUrl = normalized.url
    toast.success(t('providers.identityGenerated'))
  } else {
    appliedIdentityUrl = normalized.url
  }
  identityPreset.value = preset ?? null
  if (modelId && canFillModelId()) {
    generatedModelId = modelId
    defaultModelIdStr.value = modelId
  }
}

watch(
  () => form.value.baseUrl,
  () => {
    scheduleProviderIdentity()
  }
)

function scheduleProviderIdentity(): void {
  if (identityTimer) clearTimeout(identityTimer)
  identityTimer = null
  if (isEditing.value || !providerIdentityUrlReady(form.value.baseUrl)) return
  identityTimer = setTimeout(() => {
    identityTimer = null
    if (!isEditing.value && providerIdentityUrlReady(form.value.baseUrl)) {
      applyProviderIdentity(false)
    }
  }, 400)
}

function onBaseUrlBlur() {
  const r = normalizeProviderBaseUrl(form.value.baseUrl)
  if (r.changed) {
    form.value.baseUrl = r.url
    toast.info(t('providers.baseUrlNormalized'))
  }
  if (identityTimer) clearTimeout(identityTimer)
  identityTimer = null
  if (!isEditing.value && providerIdentityUrlReady(form.value.baseUrl)) applyProviderIdentity(false)
}

function modelDiscoverySource(): string {
  return `${form.value.protocol}\0${normalizeProviderBaseUrl(form.value.baseUrl).url}`
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
  const existing = new Set(
    providersStore.items.filter((p) => p.key !== editingKey.value).map((p) => p.key)
  )
  let key = base
  for (let i = 2; existing.has(key); i++) {
    const suffix = `-${i}`
    key = `${base.slice(0, 128 - suffix.length)}${suffix}`
  }
  return key
}

function newProviderIdentity(baseKey: string, name: string) {
  const key = uniqueProviderKey(baseKey)
  const displayName = key === baseKey ? name : `${name} ${key.slice(key.lastIndexOf('-') + 1)}`
  return { key, displayName }
}

function openCreate(presetId?: string) {
  advancedProviderOptions.value = false
  editingKey.value = null
  form.value = defaultForm()
  customLocalAuth.value = false
  savedLocalNoAuth.value = false
  apiKeyKind.value = 'none'
  apiKeyValue.value = ''
  preservedCommand.value = null
  keychainService.value = null
  timeoutStr.value = ''
  headersJson.value = ''
  advancedDraft.value = advancedProviderDraft()
  defaultModelIdStr.value = ''
  discoveredModels.value = []
  discoveredSource.value = ''
  modelDiscoveryFeedback.value = null
  saveError.value = ''
  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)
  activePreset.value = preset ?? null
  if (preset) {
    form.value.protocol = preset.protocol
    form.value.baseUrl = preset.defaultBaseUrl
    form.value.authHeader = preset.authHeader
    form.value.name = preset.id
    // Prefill key so save never hits empty-key validation. Keep preset id casing.
    Object.assign(form.value, newProviderIdentity(suggestProviderKey(preset.id), preset.name))
    if (preset.placeholderApiKey) {
      apiKeyKind.value = 'literal'
      // Placeholder only — user replaces with real secret (e.g. nvapi-…).
      apiKeyValue.value = ''
    }
    defaultModelIdStr.value = preset.defaultModelId || preset.models[0]?.id || ''
  }
  rememberSeededIdentity()
  dialogOpen.value = true
}

function openCatalog(detail: AddCatalogSubscriptionId | null = null, accountId?: string) {
  catalogQuery.value = ''
  catalogAddOnly.value = detail === null
  catalogDetail.value = detail
  catalogAccountId.value = accountId
  catalogOpen.value = true
}

function setCatalogDetail(detail: AddCatalogSubscriptionId | null) {
  catalogDetail.value = detail
  if (detail === null) catalogAddOnly.value = true
  if (detail !== 'chatgpt') catalogAccountId.value = undefined
}

function chooseCatalogPreset(presetId: string) {
  catalogOpen.value = false
  openCreate(presetId)
}

async function finishAccountAddition() {
  catalogOpen.value = false
  await Promise.all([providersStore.fetchList(), modelsStore.fetchList()])
  toast.success(t('providers.created'))
}

function editCatalogProvider(key: string) {
  if (catalogAddOnly.value) return
  catalogOpen.value = false
  const provider = providersStore.items.find((item) => item.key === key)
  if (provider) openEdit(provider)
}

async function openPresetKeyPage(url: string) {
  await getApi()
    .system.openExternal(url)
    .catch(() => toast.error(t('common.failed')))
}

function openEdit(provider: ProviderProfile) {
  advancedProviderOptions.value = false
  editingKey.value = provider.key
  customLocalAuth.value = false
  savedLocalNoAuth.value = provider.localNoAuth === true
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
  activePreset.value =
    findProviderPreset({
      key: provider.key,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl
    }) ?? null
  discoveredModels.value = []
  discoveredSource.value = ''
  modelDiscoveryFeedback.value = null
  saveError.value = ''

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
  } else if (
    platform.value === 'darwin' &&
    spec.kind === 'command' &&
    isKeychainCommand(spec.command)
  ) {
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
  advancedDraft.value = advancedProviderDraft(provider.advanced)
  rememberSeededIdentity()
  dialogOpen.value = true
}

function buildApiKey(): ProviderForm['apiKey'] {
  if (keylessLocalOllama.value) return null
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

function parseHeadersJson(): Record<string, string> {
  const parsed = JSON.parse(headersJson.value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(t('providers.headersObjectRequired'))
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)])
  )
}

function parseTimeout(): number | null {
  const raw = timeoutStr.value.trim()
  if (!raw) return null
  const timeout = Number.parseInt(raw, 10)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : null
}

function showModelCatalogHint(source: string) {
  const plan = volcenginePlanKind(form.value.baseUrl)
  const message =
    plan === 'agent-plan'
      ? t('providers.modelsDiscoveryAgentPlan')
      : plan === 'coding-plan'
        ? t('providers.modelsDiscoveryCodingPlan')
        : form.value.protocol === 'anthropic-messages'
          ? t('providers.modelsDiscoveryNoCatalog')
          : t('providers.modelsDiscoveryEmpty')
  modelDiscoveryFeedback.value = { kind: 'empty', message, source }
  toast.info(message)
}

async function discoverProviderModels() {
  const normalized = normalizeProviderBaseUrl(form.value.baseUrl)
  form.value.baseUrl = normalized.url
  const source = modelDiscoverySource()
  discoveringModels.value = true
  discoveredModels.value = []
  discoveredSource.value = source
  modelDiscoveryFeedback.value = {
    kind: 'loading',
    message: t('providers.modelsDiscovering'),
    source
  }
  try {
    const models = await providersStore.discoverModels({
      existingProviderKey: editingKey.value,
      protocol: form.value.protocol,
      baseUrl: normalized.url,
      apiKey: buildApiKey(),
      headers: parseHeadersJson(),
      authHeader: form.value.authHeader,
      advanced: parseAdvancedProviderDraft(advancedDraft.value),
      timeout: parseTimeout()
    })
    discoveredModels.value = models
    discoveredSource.value = source
    if (models.length === 0) {
      showModelCatalogHint(source)
      return
    }
    if (!defaultModelIdStr.value.trim()) defaultModelIdStr.value = models[0]?.id ?? ''
    const message = t('providers.modelsReadyToImport', { count: models.length })
    modelDiscoveryFeedback.value = { kind: 'success', message, source }
    toast.success(t('providers.modelsDiscovered', { count: models.length }))
  } catch (error) {
    const detail = (error as { message?: string }).message ?? t('providers.modelsDiscoveryFailed')
    if (
      form.value.protocol === 'anthropic-messages' &&
      (volcenginePlanKind(normalized.url) || isMissingModelCatalogMessage(detail))
    ) {
      showModelCatalogHint(source)
      return
    }
    const message = t('providers.modelsDiscoveryError', { message: detail })
    modelDiscoveryFeedback.value = { kind: 'error', message, source }
    toast.error(message)
  } finally {
    discoveringModels.value = false
  }
}

async function cancelTest(requestId: string | undefined) {
  if (!requestId) return
  try {
    await getApi().providers.cancelConnectionTest(requestId)
  } catch {
    toast.error(t('common.failed'))
  }
}

watch(testOpen, (open) => {
  if (!open && testRequestId) void cancelTest(testRequestId)
})

async function testDraft() {
  if (draftTesting.value) return
  draftTesting.value = true
  draftTestResult.value = null
  const requestId = crypto.randomUUID()
  draftRequestId = requestId
  try {
    const result = await getApi().providers.testConnection({
      requestId,
      modelId: defaultModelIdStr.value.trim(),
      draft: {
        existingProviderKey: editingKey.value,
        protocol: form.value.protocol,
        baseUrl: normalizeProviderBaseUrl(form.value.baseUrl).url,
        apiKey: buildApiKey(),
        headers: parseHeadersJson(),
        authHeader: form.value.authHeader,
        advanced: parseAdvancedProviderDraft(advancedDraft.value),
        timeout: parseTimeout()
      }
    })
    if (draftRequestId !== requestId) return
    draftTestResult.value = result
    if (result.ok) toast.success(t('providers.testOk'))
    else if (result.status !== 'cancelled')
      toast.error(t(`providerDiagnostics.hints.${result.status}`))
  } catch {
    if (draftRequestId === requestId) toast.error(t('providerAccounts.actionFailed'))
  } finally {
    if (draftRequestId === requestId) {
      draftRequestId = undefined
      draftTesting.value = false
    }
  }
}

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    // Auto-fill key from displayName when creating and key left blank.
    // Preserve user casing — never force lowercase (nvapi-…, OpenAI, …).
    if (!isEditing.value && !form.value.key.trim()) {
      const fromName = suggestProviderKey(form.value.displayName || form.value.name)
      if (fromName) form.value.key = uniqueProviderKey(fromName)
    }
    const nextKey = form.value.key.trim()
    if (!nextKey) {
      saveError.value = t('providers.keyRequired')
      toast.error(saveError.value)
      return
    }
    const keyTaken = providersStore.items.some(
      (p) => p.key === nextKey && p.key !== editingKey.value
    )
    if (keyTaken) {
      saveError.value = t('providers.keyExists', { key: nextKey })
      toast.error(saveError.value)
      return
    }
    if (!form.value.displayName.trim()) {
      saveError.value = t('providers.displayNameRequired')
      toast.error(saveError.value)
      return
    }
    let headers: Record<string, string> = {}
    try {
      headers = parseHeadersJson()
    } catch (e) {
      saveError.value = (e as Error).message || 'Invalid headers JSON'
      toast.error(saveError.value)
      return
    }
    const timeout = parseTimeout()
    const normalized = normalizeProviderBaseUrl(form.value.baseUrl)
    if (normalized.changed) {
      form.value.baseUrl = normalized.url
      toast.info(t('providers.baseUrlNormalized'))
    }
    const payload: ProviderForm = {
      ...form.value,
      key: nextKey,
      baseUrl: normalized.url,
      name: form.value.name || form.value.displayName || nextKey,
      apiKey: buildApiKey(),
      headers,
      advanced: parseAdvancedProviderDraft(advancedDraft.value),
      timeout,
      defaultModelId: defaultModelIdStr.value.trim() || null,
      defaultModel: selectedDefaultModel.value
        ? {
            id: selectedDefaultModel.value.id,
            name: selectedDefaultModel.value.name,
            contextWindow: selectedDefaultModel.value.contextWindow ?? null,
            maxOutputTokens: selectedDefaultModel.value.maxOutputTokens ?? null,
            input: selectedDefaultModel.value.input
              ? [...selectedDefaultModel.value.input]
              : undefined
          }
        : null,
      // Electron IPC cannot structured-clone Vue reactive proxies. Build an
      // explicit plain snapshot before crossing the preload boundary.
      discoveredModels: currentDiscoveredModels.value.map((model) => ({
        id: model.id,
        name: model.name,
        input: model.input ? [...model.input] : undefined
      }))
    }
    if (isEditing.value && editingKey.value) {
      const updated = await providersStore.update(editingKey.value, payload)
      if (!updated) {
        saveError.value = t('providers.saveCancelled')
        return
      }
      toast.success(t('providers.updated'))
    } else {
      const created = await providersStore.create(payload)
      if (!created) {
        saveError.value = t('providers.saveCancelled')
        return
      }
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
    saveError.value = (e as { message?: string }).message ?? t('common.failed')
    toast.error(saveError.value)
  } finally {
    saving.value = false
  }
}

const switchingGateway = ref<string | null>(null)
async function setGateway(provider: ProviderProfile, enabled: boolean) {
  switchingGateway.value = provider.key
  try {
    await providersStore.setGateway(provider.key, enabled)
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    switchingGateway.value = null
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

function openTest(provider: ProviderProfile) {
  testGeneration++
  testLoading.value = false
  testingProvider.value = provider
  const firstModel = modelsStore.items.find((m) => m.providerId === provider.id)
  const active = modelsStore.active.providerKey === provider.key ? modelsStore.active.modelId : null
  testModelId.value = provider.defaultModelId || active || firstModel?.modelId || ''
  testResult.value = null
  testOpen.value = true
}

async function runTest() {
  if (!testingProvider.value || testLoading.value) return
  const generation = ++testGeneration
  const requestId = crypto.randomUUID()
  testRequestId = requestId
  testLoading.value = true
  testResult.value = null
  try {
    const result = await providersStore.testConnection(
      testingProvider.value.key,
      testModelId.value.trim() || undefined,
      requestId
    )
    if (generation !== testGeneration || !testOpen.value) return
    testResult.value = result
    if (result.ok) toast.success(t('providers.testOk'))
    else if (result.status !== 'cancelled')
      toast.error(t(`providerDiagnostics.hints.${result.status}`))
  } catch (e) {
    if (generation === testGeneration && testOpen.value)
      toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    if (testRequestId === requestId) testRequestId = undefined
    if (generation === testGeneration) testLoading.value = false
  }
}

function keyBadge(provider: ProviderProfile): string {
  if (provider.localNoAuth) return t('providers.noKeyRequired')
  const spec = provider.apiKey
  if (!spec) return t('providers.keyTypeNone')
  if (spec.kind === 'stored') return t('providers.keyTypeStored')
  if (spec.kind === 'env') return t('providers.keyTypeEnv')
  if (platform.value === 'darwin' && spec.kind === 'command' && isKeychainCommand(spec.command))
    return t('providers.keyTypeKeychain')
  if (spec.kind === 'command') return t('providers.keyTypeCommand')
  return t('providers.keyTypeLiteral')
}

function protocolLabel(protocol: string): string {
  return PROTOCOLS.find((p) => p.id === protocol)?.label ?? protocol
}

const providerRows = computed(() => [
  ...providersStore.items.map((provider) => ({
    id: provider.id,
    key: `provider:${provider.id}`,
    provider,
    name: provider.displayName,
    iconId: findProviderPreset(provider)?.id ?? provider.key,
    subtitle: provider.baseUrl || t('common.unknown'),
    protocol: protocolLabel(provider.protocol),
    modelCount: provider.modelCount,
    badge: keyBadge(provider),
    reconnect: false,
    updatedAt: provider.updatedAt,
    searchTerms: [provider.displayName, provider.key, provider.baseUrl ?? '', provider.protocol]
  })),
  ...chatGptSummaries.value.map((account) => ({
    ...account,
    key: `account:${account.id}`,
    provider: null,
    name: 'Codex',
    iconId: 'chatgpt',
    protocol: protocolLabel('openai-responses'),
    searchTerms: ['Codex', 'openai-responses', ...account.searchTerms]
  }))
])

const filteredRows = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return providerRows.value
  return providerRows.value.filter((row) =>
    row.searchTerms.some((term) => term.toLowerCase().includes(q))
  )
})

async function loadPlatform(): Promise<void> {
  try {
    platform.value = (await getApi().system.info()).platform
  } catch {
    // Keep the synchronous navigator-derived hint when the bridge is unavailable.
  }
}

watch(
  () => route.query.action,
  (action) => {
    if (action === 'create-provider') openCatalog()
    else if (action === 'create-model') openModels('all', true)
    else if (action === 'manage-models') openModels()
    else return
    const query = { ...route.query }
    delete query.action
    void router.replace({ query })
  },
  { immediate: true }
)

onMounted(() => {
  void providersStore.fetchList()
  void modelsStore.fetchList()
  void loadPlatform()
  void chatGptAccounts.load()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Page header — compact, single line, page title + description on the
         left, search + primary action on the right. -->
    <PageHeader>
      <div class="flex min-w-0 flex-col justify-center self-stretch">
        <h1
          class="text-[15px] font-semibold leading-[18px] tracking-tight text-[var(--text-primary)]"
        >
          {{ $t('models.title') }}
        </h1>
        <p class="mt-[3px] text-[11.5px] leading-[14px] text-[var(--text-tertiary)]">
          {{ $t('models.managementSubtitle') }}
        </p>
      </div>
      <div v-if="section === 'providers' && !modelScope" class="flex items-center gap-2">
        <SearchField
          v-model="query"
          :placeholder="$t('providers.filterPlaceholder')"
          class="w-[220px]"
        />
        <Button
          size="sm"
          :aria-pressed="chatGptAccounts.maskAccounts"
          data-testid="mask-provider-accounts"
          @click="chatGptAccounts.toggleMaskAccounts()"
        >
          <component
            :is="chatGptAccounts.maskAccounts ? EyeOff : Eye"
            class="size-3.5"
            aria-hidden="true"
          />
          {{ $t('providerAccounts.maskAccounts') }}
        </Button>
        <Button variant="primary" size="sm" data-testid="add-provider" @click="openCatalog()">
          <Plus class="size-3.5" />
          {{ $t('providers.create') }}
        </Button>
      </div>
    </PageHeader>

    <nav
      class="flex shrink-0 gap-2 border-b border-[var(--border-subtle)] px-5 py-2"
      :aria-label="$t('providers.title')"
    >
      <Button
        v-for="value in ['providers', 'models', 'usage'] as const"
        :key="value"
        :data-testid="'provider-tab-' + value"
        size="sm"
        :variant="
          (value === 'models' ? !!modelScope : section === value && !modelScope)
            ? 'primary'
            : 'ghost'
        "
        :aria-pressed="value === 'models' ? !!modelScope : section === value && !modelScope"
        @click="value === 'models' ? openModels() : openSection(value)"
      >
        <component
          :is="value === 'providers' ? Box : value === 'models' ? Cpu : Gauge"
          class="size-3.5"
          :stroke-width="1.75"
          aria-hidden="true"
        />
        {{
          $t(
            value === 'providers'
              ? 'providers.title'
              : value === 'models'
                ? 'models.title'
                : 'providerAccounts.usage'
          )
        }}
      </Button>
      <span
        v-if="modelScope && modelScope !== 'all'"
        class="self-center text-xs text-[var(--text-secondary)]"
        aria-current="page"
      >
        {{ providersStore.items.find((item) => item.id === modelScope)?.displayName }}
      </span>
    </nav>
    <div v-if="section === 'usage'" class="min-h-0 flex-1 overflow-y-auto">
      <ProviderUsagePanel />
    </div>
    <ModelsView
      v-else-if="modelScope"
      :key="modelScope"
      embedded
      :scope="modelScope"
      :create-on-open="modelCreate"
      class="min-h-0 flex-1"
      @add-provider="openCatalog()"
    />
    <div v-else class="flex-1 space-y-5 overflow-y-auto px-5 pt-5 pb-6">
      <div class="grid grid-cols-2 gap-2.5 md:grid-cols-4" data-testid="subscription-providers">
        <button
          v-for="shortcut in subscriptionShortcuts"
          :key="shortcut.id"
          type="button"
          :data-testid="
            shortcut.id === 'gateway' ? 'open-local-gateway' : 'open-subscription-' + shortcut.id
          "
          class="group flex min-h-14 min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          @click="shortcut.id === 'gateway' ? (gatewayOpen = true) : openCatalog(shortcut.id)"
        >
          <ProviderMark :provider-id="shortcut.id" :name="shortcut.name ?? ''">
            <Network class="size-4" :stroke-width="1.75" />
          </ProviderMark>
          <span class="min-w-0 truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {{ shortcut.name ?? $t('providerAdvanced.gateway') }}
          </span>
          <span
            v-if="shortcut.id === 'chatgpt' && chatGptAccounts.items.length"
            class="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-tint)] px-1 text-[10.5px] font-semibold tabular-nums text-[var(--text-secondary)]"
          >
            {{ chatGptAccounts.items.length }}
          </span>
          <ChevronRight
            class="ml-auto size-3.5 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--accent)]"
            :stroke-width="1.75"
            aria-hidden="true"
          />
        </button>
      </div>
      <p
        v-if="!providersStore.loading && !providerRows.length"
        class="text-xs text-[var(--text-secondary)]"
      >
        {{ $t('models.providerRequired') }}
      </p>
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
        <Button
          variant="secondary"
          size="sm"
          @click="openModels(providersWithNoModels[0]?.id, true)"
        >
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
        v-else-if="providerRows.length === 0"
        :title="$t('providers.empty')"
        :description="$t('providers.emptyHint')"
        :icon="Box"
      >
        <Button
          variant="primary"
          size="sm"
          class="mt-3"
          data-testid="add-provider"
          @click="openCatalog()"
        >
          {{ $t('providers.createShort') }}
        </Button>
      </EmptyState>

      <EmptyState
        v-else-if="filteredRows.length === 0"
        :title="$t('providers.filterEmpty')"
        :description="$t('providers.filterEmptyHint')"
        :icon="Search"
      />

      <section v-else aria-labelledby="configured-providers-title">
        <div class="mb-2.5 flex items-baseline gap-2">
          <h2
            id="configured-providers-title"
            class="text-[13px] font-semibold text-[var(--text-primary)]"
          >
            {{ $t('providerAccounts.configured') }}
          </h2>
          <span class="text-[11px] tabular-nums text-[var(--text-tertiary)]">
            {{ filteredRows.length }}
          </span>
        </div>
        <!-- The shared grid keeps the sticky action column aligned across every row. -->
        <div
          data-testid="providers-table-scroll"
          class="overflow-x-auto overflow-y-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]"
        >
          <div class="grid min-w-[800px] gap-x-3" :style="listGrid">
            <div
              class="col-span-full grid h-9 grid-cols-subgrid items-center border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-window)_72%,var(--bg-surface))] pl-3.5 text-[11px] font-semibold text-[var(--text-secondary)]"
            >
              <span class="min-w-0 truncate">{{ $t('providers.colName') }}</span>
              <span>{{ $t('providers.colProtocol') }}</span>
              <span class="px-1 text-center">{{ $t('providers.colModels') }}</span>
              <span>{{ $t('providers.colKey') }}</span>
              <span>{{ $t('providers.colUpdated') }}</span>
              <span
                class="sticky right-0 z-20 flex self-stretch items-center border-l border-[var(--border-subtle)] table-sticky-cell pl-2 pr-3"
              >
                <span class="w-[4.75rem] shrink-0 truncate text-center" :title="$t('providers.gatewayHint')">
                  {{ $t('providers.colGateway') }}
                </span>
                <span class="ml-auto">{{ $t('common.actions') }}</span>
              </span>
            </div>

            <div
              v-for="row in filteredRows"
              :key="row.key"
              data-testid="provider-row"
              :data-provider-kind="row.provider ? 'api' : 'account'"
              class="group relative col-span-full grid min-h-[54px] grid-cols-subgrid items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-3.5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] last:border-b-0 hover:bg-[var(--bg-hover)] focus-within:bg-[var(--bg-hover)] hover:[--row-tint:var(--bg-hover)] focus-within:[--row-tint:var(--bg-hover)]"
            >
              <button
                type="button"
                class="group/name flex min-w-0 items-center gap-2.5 rounded-[var(--radius-sm)] py-1.5 text-left focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                :data-testid="row.provider ? 'provider-manage-models' : 'provider-manage-account'"
                @click="row.provider ? openModels(row.id) : openCatalog('chatgpt', row.id)"
              >
                <ProviderMark :provider-id="row.iconId" :name="row.name" />
                <span class="min-w-0">
                  <span
                    class="block truncate text-[13px] font-semibold leading-tight text-[var(--text-primary)] group-hover/name:underline"
                    :title="row.name"
                  >
                    {{ row.name }}
                  </span>
                  <span
                    class="mt-0.5 block truncate font-[family-name:var(--font-mono)] text-[11px] leading-tight text-[var(--text-tertiary)]"
                    :title="row.subtitle"
                  >
                    {{ row.subtitle }}
                  </span>
                </span>
              </button>

              <div
                class="whitespace-nowrap text-[12px] text-[var(--text-secondary)]"
                :title="row.protocol"
              >
                {{ row.protocol }}
              </div>

              <div
                class="text-center text-[12px] font-medium tabular-nums text-[var(--text-primary)]"
              >
                {{ row.modelCount }}
              </div>

              <div class="flex">
                <Badge
                  :tone="row.reconnect ? 'warning' : 'muted'"
                  class="max-w-full"
                  :title="row.badge"
                >
                  <span
                    v-if="row.reconnect"
                    class="size-1.5 rounded-full bg-current"
                    aria-hidden="true"
                  />
                  {{ row.badge }}
                </Badge>
              </div>

              <div
                class="whitespace-nowrap text-[11.5px] tabular-nums text-[var(--text-tertiary)]"
                :title="formatRelativeTime(row.updatedAt, locale)"
              >
                {{ formatRelativeTime(row.updatedAt, locale) }}
              </div>

              <div
                data-testid="provider-action-cell"
                class="sticky right-0 z-10 flex self-stretch items-center gap-1.5 border-l border-[var(--border-subtle)] table-sticky-cell pl-2 pr-3"
              >
                <div
                  class="flex w-[4.75rem] shrink-0 items-center justify-center"
                  :title="$t('providers.gatewayHint')"
                >
                  <Switch
                    v-if="row.provider"
                    data-testid="provider-gateway-switch"
                    :model-value="row.provider.gateway === true"
                    :disabled="switchingGateway === row.provider.key"
                    :label="`${$t('providers.colGateway')} · ${row.name}`"
                    @update:model-value="setGateway(row.provider, $event)"
                  />
                  <span v-else class="text-[12px] text-[var(--text-tertiary)]">—</span>
                </div>
                <div class="ml-auto flex items-center gap-1.5">
                <template v-if="row.provider">
                  <IconButton show-label :label="$t('common.test')" @click="openTest(row.provider)">
                    <Zap class="size-3.5 shrink-0" :stroke-width="1.75" />
                  </IconButton>
                  <IconButton show-label :label="$t('common.edit')" @click="openEdit(row.provider)">
                    <Pencil class="size-3.5 shrink-0" :stroke-width="1.75" />
                  </IconButton>
                  <IconButton
                    show-label
                    :label="$t('common.duplicate')"
                    @click="confirmDuplicate(row.provider)"
                  >
                    <Copy class="size-3.5 shrink-0" :stroke-width="1.75" />
                  </IconButton>
                  <IconButton
                    show-label
                    variant="danger"
                    :label="$t('common.delete')"
                    @click="confirmDelete(row.provider)"
                  >
                    <Trash2 class="size-3.5 shrink-0" :stroke-width="1.75" />
                  </IconButton>
                </template>
                <IconButton
                  v-else
                  show-label
                  :variant="row.reconnect ? 'accent' : 'default'"
                  :label="$t('providerAccounts.manageAccount')"
                  @click="openCatalog('chatgpt', row.id)"
                >
                  <UserRound class="size-3.5 shrink-0" :stroke-width="1.75" />
                </IconButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <LocalGatewayDialog v-if="gatewayOpen" @close="gatewayOpen = false" />
    <Dialog
      v-model:open="catalogOpen"
      :title="$t('providerAccounts.addTitle')"
      sheet
      close-on-escape
    >
      <template v-if="!catalogDetail" #toolbar>
        <SearchField
          v-model="catalogQuery"
          class="w-[220px]"
          data-testid="add-provider-search"
          :placeholder="$t('providerAccounts.findProvider')"
        />
      </template>
      <AddProviderCatalog
        :presets="PROVIDER_PRESETS"
        :configured-ids="configuredCatalogIds"
        :add-only="catalogAddOnly"
        :initial-detail="catalogDetail"
        :account-id="catalogAccountId"
        :query="catalogQuery"
        @update:detail="setCatalogDetail"
        @select-preset="chooseCatalogPreset"
        @account-added="finishAccountAddition"
        @edit-provider="editCatalogProvider"
      />
    </Dialog>

    <Dialog
      v-model:open="dialogOpen"
      :title="isEditing ? $t('providers.edit') : $t('providers.create')"
      wide
    >
      <div class="space-y-3">
        <div v-if="hasPresetEndpoint" class="flex items-center justify-between gap-2">
          <strong class="text-sm">{{ form.displayName }}</strong>
          <Button
            size="sm"
            :aria-expanded="advancedProviderOptions"
            data-testid="provider-advanced-options"
            @click="advancedProviderOptions = !advancedProviderOptions"
          >
            {{ $t('providerAccounts.advancedOptions') }}
          </Button>
        </div>
        <div v-if="showProviderOptions" class="grid grid-cols-2 gap-3">
          <Input
            v-model="form.key"
            :label="$t('providers.fieldKey')"
            :placeholder="$t('providers.keyPlaceholder')"
            :hint="$t('providers.fieldKeyHint')"
            mono
          />
          <Input
            v-model="form.displayName"
            :label="$t('providers.fieldDisplayName')"
            :placeholder="$t('providers.displayNamePlaceholder')"
          />
        </div>
        <Input
          v-if="showProviderOptions"
          v-model="form.name"
          :label="$t('providers.fieldInternalName')"
          :placeholder="$t('providers.internalNamePlaceholder')"
        />
        <Select
          v-if="showProviderOptions"
          v-model="form.protocol"
          :label="$t('providers.fieldProtocol')"
          :options="protocolOptions"
        />
        <div v-if="showProviderOptions" class="space-y-2">
          <Input
            v-model="form.baseUrl"
            :label="$t('providers.fieldBaseUrl')"
            :placeholder="$t('providers.baseUrlPlaceholder')"
            :hint="baseUrlHint"
            mono
            @blur="onBaseUrlBlur"
          />
          <div class="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              :disabled="!form.baseUrl.trim()"
              @click="applyProviderIdentity(true)"
            >
              <Sparkles class="size-3.5" :stroke-width="1.75" />
              {{ $t('providers.generateIdentity') }}
            </Button>
          </div>
        </div>
        <div
          v-if="keylessLocalOllama"
          data-testid="ollama-no-key"
          class="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        >
          <p class="text-[12px] font-medium">{{ $t('providers.localOllamaNoKey') }}</p>
          <p class="text-[11px] text-[var(--text-secondary)]">
            {{ $t('providers.localOllamaNoKeyHint') }}
          </p>
          <Button variant="ghost" size="sm" @click="configureLocalAuth">
            {{ $t('providers.configureAuth') }}
          </Button>
        </div>
        <template v-else>
          <Select
            v-if="showProviderOptions"
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
              :revealable="!!apiKeyValue && !isMaskedKey(apiKeyValue)"
              :revealed="apiKeyRevealed"
              :reveal-label="$t('providers.keyReveal')"
              :hide-label="$t('providers.keyHide')"
              mono
              autocomplete="off"
              @focus="!apiKeyRevealed ? clearKeyMask() : undefined"
              @reveal-toggle="toggleApiKeyReveal"
            />
          </div>

          <template v-else-if="showApiKeyInput">
            <Input
              v-model="apiKeyValue"
              :label="$t('providers.fieldApiKeyValue')"
              :placeholder="apiKeyPlaceholder"
              :type="apiKeyKind === 'literal' ? 'password' : 'text'"
              :revealable="apiKeyKind === 'literal' && !!apiKeyValue && !isMaskedKey(apiKeyValue)"
              :revealed="apiKeyRevealed"
              :reveal-label="$t('providers.keyReveal')"
              :hide-label="$t('providers.keyHide')"
              mono
              autocomplete="off"
              @focus="apiKeyKind === 'literal' && !apiKeyRevealed ? clearKeyMask() : undefined"
              @reveal-toggle="toggleApiKeyReveal"
            />
            <p v-if="apiKeyKind === 'command'" class="text-[11px] text-[var(--text-tertiary)]">
              {{ $t('providers.commandHint') }}
            </p>
          </template>
          <div
            v-if="hasSavedSecret || activePreset?.keyUrl"
            class="flex flex-wrap items-center gap-2"
          >
            <Button
              v-if="hasSavedSecret"
              size="sm"
              :loading="copyingApiKey"
              @click="copySavedApiKey"
            >
              <Copy class="size-3.5 shrink-0" :stroke-width="1.75" />
              {{ $t('providerAccounts.copySavedKey') }}
            </Button>
            <Button
              v-if="activePreset?.keyUrl"
              size="sm"
              data-testid="provider-key-page"
              @click="openPresetKeyPage(activePreset.keyUrl)"
            >
              {{ $t('providerAccounts.getApiKey') }}
            </Button>
          </div>
        </template>

        <div class="space-y-2">
          <Combobox
            v-model="defaultModelIdStr"
            :label="$t('providers.fieldDefaultModel')"
            :placeholder="$t('providers.defaultModelPlaceholder')"
            :hint="$t('providers.defaultModelHint')"
            :options="modelOptions"
            mono
          />
          <div class="flex items-center justify-between gap-3">
            <span
              role="status"
              aria-live="polite"
              class="min-w-0 flex-1 text-[10.5px] leading-snug"
              :class="modelDiscoveryFeedbackClass"
            >
              {{ visibleModelDiscoveryFeedback?.message ?? '' }}
            </span>
            <Button
              v-if="draftTesting"
              variant="ghost"
              size="sm"
              @click="cancelTest(draftRequestId)"
            >
              {{ $t('common.cancel') }}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              :loading="draftTesting"
              :disabled="!form.baseUrl.trim() || !defaultModelIdStr.trim()"
              data-testid="provider-test-draft"
              @click="testDraft"
              >{{ $t('providerAccounts.testConnection') }}</Button
            >
            <Button
              variant="secondary"
              size="sm"
              :loading="discoveringModels"
              :disabled="!form.baseUrl.trim()"
              @click="discoverProviderModels"
            >
              <RefreshCw class="size-3.5" :stroke-width="1.75" />
              {{ $t('providers.discoverAllModels') }}
            </Button>
          </div>
          <ProviderConnectionDetails v-if="draftTestResult" :result="draftTestResult" />
        </div>

        <div
          v-if="showProviderOptions && !keylessLocalOllama"
          class="flex items-center justify-between gap-3"
        >
          <span class="text-[12px] text-[var(--text-secondary)]">{{
            $t('providers.fieldAuthHeader')
          }}</span>
          <Switch v-model="form.authHeader" :label="$t('providers.fieldAuthHeader')" />
        </div>
        <Input
          v-if="showProviderOptions"
          v-model="timeoutStr"
          :label="$t('providers.fieldTimeout')"
          :placeholder="$t('providers.timeoutPlaceholder')"
          mono
        />
        <Textarea
          v-if="showProviderOptions"
          v-model="headersJson"
          :label="$t('providers.fieldHeaders')"
          :placeholder="$t('providers.headersPlaceholder')"
          :hint="$t('providers.headersHint')"
          :rows="3"
          mono
        />
        <ProviderAdvancedFields
          v-if="showProviderOptions"
          v-model="advancedDraft"
          :protocol="form.protocol"
        />
      </div>
      <template #footer>
        <span
          v-if="saveError"
          role="alert"
          class="mr-auto min-w-0 truncate text-left text-[11px] text-[var(--error)]"
          :title="saveError"
        >
          {{ saveError }}
        </span>
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
      close-on-escape
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
        <ProviderConnectionDetails v-if="testResult" :result="testResult" />
      </div>
      <template #footer>
        <Button variant="ghost" @click="testOpen = false">
          {{ $t('common.close') }}
        </Button>
        <Button v-if="testLoading" variant="secondary" @click="cancelTest(testRequestId)">
          {{ $t('common.cancel') }}
        </Button>
        <Button variant="primary" :loading="testLoading" @click="runTest">
          {{ $t('providers.testRun') }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
