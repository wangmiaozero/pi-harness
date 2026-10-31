<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem
} from 'reka-ui'
import WorkspaceVoiceControl from '@renderer/features/agent-settings/WorkspaceVoiceControl.vue'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import ComposerModelPicker from './ComposerModelPicker.vue'
import { getApi } from '@renderer/composables/useApi'
import {
  openCodeSelectionBlock,
  showOpenCodeWorkspaceModel,
  type OpenCodeFreeState
} from '@shared/providers/opencode-free'
import ComposerOptionMenu from './ComposerOptionMenu.vue'
import AgentAuraFireBorder from '@renderer/components/ui/AgentAuraFireBorder.vue'
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
import { useSkillsStore } from '@renderer/stores/skills'
import type { SkillInfo } from '@shared/ipc/api-types'
import type { ToolPreset } from '@shared/workspace/tool-presets'
import {
  isBase64ImageWithinLimits,
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES
} from '@shared/workspace/image-attachments'
import {
  ArrowDown,
  ArrowUp,
  AtSign,
  BookOpen,
  Bot,
  Boxes,
  CircleOff,
  Hand,
  ImagePlus,
  ListChecks,
  MoreHorizontal,
  Square,
  Pencil,
  ShieldCheck,
  ShieldAlert,
  SquareTerminal,
  Target,
  Volume2,
  VolumeX,
  Wrench,
  X
} from '@lucide/vue'
import { isImageGenerationModel } from '@shared/models/image-model'
import { AGENT_MODES, normalizeAgentMode, type AgentMode } from '@shared/workspace/agent-mode'
import { PERMISSION_MODES, normalizePermissionMode } from '@shared/workspace/permission-mode'
import { usePermissionStore } from '@renderer/stores/permission'
import {
  findActiveSkillMention,
  removeSkillMention,
  type ActiveSkillMention
} from './skill-invocation'
import type { AgentImageAttachment } from '@shared/types/workspace'
interface ComposerImageModelTarget {
  providerKey: string
  modelId: string
}

const props = defineProps<{ soundEnabled: boolean; submitting?: boolean }>()
interface PasteQueueItem {
  id: string
  name: string
  image: ChatDraftImage
}

const AGENT_MODE_LABEL_KEYS: Record<AgentMode, string> = {
  agent: 'workspace.modeAgent',
  plan: 'workspace.modePlan',
  goal: 'workspace.modeGoal'
}

const PERMISSION_MODE_LABEL_KEYS: Record<string, string> = {
  ask: 'workspace.permissionAsk',
  'accept-edits': 'workspace.permissionAcceptEdits',
  auto: 'workspace.permissionAuto'
}

/** Text pastes beyond this length are saved to the session temp directory. */
const LARGE_PASTE_THRESHOLD = 8_000

const emit = defineEmits<{
  send: [imageModel: ComposerImageModelTarget | null, mode?: AgentMode]
  sendQueue: [images: AgentImageAttachment[], mode: AgentMode]
  abort: []
  toggleSound: []
  unlockAudio: []
}>()
const { t } = useI18n()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const sessions = useSessionStore()
const models = useModelsStore()
const providers = useProvidersStore()
const settings = useSettingsStore()
const skills = useSkillsStore()
const fileInput = ref<HTMLInputElement | null>(null)
const editor = ref<HTMLElement | null>(null)
const inputBox = ref<HTMLElement | null>(null)
const editorFocused = ref(false)
const previewImage = ref<ChatDraftImage | null>(null)
const previewOpen = ref(false)
const dragActive = ref(false)
const pendingImageCount = ref(0)
const modelSwitching = ref(false)
const pasteQueue = ref<PasteQueueItem[]>([])
const pasteQueueIndex = ref(0)
const imageModelValue = ref<string | null>(null)
const skillMention = ref<ActiveSkillMention | null>(null)
const activeSkillIndex = ref(0)
const skillMenuStyle = ref<Record<string, string>>({})
let dragDepth = 0
const permission = usePermissionStore()
const agentMode = ref<AgentMode>(normalizeAgentMode(settings.settings?.defaultAgentMode ?? 'agent'))
const agentModeValue = computed({
  get: () => agentMode.value,
  set: (value: string) => {
    agentMode.value = normalizeAgentMode(value)
  }
})
const permissionModeValue = computed({
  get: () => permission.modeFor(sessions.currentId),
  set: (value: string) => {
    permission.setMode(sessions.currentId, normalizePermissionMode(value))
  }
})

// `runningIds` and the loaded-session snapshots are consulted per session via
// `isBusy`, so a task running in another conversation never marks this one as
// busy (e.g. showing 终止 on a session that is idle).
const busy = computed(() => agent.isBusy(sessions.currentId))
const inputLocked = computed(
  () => props.submitting || (agent.sending && agent.sendingSessionId === sessions.currentId)
)
const pasteQueueCurrent = computed(
  () => pasteQueue.value[Math.min(pasteQueueIndex.value, pasteQueue.value.length - 1)] ?? null
)
function onEditorFocus() {
  editorFocused.value = true
  ensureEditorTextNode()
  updateSkillMention()
}

