<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  RefreshCw,
  FolderOpen,
  Eye,
  Trash2,
  FilePlus2,
  FileEdit,
  FileInput,
  Sparkles,
  Search
} from '@lucide/vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { toast } from 'vue-sonner'
import type { SkillInfo } from '@shared/ipc/api-types'
import type { SkillForm, SkillImportInput } from '@shared/schemas/domain'
import Button from '@renderer/components/ui/Button.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Input from '@renderer/components/ui/Input.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import SearchField from '@renderer/components/ui/SearchField.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { graphiteEditorTheme, graphiteSyntaxHighlighting } from '@renderer/styles/codemirror'
import { useSkillsStore } from '@renderer/stores/skills'
import { usePiStore } from '@renderer/stores/pi'
import { getApi } from '@renderer/composables/useApi'
import { getErrorPayload } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { formatRelativeTime } from '@renderer/utils/format'

const { t, locale } = useI18n()
const store = useSkillsStore()
const pi = usePiStore()

const deleteOpen = ref(false)
const editorOpen = ref(false)
const importOpen = ref(false)
const importBusy = ref(false)
const saveBusy = ref(false)
const deleting = ref<SkillInfo | null>(null)
const editing = ref<SkillInfo | null>(null)
const query = ref('')

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
  const fromSkills = store.skills.map((s) => s.source)
  return Array.from(new Set([...fromEnv, ...fromSkills].filter(Boolean)))
})

const filteredSkills = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.skills
  return store.skills.filter((s) => {
    return (
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q)
    )
  })
})

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

watch(editorOpen, async (open) => {
  if (open) {
    await nextTick()
    mountEditor(form.content)
  } else {
    destroyEditor()
  }
})

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
        EditorView.updateListener.of((u) => {
          if (u.docChanged) form.content = u.state.doc.toString()
        })
      ]
    })
  })
}

function destroyEditor() {
  editorView?.destroy()
  editorView = null
}

onMounted(async () => {
  if (!pi.environment) await pi.detect().catch(() => undefined)
  await store.fetchList()
})

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
      const msg = validation.issues.map((i) => i.message).join('\n')
      toast.error(msg || t('skills.validationFailed'))
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
      (s) => s.name === payload.name && s.source === payload.targetRoot
    )
    if (found) await store.loadDetail(found.path)
  } catch (e) {
    const payload = getErrorPayload(e)
    if (payload.code === 'SKILL_CONFLICT' && editing.value) {
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
      if (reloadOk && editing.value) {
        await openEdit(editing.value)
      }
      return
    }
    toast.error(payload.message ?? t('skills.saveFailed'))
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
    importForm.source = ''
    importForm.name = ''
    await store.refresh()
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('skills.importFailed'))
  } finally {
    importBusy.value = false
  }
}

function deriveName(source: string): string {
  const segs = source.replace(/[\\/]+$/, '').split(/[\\/]/)
  const last = segs[segs.length - 1] ?? 'imported-skill'
  return last
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
}

async function reveal(skill: SkillInfo) {
  try {
    await getApi().system.showItem(skill.path)
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('skills.revealFailed'))
  }
}

async function openFolder(skill: SkillInfo) {
  try {
    await getApi().system.openPath(skill.source)
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('skills.openFailed'))
  }
}

function askDelete(skill: SkillInfo) {
  deleting.value = skill
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deleting.value) return
  try {
    await store.remove(deleting.value.path)
    toast.success(t('skills.deleted'))
    deleteOpen.value = false
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('skills.deleteFailed'))
  }
}

