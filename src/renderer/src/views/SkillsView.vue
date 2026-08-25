<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Download,
  Eye,
  FileEdit,
  FileInput,
  FilePlus2,
  FolderOpen,
  Link2,
  Package as PackageIcon,
  Power,
  PowerOff,
  Puzzle,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  Sparkles,
  Store as StoreIcon,
  Trash2,
  Wrench
} from '@lucide/vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { toast } from 'vue-sonner'
import type {
  BuiltinSkillHealth,
  BuiltinSkillInfo,
  BuiltinSkillInstallation,
  BuiltinSkillMarketCollection,
  PackageSkillMarketCollection,
  PiPackageHealth,
  PiPackageInfo,
  PiPackageScope,
  SkillInfo,
  SkillMarketCollection,
  SkillMarketPackage
} from '@shared/ipc/api-types'
import type { CapabilityDescriptor } from '@shared/capabilities/types'
import type { SkillForm, SkillImportInput } from '@shared/schemas/domain'
import Badge from '@renderer/components/ui/Badge.vue'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import Input from '@renderer/components/ui/Input.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import SearchField from '@renderer/components/ui/SearchField.vue'
import Select from '@renderer/components/ui/Select.vue'
import { graphiteEditorTheme, graphiteSyntaxHighlighting } from '@renderer/styles/codemirror'
import { MARKET_PACKAGE_DESCRIPTION_KEYS } from '@renderer/i18n/marketplace'
import { useSkillsStore } from '@renderer/stores/skills'
import { usePiStore } from '@renderer/stores/pi'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { getApi, getErrorPayload } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { formatRelativeTime } from '@renderer/utils/format'

type ViewMode = 'skills' | 'packages' | 'market'

const { t } = useI18n()
const store = useSkillsStore()
const pi = usePiStore()
const workspace = useWorkspaceStore()

const mode = ref<ViewMode>('skills')
const query = ref('')
const selectedPackageId = ref<string | null>(null)
const selectedPackageIds = ref<string[]>([])
const packageHealthFilter = ref<'all' | PiPackageHealth>('all')
const packageScopeFilter = ref<'all' | PiPackageScope>('all')
const marketInstallScope = ref<PiPackageScope>('global')
const selectedCollectionId = ref<string | null>(null)
const selectedCapabilityId = ref<string | null>(null)
const installKey = ref<string | null>(null)
const removeKey = ref<string | null>(null)

const deleteOpen = ref(false)
const editorOpen = ref(false)
const importOpen = ref(false)
const packageRemoveOpen = ref(false)
const importBusy = ref(false)
const saveBusy = ref(false)
const packageRemoveBusy = ref(false)
const packageActionBusy = ref<string | null>(null)
const cleanupBusy = ref(false)
const deleting = ref<SkillInfo | null>(null)
const editing = ref<SkillInfo | null>(null)
const removingPackage = ref<PiPackageInfo | null>(null)

const editorHost = ref<HTMLElement | null>(null)
let editorView: EditorView | null = null

const form = reactive<{
  name: string
  description: string
  content: string
  targetRoot: string
  expectedMtime: number | null
}>({
  name: '',
  description: '',
  content: t('skills.starterContent'),
  targetRoot: '',
  expectedMtime: null
})

const importForm = reactive<{ source: string; name: string; targetRoot: string }>({
  source: '',
  name: '',
  targetRoot: ''
})

const knownRoots = computed(() => {
  const fromEnv = pi.environment?.skillsDirs ?? []
  const fromSkills = store.skills.filter((skill) => !skill.readOnly).map((skill) => skill.source)
  return Array.from(new Set([...fromEnv, ...fromSkills].filter(Boolean)))
})

const filteredSkills = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.skills
  return store.skills.filter((skill) => {
    return (
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.source.toLowerCase().includes(q) ||
      (skill.packageSource ?? '').toLowerCase().includes(q) ||
      (skill.builtinCategory ?? '').toLowerCase().includes(q) ||
      (skill.builtinCollectionName ?? '').toLowerCase().includes(q) ||
      (skill.builtinRepository ?? '').toLowerCase().includes(q)
    )
  })
})

const filteredPackages = computed(() => {
  const q = query.value.trim().toLowerCase()
  return store.packages.filter(
    (pkg) =>
      (packageHealthFilter.value === 'all' || pkg.health === packageHealthFilter.value) &&
      (packageScopeFilter.value === 'all' || pkg.scope === packageScopeFilter.value) &&
      (!q ||
        pkg.name.toLowerCase().includes(q) ||
        pkg.source.toLowerCase().includes(q) ||
        pkg.description.toLowerCase().includes(q))
  )
})

const filteredMarket = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.market
  return store.market.filter((collection) => {
    if (
      marketCollectionTitle(collection).toLowerCase().includes(q) ||
      marketCollectionSummary(collection).toLowerCase().includes(q)
    ) {
      return true
    }
    if (isBuiltinCollection(collection)) {
      return (
        collection.author.toLowerCase().includes(q) ||
        collection.repository.toLowerCase().includes(q) ||
        collection.skills.some(
          (skill) =>
            skill.name.toLowerCase().includes(q) ||
            skill.description.toLowerCase().includes(q) ||
            skill.category.includes(q)
        )
      )
    }
    return collection.packages.some(
      (pkg) =>
        pkg.name.toLowerCase().includes(q) ||
        pkg.source.toLowerCase().includes(q) ||
        marketPackageDescription(pkg).toLowerCase().includes(q)
    )
  })
})

const selectedSkill = computed(() =>
  store.skills.find((skill) => skill.path === store.selectedPath)
)
const selectedSkillPackage = computed(() =>
  selectedSkill.value?.packageId
    ? store.packages.find((pkg) => pkg.id === selectedSkill.value?.packageId)
    : undefined
)
const selectedPackage = computed(() =>
  store.packages.find((pkg) => pkg.id === selectedPackageId.value)
)
const selectedPackageResult = computed(() => {
  if (!selectedPackage.value) return null
  return (
    store.packageResults.find(
      (result) =>
        result.source === selectedPackage.value?.source &&
        result.scope === selectedPackage.value?.scope
    ) ?? null
  )
})
const selectedCollection = computed(() =>
  store.market.find((collection) => collection.id === selectedCollectionId.value)
)
const selectedCapability = computed(() =>
  store.featuredSkills.find((capability) => capability.id === selectedCapabilityId.value)
)

watch(mode, () => {
  query.value = ''
})

watch(
  () => workspace.currentCwd,
  (cwd) => {
    if (!cwd && marketInstallScope.value === 'project') marketInstallScope.value = 'global'
  }
)

watch(editorOpen, async (open) => {
  if (open) {
    await nextTick()
    mountEditor(form.content)
  } else {
    destroyEditor()
  }
})

onMounted(async () => {
  if (!pi.environment) await pi.detect().catch(() => undefined)
  await store.fetchList()
  selectDefaults()
})

function selectDefaults() {
  if (!selectedCapabilityId.value && store.featuredSkills[0]) {
    selectedCapabilityId.value = store.featuredSkills[0].id
  } else if (!store.selectedPath && store.skills[0]) {
    void store.loadDetail(store.skills[0].path)
  }
  if (!selectedPackageId.value && store.packages[0]) {
    selectedPackageId.value = store.packages[0].id
  }
  if (!selectedCollectionId.value && store.market[0]) {
    selectedCollectionId.value = store.market[0].id
  }
}

function selectSkill(skill: SkillInfo) {
  selectedCapabilityId.value = null
  void store.loadDetail(skill.path)
}

function selectCapability(capability: CapabilityDescriptor) {
  selectedCapabilityId.value = capability.id
}

function capabilityStatusLabel(capability: CapabilityDescriptor): string {
  const progress = store.capabilityProgress[capability.id]
  if (progress && ['resolving', 'installing', 'validating'].includes(progress.phase)) {
    return t(`skills.capabilityPhase${progress.phase[0].toUpperCase()}${progress.phase.slice(1)}`)
  }
  if (store.capabilityErrors[capability.id] || capability.status === 'failed') {
    return t('skills.capabilityStatusFailed')
  }
  if (!capability.installed) return t('skills.capabilityStatusNotInstalled')
  if (!capability.enabled) return t('skills.capabilityStatusDisabled')
  if (capability.updateAvailable) return t('skills.capabilityStatusUpdateAvailable')
  return t('skills.capabilityStatusInstalled')
}

function capabilityStatusTone(
  capability: CapabilityDescriptor
): 'muted' | 'success' | 'warning' | 'error' | 'accent' {
  if (store.installingIds.includes(capability.id)) return 'accent'
  if (store.capabilityErrors[capability.id] || capability.status === 'failed') return 'error'
  if (!capability.installed) return 'muted'
  if (!capability.enabled || capability.updateAvailable) return 'warning'
  return 'success'
}

function capabilityErrorMessage(capability: CapabilityDescriptor): string | null {
  const errorCode = store.capabilityErrors[capability.id]?.code ?? capability.lastErrorCode
  if (!errorCode) return null
  const knownCodes = [
    'SKILL_NOT_FOUND',
    'SKILL_ALREADY_INSTALLED',
    'SKILL_INSTALL_FAILED',
    'SKILL_INVALID',
    'SKILL_PATH_INVALID',
    'SKILL_PERMISSION_DENIED',
    'SKILL_CONFLICT',
    'NETWORK_ERROR',
    'PROCESS_FAILED'
  ]
  return knownCodes.includes(errorCode)
    ? t(`skills.capabilityError${errorCode}`)
    : t('skills.capabilityErrorUnknown')
}