function onEditorMouseDown(event: MouseEvent) {
  if (inputLocked.value) return
  const target = event.target as Node | null
  if (
    target &&
    (editor.value?.contains(target) || (target as Element).closest?.('button, .composer-text-area'))
  )
    return
  event.preventDefault()
  editor.value?.focus({ preventScroll: true })
  setEditorSelection(workspace.draft.length)
}

function onEditorBlur() {
  editorFocused.value = false
  skillMention.value = null
}

function focus() {
  editor.value?.focus({ preventScroll: true })
  void nextTick(() => setEditorSelection(workspace.draft.length))
}

defineExpose({ focus })

const openCodeState = ref<OpenCodeFreeState | null>(null)
async function refreshOpenCodeOptions(): Promise<void> {
  try {
    openCodeState.value = await getApi().openCodeFree.state()
  } catch {
    openCodeState.value = null
  }
}
const modelOptions = computed(() => {
  const options = models.items
    .filter((m) => {
      if (!m.enabled) return false
      const provider = providers.items.find((p) => p.id === m.providerId)
      return (
        (provider?.key ?? m.providerId) !== 'opencode-free' ||
        showOpenCodeWorkspaceModel(openCodeState.value, m.modelId)
      )
    })
    .map((m) => {
      const provider = providers.items.find((p) => p.id === m.providerId)
      const key = provider?.key ?? m.providerId
      const catalogModel =
        key === 'opencode-free'
          ? openCodeState.value?.models.find((item) => item.id === m.modelId)
          : undefined
      const reason =
        key === 'opencode-free'
          ? catalogModel
            ? openCodeSelectionBlock(openCodeState.value, catalogModel)
            : 'NOT_VERIFIED'
          : null
      return {
        value: `${key}/${m.modelId}`,
        label: m.displayName || m.modelId,
        group: provider?.displayName || key,
        disabled: Boolean(reason),
        description: reason ? t(`openCode.errors.${reason}`, t('openCode.notAvailable')) : undefined
      }
    })
  for (const model of openCodeState.value?.models ?? []) {
    if (
      !showOpenCodeWorkspaceModel(openCodeState.value, model.id) ||
      model.price === 'unknown' ||
      options.some((o) => o.value === `opencode-free/${model.id}`)
    )
      continue
    const reason = openCodeSelectionBlock(openCodeState.value, model) ?? 'NOT_VERIFIED'
    options.push({
      value: `opencode-free/${model.id}`,
      label: model.name,
      group: 'OpenCode',
      disabled: true,
      description: t(`openCode.errors.${reason}`, t('openCode.notAvailable'))
    })
  }
  return options
})

