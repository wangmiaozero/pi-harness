<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  BookOpen,
  CheckCircle2,
  Download,
  Eye,
  FileEdit,
  FileInput,
  FilePlus2,
  FolderOpen,
  Package as PackageIcon,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles,
  Store as StoreIcon,
  Trash2
} from '@lucide/vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { toast } from 'vue-sonner'
import type {
  PiPackageInfo,
  SkillInfo,
  SkillMarketCollection,
  SkillMarketPackage
} from '@shared/ipc/api-types'
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
import { useSkillsStore } from '@renderer/stores/skills'
import { usePiStore } from '@renderer/stores/pi'
import { getApi, getErrorPayload } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { formatRelativeTime } from '@renderer/utils/format'

type ViewMode = 'skills' | 'packages' | 'market'

const { t } = useI18n()
const store = useSkillsStore()
const pi = usePiStore()

const mode = ref<ViewMode>('skills')
const query = ref('')
const selectedPackageSource = ref<string | null>(null)
const selectedCollectionId = ref<string | null>(null)
const installKey = ref<string | null>(null)

const deleteOpen = ref(false)
const editorOpen = ref(false)
const importOpen = ref(false)
const packageRemoveOpen = ref(false)
const importBusy = ref(false)
const saveBusy = ref(false)
const packageRemoveBusy = ref(false)
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
      (skill.packageSource ?? '').toLowerCase().includes(q)
    )
  })
})

const filteredPackages = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.packages
  return store.packages.filter(
    (pkg) =>
      pkg.name.toLowerCase().includes(q) ||
      pkg.source.toLowerCase().includes(q) ||
      pkg.description.toLowerCase().includes(q)
  )
})

const filteredMarket = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.market
  return store.market.filter(
    (collection) =>
      collection.title.toLowerCase().includes(q) ||
      collection.summary.toLowerCase().includes(q) ||
      collection.packages.some(
        (pkg) => pkg.name.toLowerCase().includes(q) || pkg.source.toLowerCase().includes(q)
      )
  )
})

const selectedSkill = computed(() =>
  store.skills.find((skill) => skill.path === store.selectedPath)
)
const selectedPackage = computed(() =>
  store.packages.find((pkg) => pkg.source === selectedPackageSource.value)
)
const selectedCollection = computed(() =>
  store.market.find((collection) => collection.id === selectedCollectionId.value)
)

watch(mode, () => {
  query.value = ''
})

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
  if (!store.selectedPath && store.skills[0]) void store.loadDetail(store.skills[0].path)
  if (!selectedPackageSource.value && store.packages[0]) {
    selectedPackageSource.value = store.packages[0].source
  }
  if (!selectedCollectionId.value && store.market[0]) {
    selectedCollectionId.value = store.market[0].id
  }
}