function capabilityErrorCode(capability: CapabilityDescriptor) {
  return store.capabilityErrors[capability.id]?.code ?? capability.lastErrorCode
}

function capabilityUseCaseLabel(useCase: string): string {
  const suffix = useCase
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('')
  return t(`skills.capabilityUseCase${suffix}`)
}

async function installCapability(capability: CapabilityDescriptor) {
  try {
    await store.installSkill(capability.id)
    toast.success(t('skills.capabilityInstalled', { name: capability.name }))
  } catch {
    toast.error(capabilityErrorMessage(capability) ?? t('skills.capabilityInstallFailed'))
  }
}

async function updateCapability(capability: CapabilityDescriptor) {
  try {
    await store.updateSkill(capability.id)
    toast.success(t('skills.capabilityUpdated', { name: capability.name }))
  } catch {
    toast.error(capabilityErrorMessage(capability) ?? t('skills.capabilityUpdateFailed'))
  }
}

async function toggleCapability(capability: CapabilityDescriptor) {
  try {
    await store.setSkillEnabled(capability.id, !capability.enabled)
    toast.success(
      capability.enabled
        ? t('skills.capabilityDisabled', { name: capability.name })
        : t('skills.capabilityEnabled', { name: capability.name })
    )
  } catch {
    toast.error(capabilityErrorMessage(capability) ?? t('skills.capabilityToggleFailed'))
  }
}

async function uninstallCapability(capability: CapabilityDescriptor) {
  const confirmed = await askConfirm({
    title: t('skills.capabilityUninstallTitle', { name: capability.name }),
    description: t('skills.capabilityUninstallHint'),
    confirmLabel: t('skills.capabilityUninstall'),
    tone: 'danger'
  })
  if (!confirmed) return
  try {
    await store.uninstallSkill(capability.id)
    toast.success(t('skills.capabilityUninstalled', { name: capability.name }))
  } catch {
    toast.error(capabilityErrorMessage(capability) ?? t('skills.capabilityUninstallFailed'))
  }
}

async function viewInstalledCapability(capability: CapabilityDescriptor) {
  if (!capability.installPath) return
  selectedCapabilityId.value = null
  await store.loadDetail(capability.installPath)
}

async function editInstalledCapability(capability: CapabilityDescriptor) {
  if (!capability.installPath) return
  const skill = store.skills.find((entry) => entry.path === capability.installPath)
  if (skill && !skill.readOnly) await openEdit(skill)
}

async function refreshAll() {
  await store.refresh()
  if (
    selectedPackageId.value &&
    !store.packages.some((pkg) => pkg.id === selectedPackageId.value)
  ) {
    selectedPackageId.value = null
  }
  selectDefaults()
  toast.success(t('common.refreshed'))
}

function openCreate() {
  editing.value = null
  form.name = ''
  form.description = ''
  form.content = t('skills.starterContent')
  form.targetRoot = knownRoots.value[0] ?? ''
  form.expectedMtime = null
  editorOpen.value = true
}

async function openEdit(skill: SkillInfo) {
  if (skill.readOnly) return
  editing.value = skill
  form.name = skill.name
  form.description = skill.description
  form.targetRoot = skill.source
  form.expectedMtime = null
  try {
    await store.loadDetail(skill.path)
    form.content = store.detailContent || `# ${skill.name}\n\n`
    form.expectedMtime = store.detailMtime
  } catch {
    form.content = `# ${skill.name}\n\n`
  }
  editorOpen.value = true
}

function openImport() {
  importForm.source = ''
  importForm.name = ''
  importForm.targetRoot = knownRoots.value[0] ?? ''
  importOpen.value = true
}

function mountEditor(doc: string) {
  destroyEditor()
  if (!editorHost.value) return
  editorView = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        markdown(),
        graphiteEditorTheme,
        graphiteSyntaxHighlighting,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) form.content = update.state.doc.toString()
        })
      ]
    })
  })
}

function destroyEditor() {
  editorView?.destroy()
  editorView = null
}

async function saveSkill(overwrite = false) {
  if (!form.targetRoot) {
    toast.error(t('skills.requiredField', { field: t('skills.fieldTargetRoot') }))
    return
  }
  const payload: SkillForm = {
    name: form.name.trim(),
    description: form.description.trim(),
    content: form.content,
    targetRoot: form.targetRoot,
    expectedMtime: editing.value ? form.expectedMtime : null,
    overwrite: overwrite || undefined
  }
  saveBusy.value = true
  try {
    const validation = await getApi().skills.validate(payload)
    if (!validation.valid) {
      toast.error(validation.issues.map((issue) => issue.message).join('\n'))
      return
    }
    if (editing.value) {
      await getApi().skills.update(payload)
      toast.success(t('skills.updated', { name: payload.name }))
    } else {
      await getApi().skills.create(payload)
      toast.success(t('skills.created', { name: payload.name }))
    }
    editorOpen.value = false
    await store.refresh()
    const found = store.skills.find(
      (skill) => skill.name === payload.name && skill.source === payload.targetRoot
    )
    if (found) await store.loadDetail(found.path)
  } catch (error) {
    const errorPayload = getErrorPayload(error)
    if (errorPayload.code === 'SKILL_CONFLICT' && editing.value) {
      const overwriteOk = await askConfirm({
        title: t('skills.conflictOverwriteTitle'),
        description: t('skills.conflictConfirm'),
        confirmLabel: t('skills.conflictOverwriteAction'),
        tone: 'danger'
      })
      if (overwriteOk) {
        await saveSkill(true)
        return
      }
      const reloadOk = await askConfirm({
        title: t('skills.conflictReloadTitle'),
        description: t('skills.conflictReload'),
        confirmLabel: t('skills.conflictReloadAction'),
        tone: 'primary'
      })
      if (reloadOk && editing.value) await openEdit(editing.value)
      return
    }
    toast.error(errorPayload.message ?? t('skills.saveFailed'))
  } finally {
    saveBusy.value = false
  }
}

async function startImport() {
  if (!importForm.source || !importForm.targetRoot) {
    toast.error(t('skills.importRequired'))
    return
  }
  importBusy.value = true
  try {
    const payload: SkillImportInput = {
      source: importForm.source,
      targetRoot: importForm.targetRoot,
      name: importForm.name || deriveName(importForm.source),
      onConflict: 'cancel'
    }
    await getApi().skills.import(payload)
    toast.success(t('skills.imported', { name: payload.name }))
    importOpen.value = false
    await store.refresh()
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.importFailed'))
  } finally {
    importBusy.value = false
  }
}

function deriveName(source: string): string {
  const segments = source.replace(/[\\/]+$/, '').split(/[\\/]/)
  return (segments.at(-1) ?? 'imported-skill')
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
}

async function reveal(target: string) {
  try {
    await getApi().system.showItem(target)
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.revealFailed'))
  }
}

async function openPath(target: string | null) {
  if (!target) return
  try {
    await getApi().system.openPath(target)
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.openFailed'))
  }
}

function askDelete(skill: SkillInfo) {
  if (skill.readOnly) return
  deleting.value = skill
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deleting.value) return
  try {
    await store.remove(deleting.value.path)
    toast.success(t('skills.deleted'))
    deleteOpen.value = false
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.deleteFailed'))
  }
}

async function installPackages(key: string, packages: SkillMarketPackage[]) {
  const sources = packages.filter((pkg) => !marketPackageInstalled(pkg)).map((pkg) => pkg.source)
  if (sources.length === 0) {
    toast.success(t('skills.marketAlreadyInstalled'))
    return
  }
  installKey.value = key
  try {
    const results = await store.installPackages(sources, marketInstallScope.value)
    const failures = results.filter((result) => !result.ok)
    const installedCount = results.filter((result) => result.ok && !result.skipped).length
    if (failures.length) {
      toast.error(
        t('skills.packageInstallPartial', {
          installed: installedCount,
          failed: failures.length,
          name: failures[0].source
        })
      )
    } else {
      toast.success(t('skills.packageInstalled', { count: installedCount }))
    }
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.packageInstallFailed'))
  } finally {
    installKey.value = null
  }
}

function marketInstalledId(pkg: SkillMarketPackage): string {
  return installedMarketPackage(pkg)?.id ?? pkg.source
}

function installedMarketPackage(pkg: SkillMarketPackage): PiPackageInfo | undefined {
  return (
    store.packages.find(
      (installed) => installed.scope === marketInstallScope.value && installed.source === pkg.source
    ) ??
    store.packages.find(
      (installed) => installed.scope === marketInstallScope.value && installed.name === pkg.name
    )
  )
}

function marketPackageInstalled(pkg: SkillMarketPackage): boolean {
  return Boolean(installedMarketPackage(pkg)?.registered)
}

function marketPackageVersion(pkg: SkillMarketPackage): string | null {
  return installedMarketPackage(pkg)?.version ?? null
}