const modelValue = computed({
  get: () =>
    imageModelValue.value ??
    (agent.state?.model
      ? `${agent.state.model.provider}/${agent.state.model.id}`
      : `${models.active.providerKey}/${models.active.modelId}`),
  set: async (value: string) => {
    const [provider, ...rest] = value.split('/')
    const modelId = rest.join('/')
    if (
      !provider ||
      !modelId ||
      !modelOptions.value.some((option) => option.value === value && !option.disabled)
    )
      return
    const selected = models.items.find((model) => {
      const modelProvider = providers.items.find((item) => item.id === model.providerId)
      return `${modelProvider?.key ?? model.providerId}/${model.modelId}` === value
    })
    if (isImageGenerationModel(selected)) {
      imageModelValue.value = value
      return
    }
    imageModelValue.value = null
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
const selectedImageModel = computed(() => isImageGenerationModel(selectedModel.value))
const mentionSkills = computed(() => {
  const byName = new Map<string, SkillInfo>()
  for (const skill of skills.skills.filter((item) => item.isValid)) {
    const existing = byName.get(skill.name)
    if (!existing || skillScopeRank(skill) < skillScopeRank(existing)) {
      byName.set(skill.name, skill)
    }
  }
  return [...byName.values()]
})
const filteredMentionSkills = computed(() => {
  const query = skillMention.value?.query.trim().toLowerCase() ?? ''
  return mentionSkills.value
    .filter(
      (skill) =>
        !query ||
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
    )
    .sort((a, b) => {
      const aPrefix = query && a.name.toLowerCase().startsWith(query) ? 0 : 1
      const bPrefix = query && b.name.toLowerCase().startsWith(query) ? 0 : 1
      return (
        aPrefix - bPrefix || skillScopeRank(a) - skillScopeRank(b) || a.name.localeCompare(b.name)
      )
    })
    .slice(0, 6)
})
const skillMenuOpen = computed(() => Boolean(skillMention.value) && !selectedImageModel.value)
const activeMentionSkill = computed(
  () => filteredMentionSkills.value[activeSkillIndex.value] ?? null
)
const supportsImages = computed(
  () => selectedImageModel.value || selectedModel.value?.vision === true
)
const hasUnsupportedImages = computed(
  () => workspace.draftImages.length > 0 && !supportsImages.value
)
const hasTooManyImageSources = computed(
  () => selectedImageModel.value && workspace.draftImages.length > 1
)
const canSend = computed(
  () =>
    !inputLocked.value &&
    pendingImageCount.value === 0 &&
    workspace.canChat &&
    (selectedImageModel.value
      ? Boolean(workspace.draft.trim())
      : Boolean(workspace.draft.trim() || workspace.draftSkill || workspace.draftImages.length)) &&
    !hasUnsupportedImages.value &&
    !hasTooManyImageSources.value
)

function warnImageUnsupported() {
  toast.warning(t('workspace.imageUnsupported'))
}

function emitSend() {
  if (inputLocked.value) return
  const value = modelValue.value
  const slash = value.indexOf('/')
  emit(
    'send',
    selectedImageModel.value && slash > 0
      ? { providerKey: value.slice(0, slash), modelId: value.slice(slash + 1) }
      : null,
    agentMode.value
  )
}

function skillScopeRank(skill: SkillInfo): number {
  if (skill.scope === 'project') return 0
  if (skill.scope === 'global') return 1
  if (skill.scope === 'shared') return 2
  return 3
}

function skillScopeLabel(skill: SkillInfo): string {
  if (skill.scope === 'project') return t('skills.packageScopeProject')
  return ''
}

function syncSkillMenu() {
  const element = inputBox.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const gutter = 8
  const availableWidth = Math.max(0, window.innerWidth - gutter * 2)
  const width = Math.min(Math.max(320, Math.round(rect.width)), 560, availableWidth)
  const left = Math.min(
    Math.max(gutter, Math.round(rect.left)),
    Math.max(gutter, window.innerWidth - width - gutter)
  )
  skillMenuStyle.value = {
    bottom: `${Math.max(gutter, Math.round(window.innerHeight - rect.top + gutter))}px`,
    left: `${left}px`,
    width: `${width}px`
  }
}

function updateSkillMention(value = workspace.draft, cursor = editorSelection()?.end ?? null) {
  if (selectedImageModel.value) {
    skillMention.value = null
    return
  }
  skillMention.value = findActiveSkillMention(value, cursor)
  if (skillMention.value) syncSkillMenu()
}

function editorTextValue(): string {
  return editor.value?.textContent?.replace(/\r\n/g, '\n') ?? ''
}

function syncEditorText() {
  const element = editor.value
  if (element && element.textContent !== workspace.draft) element.textContent = workspace.draft
}

function ensureEditorTextNode(): Text {
  const element = editor.value
  if (!element) return document.createTextNode('')
  const existing = [...element.childNodes].find(
    (node): node is Text => node.nodeType === Node.TEXT_NODE
  )
  if (existing) return existing
  const text = document.createTextNode('')
  element.append(text)
  return text
}

function offsetWithinDraft(node: Node, offset: number): number {
  const root = editor.value
  if (!root) return 0
  if (!root.contains(node) && node !== root) {
    return workspace.draft.length
  }
  const range = document.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(node, offset)
  } catch {
    return workspace.draft.length
  }
  return range.toString().length
}

function editorSelection(): { start: number; end: number } | null {
  const selection = window.getSelection()
  const root = editor.value
  if (!selection?.rangeCount || !root) return null
  const anchor = offsetWithinDraft(selection.anchorNode ?? root, selection.anchorOffset)
  const focusOffset = offsetWithinDraft(selection.focusNode ?? root, selection.focusOffset)
  return { start: Math.min(anchor, focusOffset), end: Math.max(anchor, focusOffset) }
}

function textPosition(offset: number): { node: Node; offset: number } {
  const root = editor.value
  const fallback = ensureEditorTextNode()
  if (!root) return { node: fallback, offset: 0 }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, Math.min(offset, workspace.draft.length))
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
    node = walker.nextNode()
  }
  return { node: fallback, offset: fallback.length }
}

function setEditorSelection(start: number, end = start) {
  const selection = window.getSelection()
  if (!selection || !editor.value) return
  const from = textPosition(start)
  const to = textPosition(end)
  const range = document.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}

function replaceEditorSelection(text: string) {
  if (inputLocked.value) return
  const selection = editorSelection() ?? {
    start: workspace.draft.length,
    end: workspace.draft.length
  }
  workspace.draft = `${workspace.draft.slice(0, selection.start)}${text}${workspace.draft.slice(selection.end)}`
  syncEditorText()
  const cursor = selection.start + text.length
  setEditorSelection(cursor)
  updateSkillMention(workspace.draft, cursor)
}

function onComposerInput() {
  if (inputLocked.value) return
  workspace.draft = editorTextValue()
  updateSkillMention(workspace.draft, editorSelection()?.end ?? workspace.draft.length)
}

function selectSkill(skill: SkillInfo) {
  const mention = skillMention.value
  if (!mention) return
  const replacement = removeSkillMention(workspace.draft, mention)
  workspace.draft = replacement.text
  workspace.draftSkill = skill.name
  skillMention.value = null
  void nextTick(() => {
    syncEditorText()
    editor.value?.focus({ preventScroll: true })
    setEditorSelection(replacement.cursor)
  })
}

function removeSelectedSkill() {
  if (inputLocked.value) return
  workspace.draftSkill = null
  void nextTick(() => {
    editor.value?.focus({ preventScroll: true })
    setEditorSelection(0)
  })
}

function openSkillMention() {
  emit('unlockAudio')
  const element = editor.value
  if (!element) return
  if (skillMention.value) {
    element.focus({ preventScroll: true })
    syncSkillMenu()
    return
  }

  const selection = editorSelection()
  const start = selection?.start ?? workspace.draft.length
  const end = selection?.end ?? start
  const prefix = workspace.draft.slice(0, start)
  const insertion = prefix && !/\s$/.test(prefix) ? ' @' : '@'
  workspace.draft = `${prefix}${insertion}${workspace.draft.slice(end)}`
  const cursor = start + insertion.length
  void nextTick(() => {
    syncEditorText()
    element.focus({ preventScroll: true })
    setEditorSelection(cursor)
    updateSkillMention(workspace.draft, cursor)
  })
}