async function refreshAll() {
  await store.refresh()
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
  const sources = packages.filter((pkg) => !pkg.installed).map((pkg) => pkg.source)
  if (sources.length === 0) {
    toast.success(t('skills.marketAlreadyInstalled'))
    return
  }
  installKey.value = key
  try {
    const results = await store.installPackages(sources)
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

function askRemovePackage(pkg: PiPackageInfo) {
  removingPackage.value = pkg
  packageRemoveOpen.value = true
}

async function confirmRemovePackage() {
  if (!removingPackage.value) return
  packageRemoveBusy.value = true
  try {
    const result = await store.removePackage(removingPackage.value.source)
    if (!result.ok) throw new Error(result.stderr || result.message)
    toast.success(t('skills.packageRemoved', { name: removingPackage.value.name }))
    selectedPackageSource.value = store.packages[0]?.source ?? null
    packageRemoveOpen.value = false
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('skills.packageRemoveFailed'))
  } finally {
    packageRemoveBusy.value = false
  }
}

function installedCount(collection: SkillMarketCollection): number {
  return collection.packages.filter((pkg) => pkg.installed).length
}

function packageResourceCount(pkg: PiPackageInfo): number {
  return Object.values(pkg.resources).reduce((total, entries) => total + entries.length, 0)
}

function resourceGroups(pkg: PiPackageInfo) {
  return [
    { key: 'skills', label: t('skills.resourceSkills'), values: pkg.resources.skills },
    { key: 'prompts', label: t('skills.resourcePrompts'), values: pkg.resources.prompts },
    { key: 'extensions', label: t('skills.resourceExtensions'), values: pkg.resources.extensions },
    { key: 'themes', label: t('skills.resourceThemes'), values: pkg.resources.themes }
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
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <div class="flex min-h-0 w-[320px] shrink-0 flex-col border-r border-[var(--border-subtle)]">
        <div class="border-b border-[var(--border-subtle)] p-2.5">
          <div
            class="mb-2 grid grid-cols-3 rounded-[var(--radius-sm)] bg-[var(--bg-surface)] p-0.5"
          >
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
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              "
              @click="mode = item.id"
            >
              <component :is="item.icon" class="size-3" :stroke-width="1.8" />
              {{ item.label }}
            </button>
          </div>
          <SearchField v-model="query" :placeholder="$t('skills.filterPlaceholder')" size="sm" />
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <template v-if="mode === 'skills'">
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
                @click="store.loadDetail(skill.path)"
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
                    <Badge v-if="skill.readOnly" tone="muted">{{ $t('skills.fromPackage') }}</Badge>
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
                :key="pkg.source"
                class="relative cursor-pointer px-3 transition-colors"
                :class="
                  selectedPackageSource === pkg.source
                    ? 'bg-[var(--accent-tint)]'
                    : 'hover:bg-[var(--bg-hover)]'
                "
                @click="selectedPackageSource = pkg.source"
              >
                <span
                  v-if="selectedPackageSource === pkg.source"
                  class="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
                />
                <div class="flex min-h-[52px] flex-col justify-center gap-1 py-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <span class="truncate text-[13px] font-medium text-[var(--text-primary)]">
                      {{ pkg.name }}
                    </span>
                    <Badge :tone="pkg.available ? 'success' : 'warning'">
                      {{ pkg.version ? `v${pkg.version}` : $t('skills.packageMissing') }}
                    </Badge>
                  </div>
                  <p class="truncate text-[10.5px] text-[var(--text-tertiary)]">
                    {{ $t('skills.resourceCount', { count: packageResourceCount(pkg) }) }}
                  </p>
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
                    <Badge :tone="collection.kind === 'bundle' ? 'accent' : 'muted'">
                      {{
                        collection.kind === 'bundle'
                          ? $t('skills.marketBundle')
                          : $t('skills.marketGuide')
                      }}
                    </Badge>
                    <span class="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                      {{ collection.title }}
                    </span>
                  </div>
                  <div
                    class="flex items-center justify-between text-[10.5px] text-[var(--text-tertiary)]"
                  >
                    <span>{{ collection.packages.length }} {{ $t('skills.packagesUnit') }}</span>
                    <span>
                      {{ installedCount(collection) }}/{{ collection.packages.length }}
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
          <div v-if="!selectedSkill" class="flex flex-1 items-center justify-center">
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
                  <Badge v-if="selectedSkill.readOnly" tone="muted">
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
                  :label="$t('common.delete')"
                  @click="askDelete(selectedSkill)"
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
                  <Badge tone="success">{{ $t('common.installed') }}</Badge>
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
                <IconButton
                  variant="danger"
                  :label="$t('skills.removePackage')"
                  @click="askRemovePackage(selectedPackage)"
                >
                  <Trash2 class="size-3.5" :stroke-width="1.75" />
                </IconButton>
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
                <PropertyRow :label="$t('skills.packagePath')" mono>
                  {{ selectedPackage.path || '—' }}
                </PropertyRow>
              </InspectorSection>
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
                    {{ selectedCollection.title }}
                  </h2>
                  <Badge :tone="selectedCollection.kind === 'bundle' ? 'accent' : 'muted'">
                    {{
                      selectedCollection.kind === 'bundle'
                        ? $t('skills.marketBundle')
                        : $t('skills.marketGuide')
                    }}
                  </Badge>
                </div>
                <p class="truncate text-[10.5px] text-[var(--text-tertiary)]">
                  {{ selectedCollection.summary }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <IconButton
                  :label="$t('skills.revealRecipe')"
                  @click="reveal(selectedCollection.path)"
                >
                  <BookOpen class="size-3.5" :stroke-width="1.75" />
                </IconButton>
                <Button
                  v-if="selectedCollection.kind === 'bundle'"
                  variant="primary"
                  size="sm"
                  :loading="installKey === selectedCollection.id"
                  :disabled="
                    installedCount(selectedCollection) === selectedCollection.packages.length
                  "
                  @click="installPackages(selectedCollection.id, selectedCollection.packages)"
                >
                  <CheckCircle2
                    v-if="installedCount(selectedCollection) === selectedCollection.packages.length"
                    class="size-3.5"
                  />
                  <Download v-else class="size-3.5" />
                  {{
                    installedCount(selectedCollection) === selectedCollection.packages.length
                      ? $t('skills.allInstalled')
                      : $t('skills.installMissing')
                  }}
                </Button>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <InspectorSection>
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
                        <Badge v-if="pkg.installed" tone="success">
                          {{
                            pkg.installedVersion
                              ? `v${pkg.installedVersion}`
                              : $t('common.installed')
                          }}
                        </Badge>
                      </div>
                      <p
                        class="truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
                      >
                        {{ pkg.description || pkg.source }}
                      </p>
                    </div>
                    <Button
                      v-if="!pkg.installed"
                      variant="secondary"
                      size="sm"
                      :loading="installKey === pkg.source"
                      :disabled="installKey !== null"
                      @click="installPackages(pkg.source, [pkg])"
                    >
                      <Download class="size-3.5" />
                      {{ $t('skills.install') }}
                    </Button>
                    <CheckCircle2 v-else class="size-4 shrink-0 text-[var(--success)]" />
                  </div>
                </div>
              </InspectorSection>
              <div class="my-1 h-px bg-[var(--border-subtle)]" />
              <InspectorSection>
                <template #title>{{ $t('skills.recipeContent') }}</template>
                <pre
                  class="whitespace-pre-wrap break-words px-3 py-3 font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.55] text-[var(--text-secondary)]"
                  v-text="selectedCollection.content"
                />
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
        <Button variant="danger" size="sm" @click="confirmDelete">{{ $t('common.delete') }}</Button>
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