async function removeMarketPackages(key: string, packages: SkillMarketPackage[]) {
  const installedPackages = packages.filter(marketPackageInstalled)
  const packageIds = [...new Set(installedPackages.map(marketInstalledId))]
  if (packageIds.length === 0) {
    toast.success(t('skills.marketAlreadyRemoved'))
    return
  }

  const confirmed = await askConfirm({
    title: t('skills.removePackagesTitle', { count: packageIds.length }),
    description: t('skills.removePackagesHint'),
    confirmLabel: packageIds.length === 1 ? t('skills.removePackage') : t('skills.removeInstalled'),
    tone: 'danger'
  })
  if (!confirmed) return

  removeKey.value = key
  try {
    const results = await store.removePackages(packageIds)
    const failures = results.filter((result) => !result.ok)
    const removedCount = results.filter((result) => result.ok && !result.skipped).length
    if (failures.length) {
      toast.error(
        t('skills.packageRemovePartial', {
          removed: removedCount,
          failed: failures.length,
          name: failures[0].source
        })
      )
    } else if (removedCount === 0) {
      toast.success(t('skills.marketAlreadyRemoved'))
    } else if (installedPackages.length === 1) {
      toast.success(t('skills.packageRemoved', { name: installedPackages[0].name }))
    } else {
      toast.success(t('skills.packagesRemoved', { count: removedCount }))
    }
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.packageRemoveFailed'))
  } finally {
    removeKey.value = null
  }
}

async function installBuiltinCollectionSkills(
  collection: BuiltinSkillMarketCollection,
  skills: BuiltinSkillInfo[],
  overwrite = false
) {
  const candidates = skills.filter((skill) => !builtinSkillInstalled(skill))
  if (!candidates.length) {
    toast.success(t('skills.builtinAlreadyInstalled'))
    return
  }
  const key = candidates.length === 1 ? candidates[0].id : collection.id
  installKey.value = key
  let conflictSkills: BuiltinSkillInfo[] = []
  try {
    const results = await store.installBuiltinSkills(
      collection.id,
      candidates.map((skill) => skill.id),
      marketInstallScope.value,
      overwrite
    )
    const failures = results.filter((result) => !result.ok)
    const conflictIds = new Set(
      !overwrite
        ? failures
            .filter((result) => result.errorCode === 'SKILL_CONFLICT')
            .map((result) => result.skillId)
        : []
    )
    conflictSkills = candidates.filter((skill) => conflictIds.has(skill.id))
    if (failures.length && !conflictSkills.length) {
      toast.error(
        t('skills.builtinInstallPartial', {
          installed: results.filter((result) => result.ok && !result.skipped).length,
          failed: failures.length,
          name: failures[0].skillId
        })
      )
    } else if (!failures.length) {
      toast.success(
        t('skills.builtinInstalled', {
          count: results.filter((result) => result.ok && !result.skipped).length
        })
      )
    }
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.builtinInstallFailed'))
  } finally {
    installKey.value = null
  }
  if (!conflictSkills.length) return
  const confirmed = await askConfirm({
    title: t('skills.builtinConflictTitle'),
    description: t('skills.builtinConflictHint', { count: conflictSkills.length }),
    confirmLabel: t('skills.builtinOverwrite'),
    tone: 'danger'
  })
  if (confirmed) await installBuiltinCollectionSkills(collection, conflictSkills, true)
}

async function updateBuiltinCollectionSkill(
  collection: BuiltinSkillMarketCollection,
  skill: BuiltinSkillInfo
) {
  const installation = currentBuiltinInstallation(skill)
  if (!installation?.owned) return
  if (installation.modified) {
    const confirmed = await askConfirm({
      title: t('skills.builtinModifiedTitle', { name: skill.name }),
      description: t('skills.builtinModifiedHint'),
      confirmLabel: t('skills.builtinOverwriteUpdate'),
      tone: 'danger'
    })
    if (!confirmed) return
  }
  installKey.value = skill.id
  try {
    const [result] = await store.updateBuiltinSkills(
      collection.id,
      [skill.id],
      marketInstallScope.value,
      true
    )
    if (!result?.ok) throw new Error(result?.message ?? t('skills.builtinUpdateFailed'))
    toast.success(t('skills.builtinUpdated', { name: skill.name }))
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.builtinUpdateFailed'))
  } finally {
    installKey.value = null
  }
}

async function uninstallBuiltinCollectionSkills(
  collection: BuiltinSkillMarketCollection,
  skills: BuiltinSkillInfo[]
) {
  const owned = skills.filter(builtinSkillOwned)
  if (!owned.length) {
    toast.success(t('skills.builtinAlreadyRemoved'))
    return
  }
  const confirmed = await askConfirm({
    title: t('skills.builtinRemoveTitle', { count: owned.length }),
    description: t('skills.builtinRemoveHint'),
    confirmLabel: owned.length === 1 ? t('skills.uninstallSkill') : t('skills.builtinRemoveAll'),
    tone: 'danger'
  })
  if (!confirmed) return
  const key = owned.length === 1 ? owned[0].id : collection.id
  removeKey.value = key
  try {
    const results = await store.uninstallBuiltinSkills(
      collection.id,
      owned.map((skill) => skill.id),
      marketInstallScope.value
    )
    const failures = results.filter((result) => !result.ok)
    if (failures.length) {
      toast.error(t('skills.builtinRemovePartial', { count: failures.length }))
    } else {
      toast.success(t('skills.builtinRemoved', { count: results.length }))
    }
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.builtinRemoveFailed'))
  } finally {
    removeKey.value = null
  }
}

function askRemovePackage(pkg: PiPackageInfo) {
  removingPackage.value = pkg
  packageRemoveOpen.value = true
}

async function confirmRemovePackage() {
  if (!removingPackage.value) return
  packageRemoveBusy.value = true
  try {
    const result = await store.removePackage(removingPackage.value)
    if (!result.ok) throw new Error(result.stderr || result.message)
    toast.success(t('skills.packageRemoved', { name: removingPackage.value.name }))
    selectedPackageId.value = store.packages[0]?.id ?? null
    packageRemoveOpen.value = false
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.packageRemoveFailed'))
  } finally {
    packageRemoveBusy.value = false
  }
}

async function repairPackage(pkg: PiPackageInfo) {
  packageActionBusy.value = pkg.id
  try {
    const result = await store.repairPackage(pkg)
    if (!result.ok) throw new Error(result.stderr || result.message)
    toast.success(t('skills.packageRepaired', { name: pkg.name }))
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.packageRepairFailed'))
  } finally {
    packageActionBusy.value = null
  }
}

async function registerPackage(pkg: PiPackageInfo) {
  packageActionBusy.value = pkg.id
  try {
    const result = await store.registerPackage(pkg)
    if (!result.ok) throw new Error(result.stderr || result.message)
    toast.success(t('skills.packageRegistered', { name: pkg.name }))
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.packageRegisterFailed'))
  } finally {
    packageActionBusy.value = null
  }
}

async function deleteOrphanPackage(pkg: PiPackageInfo) {
  const confirmed = await askConfirm({
    title: t('skills.deleteOrphanTitle'),
    description: t('skills.deleteOrphanHint', { path: pkg.path || '—' }),
    confirmLabel: t('common.delete'),
    tone: 'danger'
  })
  if (!confirmed) return
  packageActionBusy.value = pkg.id
  try {
    const result = await store.deleteOrphanPackage(pkg)
    if (!result.ok) throw new Error(result.stderr || result.message)
    selectedPackageId.value = store.packages[0]?.id ?? null
    toast.success(t('skills.orphanDeleted'))
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.orphanDeleteFailed'))
  } finally {
    packageActionBusy.value = null
  }
}

async function repairPackagePermissions() {
  packageActionBusy.value = 'permissions'
  try {
    const permissions = await store.repairPermissions()
    const remaining = permissions.filter((entry) => entry.problem).length
    if (remaining) toast.warning(t('skills.permissionsRemain', { count: remaining }))
    else toast.success(t('skills.permissionsRepaired'))
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.permissionsRepairFailed'))
  } finally {
    packageActionBusy.value = null
  }
}

async function removeSelectedPackages() {
  if (!selectedPackageIds.value.length) return
  const confirmed = await askConfirm({
    title: t('skills.removePackagesTitle', { count: selectedPackageIds.value.length }),
    description: t('skills.removePackagesHint'),
    confirmLabel: t('skills.removeInstalled'),
    tone: 'danger'
  })
  if (!confirmed) return
  packageActionBusy.value = 'bulk-remove'
  try {
    const results = await store.removePackages(selectedPackageIds.value)
    const failures = results.filter((result) => !result.ok)
    selectedPackageIds.value = []
    if (failures.length) toast.error(t('skills.packageBulkFailures', { count: failures.length }))
    else toast.success(t('skills.packagesRemoved', { count: results.length }))
  } finally {
    packageActionBusy.value = null
  }
}

async function cleanupThirdParty() {
  cleanupBusy.value = true
  try {
    const plan = await store.getCleanupPlan()
    const total = plan.packages.length + plan.orphanPackages.length + plan.standaloneSkills.length
    if (!total) {
      toast.success(t('skills.cleanupEmpty'))
      return
    }
    const confirmed = await askConfirm({
      title: t('skills.cleanupTitle'),
      description: t('skills.cleanupHint', {
        packages: plan.packages.length,
        orphaned: plan.orphanPackages.length,
        skills: plan.standaloneSkills.length
      }),
      confirmLabel: t('skills.cleanupAction'),
      tone: 'danger'
    })
    if (!confirmed) return
    const result = await store.cleanupThirdParty()
    selectedPackageIds.value = []
    selectedPackageId.value = store.packages[0]?.id ?? null
    if (result.failures.length) {
      toast.error(t('skills.cleanupPartial', { count: result.failures.length }))
    } else {
      toast.success(t('skills.cleanupDone'))
    }
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.cleanupFailed'))
  } finally {
    cleanupBusy.value = false
  }
}