const thinkingStops = computed(() =>
  composerThinkingLevels(
    selectedModel.value?.reasoning === false
      ? ['none']
      : resolveAvailableThinkingLevels(selectedModel.value?.thinkingLevels)
  )
)
const thinkingLabels = computed(() =>
  Object.fromEntries(
    Object.entries(selectedModel.value?.thinkingLevels ?? {})
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && Boolean(entry[1].trim())
      )
      .map(([level, value]) => [level === 'off' ? 'none' : level, value])
  )
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
const showComposerFire = computed(
  () => thinkingValue.value === 'ultra' && (settings.settings?.composerFireEnabled ?? true)
)

watch(thinkingStops, (levels) => {
  const next = clampThinkingLevel(agent.thinkingLevel, levels)
  if (next !== agent.thinkingLevel) thinkingValue.value = next
})

const toolOptions = computed(() => [
  { value: 'none', label: 'off', description: t('workspace.toolsNone'), icon: CircleOff },
  {
    value: 'read-only',
    label: 'read-only',
    description: t('workspace.toolsReadOnly'),
    icon: BookOpen
  },
  { value: 'default', label: 'default', description: t('workspace.toolsDefault'), icon: Wrench },
  { value: 'full', label: 'full', description: t('workspace.toolsFull'), icon: Boxes }
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
  if (inputLocked.value) {
    e.preventDefault()
    return
  }
  if (skillMenuOpen.value && !e.isComposing && e.keyCode !== 229) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const count = filteredMentionSkills.value.length
      if (count) {
        activeSkillIndex.value =
          e.key === 'ArrowDown'
            ? (activeSkillIndex.value + 1) % count
            : (activeSkillIndex.value - 1 + count) % count
      }
      return
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && activeMentionSkill.value) {
      e.preventDefault()
      selectSkill(activeMentionSkill.value)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      skillMention.value = null
      return
    }
  }
  const selection = editorSelection()
  if (
    e.key === 'Backspace' &&
    workspace.draftSkill &&
    selection?.start === 0 &&
    selection.end === 0
  ) {
    e.preventDefault()
    removeSelectedSkill()
    return
  }
  if (e.key === 'Enter' && e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault()
    replaceEditorSelection('\n')
    return
  }
  if (shouldSendComposerKey(e)) {
    e.preventDefault()
    if (hasUnsupportedImages.value) warnImageUnsupported()
    else if (hasTooManyImageSources.value) toast.warning(t('workspace.imageLimit', { count: 1 }))
    else if (canSend.value) emitSend()
  }
  if (e.key === 'Escape' && busy.value) {
    e.preventDefault()
    emit('abort')
  }
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    void nextTick(() => updateSkillMention())
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
  if (inputLocked.value) return
  if (!supportsImages.value) {
    warnImageUnsupported()
    return
  }
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  if (!imageFiles.length) {
    if (files.length) toast.warning(t('workspace.imageOnly'))
    return
  }
  const supportedFiles = selectedImageModel.value
    ? imageFiles.filter((file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    : imageFiles
  if (supportedFiles.length < imageFiles.length) {
    toast.warning(t('models.imageUnsupportedType'))
  }

  const withinSize = supportedFiles.filter((file) => file.size <= MAX_ATTACHED_IMAGE_BYTES)
  if (withinSize.length < supportedFiles.length) {
    toast.warning(t('workspace.imageTooLarge', { size: MAX_ATTACHED_IMAGE_BYTES / 1024 / 1024 }))
  }
  const imageLimit = selectedImageModel.value ? 1 : MAX_ATTACHED_IMAGES
  const queuedCount = busy.value ? pasteQueue.value.length : workspace.draftImages.length
  const remaining = Math.max(0, imageLimit - queuedCount - pendingImageCount.value)
  if (remaining === 0) {
    toast.warning(t('workspace.imageLimit', { count: imageLimit }))
    return
  }
  const accepted = withinSize.slice(0, remaining)
  if (accepted.length < withinSize.length) {
    toast.warning(t('workspace.imageLimit', { count: imageLimit }))
  }
  if (!accepted.length) return

  pendingImageCount.value += accepted.length
  try {
    const results = await Promise.allSettled(accepted.map(readImage))
    const images = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    )
    if (images.length) {
      if (busy.value) enqueuePasteImages(images)
      else workspace.addDraftImages(images)
    }
    if (images.length < results.length) toast.error(t('workspace.imageReadFailed'))
  } finally {
    pendingImageCount.value -= accepted.length
  }
}
function enqueuePasteImages(images: ChatDraftImage[]) {
  pasteQueue.value = [
    ...pasteQueue.value,
    ...images.map((image) => ({ id: image.id, name: image.name, image }))
  ]
  pasteQueueIndex.value = pasteQueue.value.length - 1
}

function clearPasteQueue() {
  pasteQueue.value = []
  pasteQueueIndex.value = 0
}