function selectedSkill(): SkillInfo | undefined {
  return store.skills.find((x) => x.path === store.selectedPath)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header
      class="flex shrink-0 items-center justify-between gap-3 px-5 h-[var(--height-page-header)] border-b border-[var(--border-subtle)]"
    >
      <div class="min-w-0">
        <h1 class="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          {{ $t('nav.skills') }}
        </h1>
        <p class="text-[11.5px] text-[var(--text-tertiary)] -mt-0.5">
          {{ $t('skills.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" :loading="store.loading" @click="store.refresh">
          <RefreshCw class="size-3.5" :stroke-width="1.75" />
        </Button>
        <Button variant="secondary" size="sm" @click="openImport">
          <FileInput class="size-3.5" :stroke-width="1.75" />
          {{ $t('skills.import') }}
        </Button>
        <Button variant="primary" size="sm" @click="openCreate">
          <FilePlus2 class="size-3.5" :stroke-width="1.75" />
          {{ $t('skills.create') }}
        </Button>
      </div>
    </header>

    <!-- macOS Split View: one workspace, a vertical hairline, no Card chrome. -->
    <div class="flex min-h-0 flex-1">
      <!-- Left: skill source list -->
      <div class="flex min-h-0 w-[280px] shrink-0 flex-col border-r border-[var(--border-subtle)]">
        <div class="px-3 py-2 border-b border-[var(--border-subtle)]">
          <SearchField v-model="query" :placeholder="$t('skills.filterPlaceholder')" size="sm" />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-if="!store.loading && filteredSkills.length === 0" class="px-3 py-6">
            <EmptyState
              v-if="store.skills.length === 0"
              :title="$t('skills.empty')"
              :description="$t('skills.emptyHint')"
              :icon="Sparkles"
            />
            <EmptyState
              v-else
              :title="$t('skills.filterEmpty')"
              :description="$t('skills.filterEmptyHint')"
              :icon="Search"
            />
          </div>
          <ul v-else class="py-1">
            <li
              v-for="skill in filteredSkills"
              :key="skill.path"
              class="group relative cursor-pointer px-3 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)]"
              :class="
                store.selectedPath === skill.path
                  ? 'bg-[var(--accent-tint)]'
                  : 'hover:bg-[var(--bg-hover)]'
              "
              :style="{ minHeight: 'var(--height-row)' }"
              @click="store.loadDetail(skill.path)"
            >
              <span
                v-if="store.selectedPath === skill.path"
                class="pointer-events-none absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
              />
              <div class="flex flex-col gap-0.5 py-2">
                <div class="flex items-center gap-2">
                  <span
                    class="truncate text-[13px] font-medium"
                    :class="
                      store.selectedPath === skill.path
                        ? 'text-[var(--accent)]'
                        : 'text-[var(--text-primary)]'
                    "
                  >
                    {{ skill.name }}
                  </span>
                  <Badge v-if="!skill.isValid" tone="warning"> ! </Badge>
                </div>
                <p
                  v-if="skill.description"
                  class="truncate text-[11px] text-[var(--text-tertiary)]"
                >
                  {{ skill.description }}
                </p>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <!-- Right: skill inspector -->
      <div class="flex min-h-0 flex-1 flex-col">
        <div v-if="!store.selectedPath" class="flex flex-1 items-center justify-center">
          <EmptyState
            :title="$t('skills.select')"
            :description="$t('skills.selectHint')"
            :icon="Sparkles"
          />
        </div>
        <template v-else>
          <!-- Inspector header (sticky) -->
          <div
            class="flex shrink-0 items-center justify-between gap-3 px-5 h-[44px] border-b border-[var(--border-subtle)]"
          >
            <div class="min-w-0">
              <h2 class="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                {{ selectedSkill()?.name }}
              </h2>
              <p
                class="truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
              >
                {{ selectedSkill()?.path }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <IconButton
                :label="$t('skills.edit')"
                @click="
                  () => {
                    const s = selectedSkill()
                    if (s) void openEdit(s)
                  }
                "
              >
                <FileEdit class="size-3.5" :stroke-width="1.75" />
              </IconButton>
              <IconButton
                :label="$t('skills.openFolder')"
                @click="
                  () => {
                    const s = selectedSkill()
                    if (s) void openFolder(s)
                  }
                "
              >
                <FolderOpen class="size-3.5" :stroke-width="1.75" />
              </IconButton>
              <IconButton
                :label="$t('skills.reveal')"
                @click="
                  () => {
                    const s = selectedSkill()
                    if (s) void reveal(s)
                  }
                "
              >
                <Eye class="size-3.5" :stroke-width="1.75" />
              </IconButton>
              <IconButton
                variant="danger"
                :label="$t('common.delete')"
                @click="
                  () => {
                    const s = selectedSkill()
                    if (s) askDelete(s)
                  }
                "
              >
                <Trash2 class="size-3.5" :stroke-width="1.75" />
              </IconButton>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto">
            <InspectorSection>
              <template #title>Skill</template>
              <PropertyRow
                v-if="selectedSkill()?.description"
                :label="$t('skills.fieldDescription')"
              >
                {{ selectedSkill()?.description }}
              </PropertyRow>
              <PropertyRow :label="$t('skills.colStatus')" mono>
                <Badge :tone="selectedSkill()?.isValid ? 'success' : 'warning'">
                  {{ selectedSkill()?.isValid ? $t('skills.statusOk') : $t('skills.statusIssues') }}
                </Badge>
              </PropertyRow>
              <PropertyRow :label="$t('skills.colSource')" mono>
                {{ selectedSkill()?.source }}
              </PropertyRow>
              <PropertyRow :label="$t('skills.colModified')" mono>
                {{ selectedSkill() ? formatRelativeTime(selectedSkill()!.lastModified, locale) : '—' }}
              </PropertyRow>
            </InspectorSection>

            <div class="h-px bg-[var(--border-subtle)] my-1" />

            <InspectorSection>
              <template #title>{{ $t('skills.preview') }}</template>
              <pre
                v-if="store.detailLoading"
                class="px-3 py-3 text-[12px] text-[var(--text-tertiary)]"
                v-text="$t('common.loading')"
              />
              <pre
                v-else
                class="px-3 py-3 font-[family-name:var(--font-mono)] text-[12px] leading-[1.6] text-[var(--text-secondary)] whitespace-pre-wrap break-words"
                v-text="store.detailContent"
              />
            </InspectorSection>
          </div>
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
          {{ $t('common.cancel') }}
        </Button>
        <Button variant="danger" size="sm" @click="confirmDelete">
          {{ $t('common.delete') }}
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
            :options="knownRoots.map((r) => ({ value: r, label: r }))"
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
        <Button variant="ghost" @click="editorOpen = false">
          {{ $t('common.cancel') }}
        </Button>
        <Button variant="primary" :loading="saveBusy" @click="saveSkill">
          {{ $t('common.save') }}
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
          :options="knownRoots.map((r) => ({ value: r, label: r }))"
        />
      </div>
      <template #footer>
        <Button variant="ghost" @click="importOpen = false">
          {{ $t('common.cancel') }}
        </Button>
        <Button variant="primary" :loading="importBusy" @click="startImport">
          <FileInput class="size-3.5" :stroke-width="1.75" />
          {{ $t('skills.import') }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