function togglePackageSelection(pkg: PiPackageInfo) {
  selectedPackageIds.value = selectedPackageIds.value.includes(pkg.id)
    ? selectedPackageIds.value.filter((id) => id !== pkg.id)
    : [...selectedPackageIds.value, pkg.id]
}

function viewOwningPackage(skill: SkillInfo) {
  if (!skill.packageId) return
  mode.value = 'packages'
  selectedPackageId.value = skill.packageId
}

function isBuiltinCollection(
  collection: SkillMarketCollection
): collection is BuiltinSkillMarketCollection {
  return collection.kind === 'builtin-skills'
}

function isPackageCollection(
  collection: SkillMarketCollection
): collection is PackageSkillMarketCollection {
  return collection.kind !== 'builtin-skills'
}

function currentBuiltinInstallation(skill: BuiltinSkillInfo): BuiltinSkillInstallation | undefined {
  return skill.installations.find((installation) => installation.scope === marketInstallScope.value)
}

function builtinSkillInstalled(skill: BuiltinSkillInfo): boolean {
  const installation = currentBuiltinInstallation(skill)
  return Boolean(installation?.owned && installation.installed)
}

function builtinSkillOwned(skill: BuiltinSkillInfo): boolean {
  return Boolean(currentBuiltinInstallation(skill)?.owned)
}

function builtinSkillHealth(skill: BuiltinSkillInfo): BuiltinSkillHealth {
  return currentBuiltinInstallation(skill)?.health ?? 'not-installed'
}

function installedCount(collection: SkillMarketCollection): number {
  return isBuiltinCollection(collection)
    ? collection.skills.filter(builtinSkillInstalled).length
    : collection.packages.filter(marketPackageInstalled).length
}

function hasMissingPackages(collection: SkillMarketCollection): boolean {
  return installedCount(collection) < collectionItemCount(collection)
}

function collectionItemCount(collection: SkillMarketCollection): number {
  return isBuiltinCollection(collection) ? collection.skills.length : collection.packages.length
}

function collectionUnit(collection: SkillMarketCollection): string {
  return isBuiltinCollection(collection) ? t('skills.skillsUnit') : t('skills.packagesUnit')
}

function collectionKindLabel(collection: SkillMarketCollection): string {
  if (isBuiltinCollection(collection)) return t('skills.marketBuiltin')
  return collection.kind === 'bundle' ? t('skills.marketBundle') : t('skills.marketGuide')
}

function collectionKindTone(
  collection: SkillMarketCollection
): 'muted' | 'success' | 'warning' | 'error' | 'accent' {
  if (isBuiltinCollection(collection)) return 'success'
  return collection.kind === 'bundle' ? 'accent' : 'muted'
}

function isInstallDisabled(key: string): boolean {
  return removeKey.value !== null || (installKey.value !== null && installKey.value !== key)
}

function isRemoveDisabled(key: string): boolean {
  return installKey.value !== null || (removeKey.value !== null && removeKey.value !== key)
}

function marketCollectionTitle(collection: SkillMarketCollection): string {
  if (isBuiltinCollection(collection)) return collection.displayName
  if (collection.id === 'core-development') return t('skills.marketCoreTitle')
  if (collection.id === 'agent-architecture') return t('skills.marketAgentTitle')
  if (collection.id === 'curated-extensions') return t('skills.marketCuratedTitle')
  return collection.id
}

function marketCollectionSummary(collection: SkillMarketCollection): string {
  if (isBuiltinCollection(collection)) {
    return `${collection.name} · ${collection.author} · ${collection.repository}`
  }
  if (collection.id === 'core-development') return t('skills.marketCoreSummary')
  if (collection.id === 'agent-architecture') return t('skills.marketAgentSummary')
  if (collection.id === 'curated-extensions') return t('skills.marketCuratedSummary')
  return ''
}

function builtinHealthLabel(health: BuiltinSkillHealth): string {
  const suffix = health.replace(/(^|-)(\w)/g, (_, _dash, letter) => letter.toUpperCase())
  return t(`skills.builtinHealth${suffix}`)
}

function builtinHealthTone(
  health: BuiltinSkillHealth
): 'muted' | 'success' | 'warning' | 'error' | 'accent' {
  if (health === 'healthy') return 'success'
  if (health === 'not-installed') return 'muted'
  if (health === 'update-available') return 'accent'
  if (health === 'missing' || health === 'corrupted') return 'error'
  return 'warning'
}

function visibleBuiltinSkills(collection: BuiltinSkillMarketCollection): BuiltinSkillInfo[] {
  const q = query.value.trim().toLowerCase()
  if (!q) return collection.skills
  return collection.skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.category.includes(q) ||
      collection.author.toLowerCase().includes(q) ||
      collection.name.toLowerCase().includes(q)
  )
}

function marketPackageDescription(pkg: SkillMarketPackage): string {
  const key = MARKET_PACKAGE_DESCRIPTION_KEYS[pkg.source]
  return key ? t(key) : pkg.description || pkg.source
}

function packageResourceCount(pkg: PiPackageInfo): number {
  return Object.values(pkg.resources).reduce((total, entries) => total + entries.length, 0)
}

function packageHealthLabel(health: PiPackageHealth): string {
  return t(
    `skills.packageHealth${health.replace(/(^|-)(\w)/g, (_, _dash, letter) => letter.toUpperCase())}`
  )
}

function packageHealthTone(
  health: PiPackageHealth
): 'muted' | 'success' | 'warning' | 'error' | 'accent' {
  if (health === 'healthy') return 'success'
  if (health === 'unknown') return 'muted'
  if (health === 'orphaned') return 'accent'
  return health === 'missing' || health === 'permission-error' ? 'error' : 'warning'
}

const packageHealthOptions = computed(() => [
  { value: 'all', label: t('skills.packageFilterAllHealth') },
  ...(['healthy', 'missing', 'orphaned', 'permission-error', 'corrupted', 'unknown'] as const).map(
    (health) => ({ value: health, label: packageHealthLabel(health) })
  )
])

const packageScopeOptions = computed(() => [
  { value: 'all', label: t('skills.packageFilterAllScopes') },
  { value: 'global', label: t('skills.packageScopeGlobal') },
  { value: 'project', label: t('skills.packageScopeProject') }
])

const marketScopeOptions = computed(() => [
  { value: 'global', label: t('skills.packageScopeGlobal') },
  ...(workspace.currentCwd ? [{ value: 'project', label: t('skills.packageScopeProject') }] : [])
])