function cyclePasteQueue(step: 1 | -1) {
  if (pasteQueue.value.length < 2) return
  pasteQueueIndex.value =
    (pasteQueueIndex.value + step + pasteQueue.value.length) % pasteQueue.value.length
}

function movePasteQueueItemToDraft() {
  const current = pasteQueueCurrent.value
  if (!current) return
  workspace.addDraftImages([current.image])
  removePasteQueueItem(current.id)
}

function removePasteQueueItem(id: string) {
  const index = pasteQueue.value.findIndex((item) => item.id === id)
  if (index < 0) return
  pasteQueue.value = pasteQueue.value.filter((item) => item.id !== id)
  pasteQueueIndex.value = Math.max(0, Math.min(index, pasteQueue.value.length - 1))
}

function removePasteQueueCurrent() {
  const current = pasteQueueCurrent.value
  if (current) removePasteQueueItem(current.id)
}

function sendPasteQueue() {
  if (!pasteQueue.value.length || inputLocked.value) return
  const images: AgentImageAttachment[] = pasteQueue.value.map((item) => ({
    type: 'image' as const,
    data: item.image.data,
    mimeType: item.image.mimeType
  }))
  clearPasteQueue()
  emit('unlockAudio')
  emit('sendQueue', images, agentMode.value)
}

function chooseImages() {
  if (inputLocked.value) return
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
async function savePastedToSession(files: File[]): Promise<string[] | null> {
  try {
    const payload = await Promise.all(
      files.map(async (file) => ({
        name: file.name || undefined,
        mimeType: file.type || undefined,
        data: await file.arrayBuffer()
      }))
    )
    const result = await getApi().paste.save({ sessionId: sessions.currentId, files: payload })
    return result.files.map((file) => file.path)
  } catch {
    toast.error(t('workspace.pasteSaveFailed'))
    return null
  }
}

function onPaste(event: ClipboardEvent) {
  if (inputLocked.value) {
    event.preventDefault()
    return
  }
  const items = Array.from(event.clipboardData?.items ?? [])
  const imageFiles = items
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  const otherFiles = items
    .filter((item) => item.kind === 'file' && !item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  const text = event.clipboardData?.getData('text/plain') ?? ''
  event.preventDefault()
  if (imageFiles.length) {
    void processImageFiles(imageFiles)
    return
  }
  if (otherFiles.length) {
    void savePastedToSession(otherFiles).then((paths) => {
      if (!paths?.length) return
      replaceEditorSelection(paths.join('\n'))
      toast.success(t('workspace.filesPasted', { count: paths.length }))
    })
    return
  }
  if (Array.from(text).length > LARGE_PASTE_THRESHOLD) {
    const file = new File([text], `pasted-text-${Date.now()}.txt`, { type: 'text/plain' })
    void savePastedToSession([file]).then((paths) => {
      if (!paths?.length) return
      replaceEditorSelection(paths[0])
      toast.success(t('workspace.largeTextPasted', { name: paths[0].split(/[\\/]/).pop() }))
    })
    return
  }
  replaceEditorSelection(text)
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
  if (inputLocked.value) return
  void processImageFiles(files)
}

function onSoundToggle() {
  emit('unlockAudio')
  emit('toggleSound')
}

watch(
  () => workspace.currentCwd,
  () => void skills.fetchSkills(),
  { immediate: true }
)

watch(
  () => workspace.draftKey,
  () => clearPasteQueue()
)

watch(
  () => [workspace.draftKey, workspace.draft] as const,
  () => void nextTick(syncEditorText),
  { immediate: true }
)

watch(
  () => skillMention.value?.query,
  () => {
    activeSkillIndex.value = 0
  }
)

watch(skillMenuOpen, (open) => {
  if (open) void nextTick(syncSkillMenu)
})

watch(selectedImageModel, (selected) => {
  if (selected) {
    skillMention.value = null
    workspace.draftSkill = null
  }
})

onMounted(() => {
  void refreshOpenCodeOptions()
  syncEditorText()
  window.addEventListener('resize', syncSkillMenu)
  window.addEventListener('scroll', syncSkillMenu, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncSkillMenu)
  window.removeEventListener('scroll', syncSkillMenu, true)
})
</script>

<template>
  <div
    data-testid="chat-composer"
    class="command-console relative overflow-visible bg-[var(--bg-workspace)] px-4 py-3 transition-colors min-[1080px]:pr-[132px]"
    :class="[
      dragActive ? 'bg-[var(--accent-tint)] shadow-[inset_0_0_0_1px_var(--accent)]' : '',
      showComposerFire ? 'command-console--ultra' : ''
    ]"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="composer-band">
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
            class="block size-14 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
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
            :disabled="inputLocked"
            @click="workspace.removeDraftImage(image.id)"
          >
            <X aria-hidden="true" class="size-2.5" :stroke-width="2" />
          </button>
        </div>
      </div>
      <p v-if="hasUnsupportedImages" class="mb-2 text-[11px] text-[var(--danger)]">
        {{ $t('workspace.imageUnsupported') }}
      </p>
      <p v-else-if="hasTooManyImageSources" class="mb-2 text-[11px] text-[var(--danger)]">
        {{ $t('workspace.imageLimit', { count: 1 }) }}
      </p>
      <div
        v-if="pasteQueue.length"
        data-testid="composer-paste-queue"
        class="mb-2 flex min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--control-border)] bg-[var(--control-bg)] px-2 py-1.5 shadow-[var(--control-shadow)]"
        role="group"
        :aria-label="$t('workspace.pasteQueueLabel')"
      >
        <button
          type="button"
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="pasteQueue.length < 2"
          :title="$t('workspace.pasteQueuePrev')"
          :aria-label="$t('workspace.pasteQueuePrev')"
          @click="cyclePasteQueue(-1)"
        >
          <ArrowUp aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="pasteQueue.length < 2"
          :title="$t('workspace.pasteQueueNext')"
          :aria-label="$t('workspace.pasteQueueNext')"
          @click="cyclePasteQueue(1)"
        >
          <ArrowDown aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
        </button>
        <span
          class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-primary)]"
          :title="pasteQueueCurrent?.name"
        >
          @{{ pasteQueueCurrent?.name ?? $t('workspace.pastedImage') }}
        </span>
        <span
          class="shrink-0 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
        >
          {{ pasteQueueIndex + 1 }}/{{ pasteQueue.length }}
        </span>
        <Button
          data-testid="composer-paste-queue-send"
          variant="primary"
          size="sm"
          :disabled="inputLocked"
          :loading="Boolean(inputLocked)"
          :title="$t('workspace.pasteQueueSend')"
          @click="sendPasteQueue"
        >
          {{ $t('workspace.pasteQueueSend') }}
        </Button>
        <button
          type="button"
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          :title="$t('workspace.pasteQueueToDraft')"
          :aria-label="$t('workspace.pasteQueueToDraft')"
          @click="movePasteQueueItemToDraft"
        >
          <Pencil aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
          :title="$t('workspace.pasteQueueRemove')"
          :aria-label="$t('workspace.pasteQueueRemove')"
          @click="removePasteQueueCurrent"
        >
          <X aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
        </button>
      </div>
      <div
        ref="inputBox"
        class="command-console-input relative overflow-hidden rounded-[var(--radius-composer)] border border-[var(--composer-border)] bg-[var(--composer-bg)] shadow-[var(--composer-shadow)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)]"
        :class="{
          'command-console-input--ultra': showComposerFire,
          'composer-focused': editorFocused
        }"
        :aria-busy="busy"
        @mousedown="onEditorMouseDown"
      >
        <div
          class="composer-text-area relative z-10 w-full cursor-text whitespace-pre-wrap break-words bg-transparent text-[14px] leading-[1.65] text-[var(--text-primary)]"
          data-testid="composer-text-scroll"
        >
          <span
            v-if="workspace.draftSkill"
            data-testid="composer-skill-chip"
            contenteditable="false"
            class="mr-1 inline-flex h-6 max-w-[70%] translate-y-[1px] items-center gap-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-tint)] pl-2 pr-1 align-baseline font-[family-name:var(--font-mono)] text-[11px] font-medium leading-none text-[var(--accent)]"
          >
            <span class="truncate">@{{ workspace.draftSkill }}</span>
            <button
              type="button"
              tabindex="-1"
              class="inline-flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-[var(--bg-hover)]"
              :title="`${$t('common.delete')} @${workspace.draftSkill}`"
              :aria-label="`${$t('common.delete')} @${workspace.draftSkill}`"
              :disabled="inputLocked"
              @mousedown.prevent
              @click.stop="removeSelectedSkill"
            >
              <X aria-hidden="true" class="size-2.5" :stroke-width="2" />
            </button>
          </span>
          <div
            ref="editor"
            data-testid="composer-editor"
            role="textbox"
            :contenteditable="inputLocked ? 'false' : 'plaintext-only'"
            :aria-disabled="Boolean(inputLocked)"
            :aria-busy="Boolean(inputLocked)"
            :tabindex="inputLocked ? -1 : 0"
            aria-multiline="true"
            :aria-label="$t('workspace.composerPlaceholder')"
            :aria-expanded="skillMenuOpen"
            :aria-controls="skillMenuOpen ? 'composer-skill-listbox' : undefined"
            :aria-activedescendant="
              activeMentionSkill ? `composer-skill-${activeSkillIndex}` : undefined
            "
            aria-autocomplete="list"
            :data-placeholder="$t('workspace.composerPlaceholder')"
            :data-empty="!workspace.draft && !workspace.draftSkill ? 'true' : 'false'"
            class="composer-editor min-w-[1px] whitespace-pre-wrap break-words outline-none"
            @focus="onEditorFocus"
            @blur="onEditorBlur"
            @keydown="onKeydown"
            @input="onComposerInput"
            @click="updateSkillMention()"
            @paste="onPaste"
          ></div>
        </div>
        <Teleport to="body">
          <div
            v-if="skillMenuOpen"
            id="composer-skill-listbox"
            data-testid="composer-skill-menu"
            role="listbox"
            class="fixed z-[125] max-h-[224px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)]/95 p-1 shadow-[var(--shadow-popover)] backdrop-blur-xl"
            :style="skillMenuStyle"
            @mousedown.prevent
          >
            <p
              v-if="skills.skillsLoading"
              class="px-2.5 py-2 text-[11.5px] text-[var(--text-tertiary)]"
            >
              {{ $t('common.loading') }}
            </p>
            <p
              v-else-if="!filteredMentionSkills.length"
              class="px-2.5 py-2 text-[11.5px] text-[var(--text-tertiary)]"
            >
              {{ $t('workspace.noMatchingSkills') }}
            </p>
            <template v-else>
              <button
                v-for="(skill, index) in filteredMentionSkills"
                :id="`composer-skill-${index}`"
                :key="skill.name"
                type="button"
                role="option"
                :aria-selected="index === activeSkillIndex"
                class="flex h-9 w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 text-left outline-none"
                :class="
                  index === activeSkillIndex
                    ? 'bg-[var(--accent-tint)] text-[var(--accent)]'
                    : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                "
                @mouseenter="activeSkillIndex = index"
                @mousedown.prevent="selectSkill(skill)"
              >
                <span
                  class="max-w-[48%] shrink-0 truncate font-[family-name:var(--font-mono)] text-[11.5px] font-medium"
                >
                  @{{ skill.name }}
                </span>
                <span
                  v-if="skill.description"
                  class="min-w-0 flex-1 truncate text-[10.5px] text-[var(--text-secondary)]"
                >
                  {{ skill.description }}
                </span>
                <span
                  v-if="skillScopeLabel(skill)"
                  class="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)]"
                >
                  {{ skillScopeLabel(skill) }}
                </span>
              </button>
            </template>
          </div>
        </Teleport>
        <div class="command-console-controls flex min-w-0 flex-wrap items-center gap-2">
          <div class="composer-tools flex min-w-0 items-center gap-0.5">
            <button
              type="button"
              data-testid="composer-skill-trigger"
              class="cockpit-control-button inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="selectedImageModel || inputLocked"
              :title="$t('workspace.mentionSkill')"
              :aria-label="$t('workspace.mentionSkill')"
              @click="openSkillMention"
            >
              <AtSign aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
            </button>
            <button
              type="button"
              class="cockpit-control-button inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              :class="workspace.draftImages.length ? 'text-[var(--accent)]' : ''"
              :disabled="inputLocked || !supportsImages"
              :title="
                supportsImages ? $t('workspace.attachImage') : $t('workspace.imageUnsupported')
              "
              :aria-label="$t('workspace.attachImage')"
              @click="chooseImages"
            >
              <ImagePlus aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
            </button>
            <ComposerOptionMenu
              v-model="toolPreset"
              :label="$t('workspace.changeTools')"
              :heading="$t('workspace.changeTools')"
              :icon="Wrench"
              :options="toolOptions"
              :disabled="busy"
              :menu-width="390"
              @interact="emit('unlockAudio')"
            />
            <ComposerOptionMenu
              v-model="agentModeValue"
              :disabled="busy"
              :label="$t('workspace.agentModeLabel')"
              :heading="$t('workspace.agentModeHeading')"
              :icon="agentMode === 'plan' ? ListChecks : agentMode === 'goal' ? Target : Bot"
              :options="
                AGENT_MODES.map((mode) => ({
                  value: mode,
                  label: t(AGENT_MODE_LABEL_KEYS[mode]),
                  description: t(`${AGENT_MODE_LABEL_KEYS[mode]}Description`),
                  icon: mode === 'plan' ? ListChecks : mode === 'goal' ? Target : Bot
                }))
              "
              :menu-width="390"
              @interact="emit('unlockAudio')"
            />
            <ComposerOptionMenu
              v-model="permissionModeValue"
              :label="$t('workspace.permissionMode')"
              :heading="$t('workspace.permissionHeading')"
              :icon="ShieldCheck"
              :options="
                PERMISSION_MODES.map((mode) => ({
                  value: mode,
                  label: t(PERMISSION_MODE_LABEL_KEYS[mode]),
                  description: t(`${PERMISSION_MODE_LABEL_KEYS[mode]}Description`),
                  icon:
                    mode === 'ask' ? Hand : mode === 'accept-edits' ? SquareTerminal : ShieldAlert,
                  warning: mode === 'auto',
                  triggerLabel: mode === 'auto' ? t('workspace.permissionAutoShort') : undefined
                }))
              "
              :menu-width="390"
              @interact="emit('unlockAudio')"
            />
          </div>
          <div
            class="console-tool-strip ml-auto flex min-w-0 flex-1 items-center justify-end gap-1"
          >
            <ComposerModelPicker
              v-model:model="modelValue"
              v-model:thinking="thinkingValue"
              :options="modelOptions"
              :thinking-levels="thinkingStops"
              :thinking-labels="thinkingLabels"
              :disabled="busy || modelSwitching"
              @interact="emit('unlockAudio')"
              @open="refreshOpenCodeOptions"
            />
            <DropdownMenuRoot :modal="false">
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  data-testid="composer-more"
                  class="cockpit-control-button inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  :aria-label="$t('openCode.moreActions')"
                  :title="$t('openCode.moreActions')"
                >
                  <MoreHorizontal aria-hidden="true" class="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent
                  side="top"
                  align="end"
                  :side-offset="10"
                  :collision-padding="8"
                  class="composer-more-menu z-[125] min-w-48 rounded-[var(--menu-radius)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1.5 shadow-[var(--shadow-popover)]"
                >
                  <DropdownMenuItem as-child>
                    <button
                      type="button"
                      data-testid="composer-sound-toggle"
                      class="flex h-9 w-full items-center gap-2 rounded-[var(--radius-xs)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      :title="
                        soundEnabled ? $t('workspace.disableSound') : $t('workspace.enableSound')
                      "
                      :aria-label="
                        soundEnabled ? $t('workspace.disableSound') : $t('workspace.enableSound')
                      "
                      :aria-pressed="soundEnabled"
                      @click="onSoundToggle"
                    >
                      <Volume2 v-if="soundEnabled" aria-hidden="true" class="size-3.5" />
                      <VolumeX v-else aria-hidden="true" class="size-3.5 opacity-60" />
                      <span>{{
                        soundEnabled ? $t('workspace.disableSound') : $t('workspace.enableSound')
                      }}</span>
                    </button>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
            <WorkspaceVoiceControl />
            <Button
              v-if="busy"
              data-testid="composer-abort"
              class="composer-abort-button"
              variant="secondary"
              size="sm"
              :aria-label="$t('workspace.abort')"
              :title="$t('workspace.abort')"
              @click="emit('abort')"
            >
              <Square aria-hidden="true" class="size-3.5 fill-current" />
            </Button>
            <Button
              class="command-execute-button"
              variant="primary"
              size="sm"
              :aria-label="$t('workspace.send')"
              :title="$t('workspace.send')"
              :disabled="!canSend"
              :loading="Boolean(inputLocked)"
              @click="emitSend"
            >
              <ArrowUp aria-hidden="true" class="size-[18px]" :stroke-width="2" />
            </Button>
          </div>
        </div>
      </div>
      <p class="command-console-hint mt-2 px-2 text-[10.5px] text-[var(--text-tertiary)]">
        {{ $t('workspace.sendHint') }}
      </p>
      <div
        v-if="dragActive"
        class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-[var(--accent)] bg-[var(--bg-surface-raised)]/90 text-[12px] font-medium text-[var(--accent)]"
      >
        <ImagePlus aria-hidden="true" class="mr-2 size-4" />
        {{ $t('workspace.dropImages') }}
      </div>

      <AgentAuraFireBorder v-if="showComposerFire" :active="true" :target="inputBox" />
      <Dialog v-model:open="previewOpen" wide :title="$t('workspace.previewImage')">
        <img
          v-if="previewImage"
          :src="previewSource(previewImage)"
          :alt="previewImage.name"
          class="max-h-[68vh] w-full object-contain"
        />
      </Dialog>
    </div>
  </div>