function resourceGroups(pkg: PiPackageInfo) {
  return [
    { key: 'skills', label: t('skills.resourceSkills'), values: pkg.resources.skills },
    { key: 'prompts', label: t('skills.resourcePrompts'), values: pkg.resources.prompts },
    { key: 'extensions', label: t('skills.resourceExtensions'), values: pkg.resources.extensions },
    { key: 'themes', label: t('skills.resourceThemes'), values: pkg.resources.themes },
    { key: 'tools', label: t('skills.resourceTools'), values: pkg.resources.tools }
  ].filter((group) => group.values.length > 0)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header
      class="flex h-[var(--height-page-header)] shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5"
    >
      <div class="min-w-0">
        <h1 class="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          {{ $t('nav.skills') }}
        </h1>
        <p class="-mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">
          {{ $t('skills.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" :loading="store.loading" @click="refreshAll">
          <RefreshCw class="size-3.5" :stroke-width="1.75" />
        </Button>
        <template v-if="mode === 'skills'">
          <Button variant="secondary" size="sm" @click="openImport">
            <FileInput class="size-3.5" :stroke-width="1.75" />
            {{ $t('skills.import') }}
          </Button>
          <Button variant="primary" size="sm" @click="openCreate">
            <FilePlus2 class="size-3.5" :stroke-width="1.75" />
            {{ $t('skills.create') }}
          </Button>
        </template>
        <template v-else-if="mode === 'packages'">
          <Button
            v-if="selectedPackageIds.length"
            variant="danger"
            size="sm"
            :loading="packageActionBusy === 'bulk-remove'"
            @click="removeSelectedPackages"
          >
            <Trash2 class="size-3.5" />
            {{ $t('skills.removeSelected', { count: selectedPackageIds.length }) }}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            :loading="packageActionBusy === 'permissions'"
            @click="repairPackagePermissions"
          >
            <Wrench class="size-3.5" />
            {{ $t('skills.repairPermissions') }}
          </Button>
          <Button variant="danger" size="sm" :loading="cleanupBusy" @click="cleanupThirdParty">
            <Trash2 class="size-3.5" />
            {{ $t('skills.cleanupThirdParty') }}
          </Button>
        </template>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <div class="flex min-h-0 w-[320px] shrink-0 flex-col border-r border-[var(--border-subtle)]">
        <div class="border-b border-[var(--border-subtle)] p-2.5">
          <div class="mb-2 grid grid-cols-3 gap-1 rounded-[var(--radius-sm)] p-0.5">
            <button
              v-for="item in [
                { id: 'skills', label: $t('skills.tabSkills'), icon: Sparkles },
                { id: 'packages', label: $t('skills.tabPackages'), icon: PackageIcon },
                { id: 'market', label: $t('skills.tabMarket'), icon: StoreIcon }
              ] as const"
              :key="item.id"
              type="button"
              class="flex h-7 items-center justify-center gap-1 rounded-[4px] text-[11px] font-medium transition-colors"
              :class="
                mode === item.id
                  ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
              "
              @click="mode = item.id"
            >
              <component :is="item.icon" class="size-3" :stroke-width="1.8" />
              {{ item.label }}
            </button>
          </div>
          <SearchField v-model="query" :placeholder="$t('skills.filterPlaceholder')" size="sm" />
          <div v-if="mode === 'packages'" class="mt-2 grid grid-cols-2 gap-1.5">
            <Select v-model="packageHealthFilter" :options="packageHealthOptions" />
            <Select v-model="packageScopeFilter" :options="packageScopeOptions" />
          </div>
          <div v-else-if="mode === 'market'" class="mt-2">
            <Select v-model="marketInstallScope" :options="marketScopeOptions" />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <template v-if="mode === 'skills'">
            <section
              v-if="store.featuredSkills.length"
              class="border-b border-[var(--border-subtle)] py-1.5"
            >
              <div
                class="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]"
              >
                <ShieldCheck class="size-3" :stroke-width="1.8" />
                {{ $t('skills.featured') }}
              </div>
              <button
                v-for="capability in store.featuredSkills"
                :key="capability.id"
                type="button"
                :data-testid="`featured-capability-${capability.id}`"
                class="relative flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors"
                :class="
                  selectedCapabilityId === capability.id
                    ? 'bg-[var(--accent-tint)]'
                    : 'hover:bg-[var(--bg-hover)]'
                "
                @click="selectCapability(capability)"
              >
                <span
                  v-if="selectedCapabilityId === capability.id"
                  class="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
                />
                <span class="min-w-0">
                  <span class="block truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                    {{ capability.name }}
                  </span>
                  <span class="block truncate text-[10.5px] text-[var(--text-tertiary)]">
                    {{ capability.description }}
                  </span>
                </span>
                <Badge :tone="capabilityStatusTone(capability)">
                  {{ capabilityStatusLabel(capability) }}
                </Badge>
              </button>
            </section>
            <div
              class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]"
            >
              {{ $t('skills.installedSection') }}
            </div>
            <div v-if="!store.loading && filteredSkills.length === 0" class="px-3 py-6">
              <EmptyState
                :title="store.skills.length ? $t('skills.filterEmpty') : $t('skills.empty')"
                :description="
                  store.skills.length ? $t('skills.filterEmptyHint') : $t('skills.emptyHint')
                "
                :icon="store.skills.length ? Search : Sparkles"
              />
            </div>
            <ul v-else class="py-1">
              <li
                v-for="skill in filteredSkills"
                :key="skill.path"
                class="group relative cursor-pointer px-3 transition-colors"
                :class="
                  store.selectedPath === skill.path
                    ? 'bg-[var(--accent-tint)]'
                    : 'hover:bg-[var(--bg-hover)]'
                "
                @click="selectSkill(skill)"
              >
                <span
                  v-if="store.selectedPath === skill.path"
                  class="pointer-events-none absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
                />
                <div class="flex min-h-[var(--height-row)] flex-col justify-center gap-0.5 py-1.5">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-[13px] font-medium text-[var(--text-primary)]">
                      {{ skill.name }}
                    </span>
                    <Badge v-if="skill.origin === 'builtin'" tone="success">
                      {{ $t('skills.marketBuiltin') }}
                    </Badge>
                    <Badge v-else-if="skill.readOnly" tone="muted">
                      {{ $t('skills.fromPackage') }}
                    </Badge>
                    <Badge v-else-if="!skill.isValid" tone="warning">!</Badge>
                  </div>
                  <p
                    v-if="skill.description || skill.packageSource"
                    class="truncate text-[10.5px] text-[var(--text-tertiary)]"
                  >
                    {{ skill.description || skill.packageSource }}
                  </p>
                </div>
              </li>
            </ul>
          </template>

          <template v-else-if="mode === 'packages'">
            <div v-if="!store.loading && filteredPackages.length === 0" class="px-3 py-6">
              <EmptyState
                :title="$t('skills.packagesEmpty')"
                :description="$t('skills.packagesEmptyHint')"
                :icon="PackageIcon"
              />
            </div>
            <ul v-else class="py-1">
              <li
                v-for="pkg in filteredPackages"
                :key="pkg.id"
                class="relative cursor-pointer px-3 transition-colors"
                :class="
                  selectedPackageId === pkg.id
                    ? 'bg-[var(--accent-tint)]'
                    : 'hover:bg-[var(--bg-hover)]'
                "
                @click="selectedPackageId = pkg.id"
              >
                <span
                  v-if="selectedPackageId === pkg.id"
                  class="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
                />
                <div class="flex min-h-[52px] flex-col justify-center gap-1 py-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        class="size-3 accent-[var(--accent)]"
                        :checked="selectedPackageIds.includes(pkg.id)"
                        :aria-label="$t('skills.selectPackage')"
                        @click.stop="togglePackageSelection(pkg)"
                      />
                      <span class="truncate text-[13px] font-medium text-[var(--text-primary)]">
                        {{ pkg.name }}
                      </span>
                    </div>
                    <Badge :tone="packageHealthTone(pkg.health)">
                      {{ packageHealthLabel(pkg.health) }}
                    </Badge>
                  </div>
                  <div
                    class="ml-5 flex items-center gap-1.5 text-[10.5px] text-[var(--text-tertiary)]"
                  >
                    <span>{{
                      pkg.scope === 'global'
                        ? $t('skills.packageScopeGlobal')
                        : $t('skills.packageScopeProject')
                    }}</span>
                    <span>·</span>
                    <span>{{ pkg.sourceType }}</span>
                    <span>·</span>
                    <span>{{
                      $t('skills.resourceCount', { count: packageResourceCount(pkg) })
                    }}</span>
                  </div>
                </div>
              </li>
            </ul>
          </template>

          <template v-else>
            <div v-if="!store.loading && filteredMarket.length === 0" class="px-3 py-6">
              <EmptyState
                :title="$t('skills.marketEmpty')"
                :description="$t('skills.marketEmptyHint')"
                :icon="StoreIcon"
              />
            </div>
            <ul v-else class="py-1">
              <li
                v-for="collection in filteredMarket"
                :key="collection.id"
                :data-testid="`market-collection-${collection.id}`"
                class="relative cursor-pointer px-3 transition-colors"
                :class="
                  selectedCollectionId === collection.id
                    ? 'bg-[var(--accent-tint)]'
                    : 'hover:bg-[var(--bg-hover)]'
                "
                @click="selectedCollectionId = collection.id"
              >
                <span
                  v-if="selectedCollectionId === collection.id"
                  class="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
                />
                <div class="flex min-h-[64px] flex-col justify-center gap-1 py-2">
                  <div class="flex items-center gap-1.5">
                    <Badge :tone="collectionKindTone(collection)">
                      {{ collectionKindLabel(collection) }}
                    </Badge>
                    <span class="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                      {{ marketCollectionTitle(collection) }}
                    </span>
                  </div>
                  <div
                    class="flex items-center justify-between text-[10.5px] text-[var(--text-tertiary)]"
                  >
                    <span>
                      {{ collectionItemCount(collection) }} {{ collectionUnit(collection) }}
                    </span>
                    <span>
                      {{ installedCount(collection) }}/{{ collectionItemCount(collection) }}
                      {{ $t('common.installed') }}
                    </span>
                  </div>
                </div>
              </li>
            </ul>
          </template>
        </div>
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <template v-if="mode === 'skills'">
          <template v-if="selectedCapability">
            <div
              class="flex min-h-[56px] shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-1.5"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                    {{ selectedCapability.name }}
                  </h2>
                  <Badge :tone="capabilityStatusTone(selectedCapability)">
                    {{ capabilityStatusLabel(selectedCapability) }}
                  </Badge>
                  <Badge tone="muted">Capability · Skill</Badge>
                </div>
                <p class="truncate text-[10.5px] text-[var(--text-tertiary)]">
                  {{ selectedCapability.description }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <Button
                  v-if="!selectedCapability.installed"
                  data-testid="featured-capability-install"
                  variant="primary"
                  size="sm"
                  :loading="store.installingIds.includes(selectedCapability.id)"
                  @click="installCapability(selectedCapability)"
                >
                  <Download class="size-3.5" />
                  {{ $t('skills.install') }}
                </Button>
                <template v-else>
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="store.installingIds.includes(selectedCapability.id)"
                    @click="viewInstalledCapability(selectedCapability)"
                  >
                    <Eye class="size-3.5" />
                    {{ $t('skills.capabilityView') }}
                  </Button>
                  <Button
                    v-if="selectedCapability.enabled"
                    variant="ghost"
                    size="sm"
                    :disabled="store.installingIds.includes(selectedCapability.id)"
                    @click="editInstalledCapability(selectedCapability)"
                  >
                    <FileEdit class="size-3.5" />
                    {{ $t('skills.edit') }}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    :loading="store.installingIds.includes(selectedCapability.id)"
                    @click="toggleCapability(selectedCapability)"
                  >
                    <PowerOff v-if="selectedCapability.enabled" class="size-3.5" />
                    <Power v-else class="size-3.5" />
                    {{
                      selectedCapability.enabled
                        ? $t('skills.capabilityDisable')
                        : $t('skills.capabilityEnable')
                    }}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    :loading="store.installingIds.includes(selectedCapability.id)"
                    @click="updateCapability(selectedCapability)"
                  >
                    <RotateCw class="size-3.5" />
                    {{ $t('skills.capabilityUpdate') }}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    :disabled="store.installingIds.includes(selectedCapability.id)"
                    @click="uninstallCapability(selectedCapability)"
                  >
                    <Trash2 class="size-3.5" />
                    {{ $t('skills.capabilityUninstall') }}
                  </Button>
                </template>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <InspectorSection>
                <template #title>{{ $t('skills.capabilityOverview') }}</template>
                <PropertyRow :label="$t('skills.colStatus')">
                  <Badge :tone="capabilityStatusTone(selectedCapability)">
                    {{ capabilityStatusLabel(selectedCapability) }}
                  </Badge>
                </PropertyRow>
                <PropertyRow :label="$t('skills.capabilityType')" mono>
                  {{ selectedCapability.type }}
                </PropertyRow>
                <PropertyRow :label="$t('skills.capabilitySource')" mono>
                  {{ selectedCapability.sourceUrl || selectedCapability.source }}
                </PropertyRow>
                <PropertyRow :label="$t('skills.capabilityVersion')" mono>
                  {{ selectedCapability.installedVersion || selectedCapability.version || '—' }}
                </PropertyRow>
                <PropertyRow :label="$t('skills.capabilityInstallPath')" mono>
                  {{ selectedCapability.installPath || '—' }}
                </PropertyRow>
                <PropertyRow
                  v-if="selectedCapability.lastModified"
                  :label="$t('skills.colModified')"
                  mono
                >
                  {{ formatRelativeTime(selectedCapability.lastModified) }}
                </PropertyRow>
              </InspectorSection>
              <div class="my-1 h-px bg-[var(--border-subtle)]" />
              <InspectorSection>
                <template #title>{{ $t('skills.capabilitySuitableFor') }}</template>
                <ul class="space-y-2 px-3 py-3 text-[12px] text-[var(--text-secondary)]">
                  <li
                    v-for="useCase in selectedCapability.useCases"
                    :key="useCase"
                    class="flex items-center gap-2"
                  >
                    <span class="size-1 rounded-full bg-[var(--accent)]" />
                    {{ capabilityUseCaseLabel(useCase) }}
                  </li>
                </ul>
                <div class="flex flex-wrap gap-1.5 px-3 pb-3">
                  <Badge v-for="tag in selectedCapability.tags" :key="tag" tone="muted">
                    {{ tag }}
                  </Badge>
                </div>
              </InspectorSection>
              <div class="my-1 h-px bg-[var(--border-subtle)]" />
              <InspectorSection>
                <template #title>{{ $t('skills.capabilityRuntimeBoundary') }}</template>
                <p class="px-3 py-3 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                  {{ $t('skills.capabilityRuntimeHint') }}
                </p>
              </InspectorSection>
              <div
                v-if="
                  store.capabilityErrors[selectedCapability.id] || selectedCapability.lastErrorCode
                "
                class="mx-3 my-3 rounded-[var(--radius-sm)] border border-[var(--error)]/30 bg-[var(--error-tint)] px-3 py-2"
              >
                <p class="text-[11.5px] font-medium text-[var(--error)]">
                  {{ capabilityErrorMessage(selectedCapability) }}
                </p>
                <p
                  class="mt-1 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
                >
                  {{ capabilityErrorCode(selectedCapability) }}
                  <template
                    v-if="store.capabilityProgress[selectedCapability.id]?.exitCode != null"
                  >
                    · exit {{ store.capabilityProgress[selectedCapability.id]?.exitCode }}
                  </template>
                </p>
                <pre
                  v-if="store.capabilityProgress[selectedCapability.id]?.stderr"
                  class="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
                  v-text="store.capabilityProgress[selectedCapability.id]?.stderr"
                />
              </div>
            </div>
          </template>
          <div v-else-if="!selectedSkill" class="flex flex-1 items-center justify-center">
            <EmptyState
              :title="$t('skills.select')"
              :description="$t('skills.selectHint')"
              :icon="Sparkles"
            />
          </div>
          <template v-else>
            <div
              class="flex h-[48px] shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                    {{ selectedSkill.name }}
                  </h2>
                  <Badge v-if="selectedSkill.origin === 'builtin'" tone="success">
                    {{ $t('skills.marketBuiltin') }}
                  </Badge>
                  <Badge v-else-if="selectedSkill.readOnly" tone="muted">
                    {{ $t('skills.readOnlyPackage') }}
                  </Badge>
                </div>
                <p
                  class="truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
                >
                  {{ selectedSkill.path }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <Button
                  v-if="selectedSkill.packageId"
                  variant="secondary"
                  size="sm"
                  @click="viewOwningPackage(selectedSkill)"
                >
                  <PackageIcon class="size-3.5" />
                  {{ $t('skills.viewOwningPackage') }}
                </Button>
                <IconButton
                  v-if="!selectedSkill.readOnly"
                  :label="$t('skills.edit')"
                  @click="openEdit(selectedSkill)"
                >
                  <FileEdit class="size-3.5" :stroke-width="1.75" />
                </IconButton>
                <IconButton :label="$t('skills.openFolder')" @click="openPath(selectedSkill.path)">
                  <FolderOpen class="size-3.5" :stroke-width="1.75" />
                </IconButton>
                <IconButton :label="$t('skills.reveal')" @click="reveal(selectedSkill.path)">
                  <Eye class="size-3.5" :stroke-width="1.75" />
                </IconButton>
                <IconButton
                  v-if="!selectedSkill.readOnly"
                  variant="danger"
                  :label="$t('skills.uninstallSkill')"
                  @click="askDelete(selectedSkill)"
                >
                  <Trash2 class="size-3.5" :stroke-width="1.75" />
                </IconButton>
                <IconButton
                  v-else-if="selectedSkillPackage"
                  variant="danger"
                  :label="$t('skills.uninstallOwningPackage')"
                  @click="askRemovePackage(selectedSkillPackage)"
                >
                  <Trash2 class="size-3.5" :stroke-width="1.75" />
                </IconButton>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <InspectorSection>
                <template #title>Skill</template>
                <PropertyRow
                  v-if="selectedSkill.description"
                  :label="$t('skills.fieldDescription')"
                >
                  {{ selectedSkill.description }}
                </PropertyRow>
                <PropertyRow :label="$t('skills.colStatus')" mono>
                  <Badge :tone="selectedSkill.isValid ? 'success' : 'warning'">
                    {{ selectedSkill.isValid ? $t('skills.statusOk') : $t('skills.statusIssues') }}
                  </Badge>
                </PropertyRow>
                <PropertyRow
                  v-if="selectedSkill.packageSource"
                  :label="$t('skills.packageSource')"
                  mono
                >
                  {{ selectedSkill.packageSource }}
                </PropertyRow>
                <PropertyRow
                  v-if="selectedSkill.builtinCollectionName"
                  :label="$t('skills.builtinCollection')"
                >
                  {{ selectedSkill.builtinCollectionName }}
                </PropertyRow>
                <PropertyRow
                  v-if="selectedSkill.builtinRepository"
                  :label="$t('skills.builtinRepository')"
                  mono
                >
                  {{ selectedSkill.builtinRepository }}
                </PropertyRow>
                <PropertyRow
                  v-if="selectedSkill.builtinCategory"
                  :label="$t('skills.builtinCategory')"
                >
                  {{ selectedSkill.builtinCategory }}
                </PropertyRow>
                <PropertyRow
                  v-if="selectedSkill.bundledCommit"
                  :label="$t('skills.builtinVersion')"
                  mono
                >
                  {{ selectedSkill.bundledCommit.slice(0, 12) }}
                </PropertyRow>
                <PropertyRow v-if="selectedSkill.packageName" :label="$t('skills.packageOwner')">
                  {{ selectedSkill.packageName }}
                  <template v-if="selectedSkill.packageVersion">
                    v{{ selectedSkill.packageVersion }}
                  </template>
                </PropertyRow>
                <PropertyRow v-if="selectedSkill.packageScope" :label="$t('skills.packageScope')">
                  {{
                    selectedSkill.packageScope === 'global'
                      ? $t('skills.packageScopeGlobal')
                      : $t('skills.packageScopeProject')
                  }}
                </PropertyRow>
                <PropertyRow :label="$t('skills.colSource')" mono>
                  <span>{{ selectedSkill.source }}</span>
                </PropertyRow>
                <PropertyRow :label="$t('skills.colModified')" mono>
                  {{ formatRelativeTime(selectedSkill.lastModified) }}
                </PropertyRow>
              </InspectorSection>
              <div class="my-1 h-px bg-[var(--border-subtle)]" />
              <InspectorSection>
                <template #title>{{ $t('skills.preview') }}</template>
                <pre
                  class="whitespace-pre-wrap break-words px-3 py-3 font-[family-name:var(--font-mono)] text-[12px] leading-[1.6] text-[var(--text-secondary)]"
                  v-text="store.detailLoading ? $t('common.loading') : store.detailContent"
                />
              </InspectorSection>
            </div>
          </template>
        </template>

        <template v-else-if="mode === 'packages'">
          <div v-if="!selectedPackage" class="flex flex-1 items-center justify-center">
            <EmptyState
              :title="$t('skills.selectPackage')"
              :description="$t('skills.selectPackageHint')"
              :icon="PackageIcon"
            />
          </div>
          <template v-else>
            <div
              class="flex h-[48px] shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                    {{ selectedPackage.name }}
                  </h2>
                  <Badge :tone="packageHealthTone(selectedPackage.health)">
                    {{ packageHealthLabel(selectedPackage.health) }}
                  </Badge>
                  <Badge tone="muted">
                    {{
                      selectedPackage.scope === 'global'
                        ? $t('skills.packageScopeGlobal')
                        : $t('skills.packageScopeProject')
                    }}
                  </Badge>
                  <Badge v-if="selectedPackage.version" tone="muted">
                    v{{ selectedPackage.version }}
                  </Badge>
                </div>
                <p
                  class="truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
                >
                  {{ selectedPackage.source }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <IconButton
                  :disabled="!selectedPackage.available"
                  :label="$t('skills.openFolder')"
                  @click="openPath(selectedPackage.path)"
                >
                  <FolderOpen class="size-3.5" :stroke-width="1.75" />
                </IconButton>
                <Button
                  v-if="selectedPackage.health === 'orphaned'"
                  variant="secondary"
                  size="sm"
                  :loading="packageActionBusy === selectedPackage.id"
                  @click="registerPackage(selectedPackage)"
                >
                  <Link2 class="size-3.5" />
                  {{ $t('skills.registerPackage') }}
                </Button>
                <Button
                  v-if="selectedPackage.health === 'orphaned'"
                  variant="danger"
                  size="sm"
                  :disabled="!selectedPackage.managed"
                  :loading="packageActionBusy === selectedPackage.id"
                  @click="deleteOrphanPackage(selectedPackage)"
                >
                  <Trash2 class="size-3.5" />
                  {{ $t('skills.deleteOrphan') }}
                </Button>
                <Button
                  v-else
                  variant="secondary"
                  size="sm"
                  :loading="packageActionBusy === selectedPackage.id"
                  @click="repairPackage(selectedPackage)"
                >
                  <RotateCw class="size-3.5" />
                  {{
                    selectedPackage.health === 'healthy'
                      ? $t('skills.reinstallPackage')
                      : $t('skills.repairPackage')
                  }}
                </Button>
                <Button
                  v-if="selectedPackage.registered"
                  variant="danger"
                  size="sm"
                  :disabled="packageActionBusy === selectedPackage.id"
                  @click="askRemovePackage(selectedPackage)"
                >
                  <Trash2 class="size-3.5" />
                  {{ $t('skills.removePackage') }}
                </Button>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <InspectorSection>
                <template #title>{{ $t('skills.packageInfo') }}</template>
                <PropertyRow
                  v-if="selectedPackage.description"
                  :label="$t('skills.fieldDescription')"
                >
                  {{ selectedPackage.description }}
                </PropertyRow>
                <PropertyRow :label="$t('skills.packageSource')" mono>
                  <span>{{ selectedPackage.source }}</span>
                </PropertyRow>
                <PropertyRow :label="$t('skills.packageSourceType')" mono>
                  {{ selectedPackage.sourceType }}
                </PropertyRow>
                <PropertyRow :label="$t('skills.packageScope')">
                  {{
                    selectedPackage.scope === 'global'
                      ? $t('skills.packageScopeGlobal')
                      : $t('skills.packageScopeProject')
                  }}
                </PropertyRow>
                <PropertyRow :label="$t('skills.packageRegistryState')">
                  <Badge :tone="selectedPackage.registered ? 'success' : 'warning'">
                    {{
                      selectedPackage.registered
                        ? $t('skills.registered')
                        : $t('skills.notRegistered')
                    }}
                  </Badge>
                </PropertyRow>
                <PropertyRow :label="$t('skills.packageRegistryPath')" mono>
                  {{ selectedPackage.registryPath }}
                </PropertyRow>
                <PropertyRow :label="$t('skills.packagePath')" mono>
                  {{ selectedPackage.path || '—' }}
                </PropertyRow>
              </InspectorSection>
              <template v-if="selectedPackage.problems.length">
                <div class="my-1 h-px bg-[var(--border-subtle)]" />
                <InspectorSection>
                  <template #title>{{ $t('skills.packageProblems') }}</template>
                  <div class="space-y-2 px-3 py-3">
                    <div
                      v-for="problem in selectedPackage.problems"
                      :key="`${problem.code}:${problem.path}`"
                      class="rounded-[var(--radius-sm)] border border-[var(--warning)]/30 bg-[var(--warning-tint)] px-2.5 py-2"
                    >
                      <div class="text-[11.5px] font-medium text-[var(--warning)]">
                        {{ problem.code }}
                      </div>
                      <p class="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                        {{ problem.message }}
                      </p>
                      <p
                        v-if="problem.path"
                        class="mt-1 break-all font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]"
                      >
                        {{ problem.path }}
                      </p>
                    </div>
                  </div>
                </InspectorSection>
              </template>
              <div class="my-1 h-px bg-[var(--border-subtle)]" />
              <InspectorSection>
                <template #title>{{ $t('skills.packageResources') }}</template>
                <div v-if="resourceGroups(selectedPackage).length" class="space-y-4 px-3 py-3">
                  <div v-for="group in resourceGroups(selectedPackage)" :key="group.key">
                    <div
                      class="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      <Puzzle class="size-3" :stroke-width="1.8" />
                      {{ group.label }}
                      <span class="text-[var(--text-tertiary)]">({{ group.values.length }})</span>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                      <Badge v-for="value in group.values" :key="value" tone="muted">
                        <span>{{ value }}</span>
                      </Badge>
                    </div>
                  </div>
                </div>
                <p v-else class="px-3 py-4 text-[12px] text-[var(--text-tertiary)]">
                  {{ $t('skills.noDeclaredResources') }}
                </p>
              </InspectorSection>
              <template v-if="selectedPackageResult">
                <div class="my-1 h-px bg-[var(--border-subtle)]" />
                <InspectorSection>
                  <template #title>{{ $t('skills.packageOperationLog') }}</template>
                  <div class="space-y-1.5 px-3 py-3">
                    <div
                      v-for="(entry, index) in selectedPackageResult.logs"
                      :key="`${entry.phase}:${index}`"
                      class="grid grid-cols-[88px_18px_minmax(0,1fr)] items-start gap-2 text-[11px]"
                    >
                      <span class="font-[family-name:var(--font-mono)] text-[var(--text-tertiary)]">
                        {{ entry.phase }}
                      </span>
                      <span :class="entry.ok ? 'text-[var(--success)]' : 'text-[var(--error)]'">{{
                        entry.ok ? '✓' : '×'
                      }}</span>
                      <span class="text-[var(--text-secondary)]">{{ entry.message }}</span>
                    </div>
                  </div>
                </InspectorSection>
              </template>
            </div>
          </template>
        </template>

        <template v-else>
          <div v-if="!selectedCollection" class="flex flex-1 items-center justify-center">
            <EmptyState
              :title="$t('skills.selectCollection')"
              :description="$t('skills.selectCollectionHint')"
              :icon="StoreIcon"
            />
          </div>
          <template v-else>
            <div
              class="flex min-h-[54px] shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-1.5"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                    {{ marketCollectionTitle(selectedCollection) }}
                  </h2>
                  <Badge :tone="collectionKindTone(selectedCollection)">
                    {{ collectionKindLabel(selectedCollection) }}
                  </Badge>
                </div>
                <p class="truncate text-[10.5px] text-[var(--text-tertiary)]">
                  {{ marketCollectionSummary(selectedCollection) }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <template v-if="isBuiltinCollection(selectedCollection)">
                  <Button
                    v-if="selectedCollection.skills.some(builtinSkillOwned)"
                    variant="danger"
                    size="sm"
                    :loading="removeKey === selectedCollection.id"
                    :disabled="isRemoveDisabled(selectedCollection.id)"
                    @click="
                      uninstallBuiltinCollectionSkills(
                        selectedCollection,
                        selectedCollection.skills
                      )
                    "
                  >
                    <Trash2 class="size-3.5" />
                    {{ $t('skills.builtinRemoveAll') }}
                  </Button>
                  <Button
                    v-if="hasMissingPackages(selectedCollection)"
                    variant="primary"
                    size="sm"
                    :loading="installKey === selectedCollection.id"
                    :disabled="isInstallDisabled(selectedCollection.id)"
                    @click="
                      installBuiltinCollectionSkills(selectedCollection, selectedCollection.skills)
                    "
                  >
                    <Download class="size-3.5" />
                    {{ $t('skills.builtinInstallAll') }}
                  </Button>
                </template>
                <template v-else-if="isPackageCollection(selectedCollection)">
                  <Button
                    v-if="
                      selectedCollection.kind === 'bundle' && installedCount(selectedCollection) > 0
                    "
                    variant="danger"
                    size="sm"
                    :loading="removeKey === selectedCollection.id"
                    :disabled="isRemoveDisabled(selectedCollection.id)"
                    @click="
                      removeMarketPackages(selectedCollection.id, selectedCollection.packages)
                    "
                  >
                    <Trash2 class="size-3.5" />
                    {{ $t('skills.removeInstalled') }}
                  </Button>
                  <Button
                    v-if="
                      selectedCollection.kind === 'bundle' && hasMissingPackages(selectedCollection)
                    "
                    variant="primary"
                    size="sm"
                    :loading="installKey === selectedCollection.id"
                    :disabled="isInstallDisabled(selectedCollection.id)"
                    @click="installPackages(selectedCollection.id, selectedCollection.packages)"
                  >
                    <Download class="size-3.5" />
                    {{ $t('skills.installMissing') }}
                  </Button>
                </template>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <template v-if="isBuiltinCollection(selectedCollection)">
                <InspectorSection>
                  <template #title>{{ $t('skills.builtinCollection') }}</template>
                  <PropertyRow :label="$t('skills.builtinAuthor')">
                    {{ selectedCollection.author }}
                  </PropertyRow>
                  <PropertyRow :label="$t('skills.colSource')">
                    {{ $t('skills.builtinSource') }}
                  </PropertyRow>
                  <PropertyRow :label="$t('skills.builtinRepository')" mono>
                    {{ selectedCollection.repository }}
                  </PropertyRow>
                  <PropertyRow :label="$t('skills.builtinLicense')" mono>
                    {{ selectedCollection.license }}
                  </PropertyRow>
                  <PropertyRow :label="$t('skills.builtinVersion')" mono>
                    {{ selectedCollection.commit.slice(0, 12) }}
                  </PropertyRow>
                  <PropertyRow :label="$t('skills.packageScope')">
                    {{
                      marketInstallScope === 'global'
                        ? $t('skills.packageScopeGlobal')
                        : $t('skills.packageScopeProject')
                    }}
                  </PropertyRow>
                </InspectorSection>
                <div class="my-1 h-px bg-[var(--border-subtle)]" />
                <InspectorSection>
                  <template #title>
                    {{ $t('skills.marketSkills') }}
                    <span class="ml-1 font-normal text-[var(--text-tertiary)]">
                      {{ installedCount(selectedCollection) }}/{{
                        selectedCollection.skills.length
                      }}
                    </span>
                  </template>
                  <div class="divide-y divide-[var(--border-subtle)]">
                    <div
                      v-for="skill in visibleBuiltinSkills(selectedCollection)"
                      :key="skill.id"
                      :data-testid="`builtin-skill-${skill.id}`"
                      class="flex min-h-[68px] items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5">
                          <span
                            class="truncate text-[12.5px] font-medium text-[var(--text-primary)]"
                          >
                            {{ skill.name }}
                          </span>
                          <Badge tone="muted">{{ skill.category }}</Badge>
                          <Badge :tone="builtinHealthTone(builtinSkillHealth(skill))">
                            {{ builtinHealthLabel(builtinSkillHealth(skill)) }}
                          </Badge>
                        </div>
                        <p
                          class="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-[var(--text-tertiary)]"
                        >
                          {{ skill.description }}
                        </p>
                        <p
                          class="mt-1 truncate font-[family-name:var(--font-mono)] text-[9.5px] text-[var(--text-disabled)]"
                        >
                          {{ skill.sourcePath }} · {{ skill.resources.length }}
                          {{ $t('skills.resourcesUnit') }}
                        </p>
                      </div>
                      <div class="flex shrink-0 items-center gap-1.5">
                        <Button
                          v-if="!builtinSkillOwned(skill)"
                          variant="secondary"
                          size="sm"
                          :loading="installKey === skill.id"
                          :disabled="isInstallDisabled(skill.id)"
                          @click="installBuiltinCollectionSkills(selectedCollection, [skill])"
                        >
                          <Download class="size-3.5" />
                          {{
                            builtinSkillHealth(skill) === 'conflict'
                              ? $t('skills.builtinResolveConflict')
                              : $t('skills.install')
                          }}
                        </Button>
                        <Button
                          v-if="builtinSkillOwned(skill) && builtinSkillHealth(skill) !== 'healthy'"
                          variant="secondary"
                          size="sm"
                          :loading="installKey === skill.id"
                          :disabled="isInstallDisabled(skill.id)"
                          @click="updateBuiltinCollectionSkill(selectedCollection, skill)"
                        >
                          <RotateCw class="size-3.5" />
                          {{
                            builtinSkillHealth(skill) === 'update-available'
                              ? $t('skills.capabilityUpdate')
                              : $t('skills.reinstallPackage')
                          }}
                        </Button>
                        <Button
                          v-if="builtinSkillOwned(skill)"
                          variant="danger"
                          size="sm"
                          :loading="removeKey === skill.id"
                          :disabled="isRemoveDisabled(skill.id)"
                          @click="uninstallBuiltinCollectionSkills(selectedCollection, [skill])"
                        >
                          <Trash2 class="size-3.5" />
                          {{ $t('skills.uninstallSkill') }}
                        </Button>
                      </div>
                    </div>
                  </div>
                </InspectorSection>
              </template>
              <InspectorSection v-else-if="isPackageCollection(selectedCollection)">
                <template #title>
                  {{ $t('skills.marketPackages') }}
                  <span class="ml-1 font-normal text-[var(--text-tertiary)]">
                    {{ installedCount(selectedCollection) }}/{{
                      selectedCollection.packages.length
                    }}
                  </span>
                </template>
                <div class="divide-y divide-[var(--border-subtle)]">
                  <div
                    v-for="pkg in selectedCollection.packages"
                    :key="pkg.source"
                    class="flex min-h-[52px] items-center justify-between gap-3 px-3 py-2"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                          {{ pkg.name }}
                        </span>
                        <Badge v-if="marketPackageInstalled(pkg)" tone="success">
                          {{
                            marketPackageVersion(pkg)
                              ? `v${marketPackageVersion(pkg)}`
                              : $t('common.installed')
                          }}
                        </Badge>
                      </div>
                      <p
                        class="truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
                      >
                        {{ marketPackageDescription(pkg) }}
                      </p>
                    </div>
                    <Button
                      v-if="!marketPackageInstalled(pkg)"
                      variant="secondary"
                      size="sm"
                      :loading="installKey === pkg.source"
                      :disabled="isInstallDisabled(pkg.source)"
                      @click="installPackages(pkg.source, [pkg])"
                    >
                      <Download class="size-3.5" />
                      {{ $t('skills.install') }}
                    </Button>
                    <Button
                      v-else
                      variant="danger"
                      size="sm"
                      :loading="removeKey === pkg.source"
                      :disabled="isRemoveDisabled(pkg.source)"
                      @click="removeMarketPackages(pkg.source, [pkg])"
                    >
                      <Trash2 class="size-3.5" />
                      {{ $t('skills.removePackage') }}
                    </Button>
                  </div>
                </div>
              </InspectorSection>
            </div>
          </template>
        </template>
      </div>
    </div>

    <Dialog
      v-model:open="deleteOpen"
      :title="$t('skills.deleteConfirm')"
      :description="$t('skills.deleteHint')"
    >
      <p
        class="mb-4 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]"
      >
        {{ deleting?.path }}
      </p>
      <template #footer>
        <Button variant="ghost" size="sm" @click="deleteOpen = false">
          <span>{{ $t('common.cancel') }}</span>
        </Button>
        <Button variant="danger" size="sm" @click="confirmDelete">
          {{ $t('skills.uninstallSkill') }}
        </Button>
      </template>
    </Dialog>

    <Dialog
      v-model:open="packageRemoveOpen"
      :title="$t('skills.removePackageTitle')"
      :description="$t('skills.removePackageHint')"
    >
      <p
        class="mb-4 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]"
      >
        {{ removingPackage?.source }}
      </p>
      <template #footer>
        <Button variant="ghost" size="sm" @click="packageRemoveOpen = false">
          {{ $t('common.cancel') }}
        </Button>
        <Button
          variant="danger"
          size="sm"
          :loading="packageRemoveBusy"
          @click="confirmRemovePackage"
        >
          {{ $t('skills.removePackage') }}
        </Button>
      </template>
    </Dialog>

    <Dialog
      v-model:open="editorOpen"
      wide
      :title="editing ? $t('skills.editTitle', { name: editing.name }) : $t('skills.createTitle')"
      :description="$t('skills.editorHint')"
    >
      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-2 gap-3">
          <Input
            v-model="form.name"
            :label="$t('skills.fieldName')"
            placeholder="my-skill"
            :disabled="!!editing"
          />
          <Select
            v-model="form.targetRoot"
            :label="$t('skills.fieldTargetRoot')"
            :options="knownRoots.map((root) => ({ value: root, label: root }))"
            :disabled="!!editing"
          />
        </div>
        <Input
          v-model="form.description"
          :label="$t('skills.fieldDescription')"
          :placeholder="$t('skills.fieldDescriptionPlaceholder')"
        />
        <div class="flex flex-col gap-1">
          <span class="text-[11.5px] font-medium text-[var(--text-secondary)]">SKILL.md</span>
          <div
            ref="editorHost"
            class="h-[42vh] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)]"
          />
        </div>
      </div>
      <template #footer>
        <Button variant="ghost" @click="editorOpen = false">{{ $t('common.cancel') }}</Button>
        <Button variant="primary" :loading="saveBusy" @click="saveSkill">
          <span>{{ $t('common.save') }}</span>
        </Button>
      </template>
    </Dialog>

    <Dialog
      v-model:open="importOpen"
      :title="$t('skills.importTitle')"
      :description="$t('skills.importHint')"
    >
      <div class="flex flex-col gap-3">
        <Input
          v-model="importForm.source"
          :label="$t('skills.importSource')"
          :placeholder="$t('skills.importSourcePlaceholder')"
        />
        <Input
          v-model="importForm.name"
          :label="$t('skills.fieldName')"
          :placeholder="$t('skills.importNamePlaceholder')"
        />
        <Select
          v-model="importForm.targetRoot"
          :label="$t('skills.fieldTargetRoot')"
          :options="knownRoots.map((root) => ({ value: root, label: root }))"
        />
      </div>
      <template #footer>
        <Button variant="ghost" @click="importOpen = false">{{ $t('common.cancel') }}</Button>
        <Button variant="primary" :loading="importBusy" @click="startImport">
          <FileInput class="size-3.5" :stroke-width="1.75" />
          {{ $t('skills.import') }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