</template>

<style scoped>
/*
 * Composer content shares the transcript's centered band width so the input
 * lines up with the message column above it.
 */
.composer-band {
  width: min(100%, var(--chat-composer-max-width, var(--chat-content-max-width, 760px)));
  margin-inline: auto;
  /* Enable container queries so the control row can degrade to icon-only
   * buttons based on the composer band's own width, not the window's. */
  container-type: inline-size;
}

.command-console--ultra {
  border-top-color: transparent;
}

.command-console-input--ultra {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  clip-path: none;
}

/* Keep the placeholder out of the editable line so Chromium can paint the
 * native caret at the start of an empty draft. */
.composer-editor {
  position: relative;
  -webkit-user-select: text;
  user-select: text;
  display: block;
  min-height: 44px;
  width: 100%;
  caret-color: var(--text-primary);
}

.composer-editor:empty {
  min-width: 1px;
}

.composer-editor[data-empty='true']::before {
  position: absolute;
  top: 0;
  left: 0;
  white-space: nowrap;
  color: var(--control-placeholder);
  width: max-content;
  max-width: calc(100cqw - 2 * var(--composer-padding));
  overflow: hidden;
  text-overflow: ellipsis;
  content: attr(data-placeholder);
  pointer-events: none;
}

.composer-editor:focus,
.composer-editor:focus-visible {
  border-radius: 0;
  box-shadow: none;
  outline: none;
}

/* The editable region grows naturally, then scrolls without moving the actions. */
.composer-text-area {
  -webkit-user-select: text;
  user-select: text;
  overscroll-behavior: contain;
  min-height: 76px;
  max-height: min(240px, 32vh);
  overflow-y: auto;
  overflow-wrap: anywhere;
  padding: var(--composer-padding) var(--composer-padding) 8px;
}

.command-console-input.composer-focused {
  border-color: var(--accent-border);
  box-shadow:
    var(--composer-shadow),
    0 0 0 1px var(--accent-border);
}

.command-console-controls {
  padding: 0 10px 10px;
}

.composer-tools > *,
.console-tool-strip > :not([data-testid='workspace-model-select']) {
  flex-shrink: 0;
}

.console-tool-strip :deep([data-testid='workspace-model-select']) {
  min-width: 100px;
  max-width: 240px;
}

.console-tool-strip :deep(.ui-select-trigger) {
  height: 32px;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  color: var(--text-secondary);
  font-size: 12px;
}

.command-execute-button,
.composer-abort-button {
  width: var(--composer-action-size);
  height: var(--composer-action-size);
  padding: 0;
  border-radius: var(--radius-pill);
}

@container (max-width: 720px) {
  .command-console-controls :deep(.composer-option-label) {
    display: none;
  }
  .composer-tools :deep(.cockpit-control-button) {
    width: 32px;
    padding-inline: 0;
    justify-content: center;
  }
}

@container (max-width: 420px) {
  .console-tool-strip {
    flex-basis: 100%;
  }
}
</style>
