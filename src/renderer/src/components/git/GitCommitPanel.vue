<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Minus, Plus, Sparkles, Undo2 } from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import Select from '@renderer/components/ui/Select.vue'
import Textarea from '@renderer/components/ui/Textarea.vue'
import ContextMenu from '@renderer/components/ui/ContextMenu.vue'
import { callApi, getApi, getErrorMessage } from '@renderer/composables/useApi'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useModelsStore } from '@renderer/stores/models'
import { useProvidersStore } from '@renderer/stores/providers'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import type { GitFileStatus, GitActionRequest } from '@shared/types/workspace'

/**
 * Right panel, following WangmiaoGit's CommitPanelView: unstaged / staged
 * file sections that size to their content, then the message area pinned
 * below with amend + AI generate + the commit button. Selecting a commit
 * in the graph draws CommitDetailView OVER this panel, so layout below
 * stays intact.
 */
const emit = defineEmits<{
  'open-file': [file: GitFileStatus]
  'file-history': [filePath: string]
}>()
const { t } = useI18n()
const workspace = useWorkspaceStore()
const models = useModelsStore()
const providers = useProvidersStore()
const message = ref('')
const amend = ref(false)
const mutating = ref(false)
const generating = ref(false)
const committing = ref(false)
const fileMenu = ref<{ file: GitFileStatus; x: number; y: number } | null>(null)

const repository = computed(() => workspace.gitStatus?.repositoryRoot ?? null)
const files = computed(() => workspace.gitStatus?.files ?? [])
const staged = computed(() =>
  files.value.filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?')
)
const unstaged = computed(() =>
  files.value.filter((file) => file.worktreeStatus !== ' ' || file.indexStatus === '?')
)
const conflicted = computed(() => files.value.some((file) => file.status === 'conflict'))

// --- Model picker: defaults to the active model, switchable in place -----
type ModelEntry = { providerKey: string; modelId: string; label: string; group: string }
const COMMIT_MODEL_STORAGE_KEY = 'pi-harness.git-commit-model'
const selectedModel = ref<ModelEntry | null>(readStoredCommitModel())
const modelPickerTone = ref<'default' | 'error'>('default')

function readStoredCommitModel(): ModelEntry | null {
  try {
    const raw = localStorage.getItem(COMMIT_MODEL_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { providerKey?: string; modelId?: string }
    if (!parsed.providerKey || !parsed.modelId) return null
    return {
      providerKey: parsed.providerKey,
      modelId: parsed.modelId,
      label: parsed.modelId,
      group: parsed.providerKey
    }
  } catch {
    return null
  }
}

function persistCommitModel(entry: ModelEntry): void {
  localStorage.setItem(
    COMMIT_MODEL_STORAGE_KEY,
    JSON.stringify({ providerKey: entry.providerKey, modelId: entry.modelId })
  )
}

/** Enabled models with a resolvable provider key, grouped like the chat picker. */
const modelChoices = computed<ModelEntry[]>(() => {
  const byProviderId = new Map(providers.items.map((item) => [item.id, item]))
  const activeProvider = models.active.providerKey
  const entries = models.items
    .filter((model) => model.enabled)
    .map((model) => {
      const provider = byProviderId.get(model.providerId)
      return {
        providerKey: provider?.key ?? '',
        modelId: model.modelId,
        label: model.displayName || model.modelId,
        group: provider?.displayName || provider?.name || provider?.key || ''
      }
    })
    .filter((model) => model.providerKey)
  entries.sort((a, b) => {
    const aActiveProvider = a.providerKey === activeProvider ? 0 : 1
    const bActiveProvider = b.providerKey === activeProvider ? 0 : 1
    if (aActiveProvider !== bActiveProvider) return aActiveProvider - bActiveProvider
    const group = a.group.localeCompare(b.group)
    if (group) return group
    const aActive =
      a.providerKey === models.active.providerKey && a.modelId === models.active.modelId ? 0 : 1
    const bActive =
      b.providerKey === models.active.providerKey && b.modelId === models.active.modelId ? 0 : 1
    return aActive - bActive || a.label.localeCompare(b.label)
  })
  return entries
})

watch(
  modelChoices,
  (choices) => {
    if (!selectedModel.value) return
    const match = choices.find(
      (entry) =>
        entry.providerKey === selectedModel.value?.providerKey &&
        entry.modelId === selectedModel.value.modelId
    )
    if (match) selectedModel.value = match
    else if (choices.length) selectedModel.value = null
  },
  { immediate: true }
)

/** What generation will use: an explicit pick, else the active model. */
const effectiveModel = computed<ModelEntry | null>(() => {
  if (selectedModel.value) return selectedModel.value
  if (!models.active.providerKey || !models.active.modelId) return null
  return (
    modelChoices.value.find(
      (entry) =>
        entry.providerKey === models.active.providerKey && entry.modelId === models.active.modelId
    ) ?? {
      providerKey: models.active.providerKey,
      modelId: models.active.modelId,
      label: models.active.modelId,
      group: models.active.providerKey
    }
  )
})

const modelOptions = computed(() =>
  modelChoices.value.map((entry) => ({
    value: `${entry.providerKey}/${entry.modelId}`,
    label: entry.label,
    group: entry.group
  }))
)

const modelValue = computed({
  get: () =>
    effectiveModel.value
      ? `${effectiveModel.value.providerKey}/${effectiveModel.value.modelId}`
      : '',
  set: (value: string) => {
    const entry = modelChoices.value.find((item) => `${item.providerKey}/${item.modelId}` === value)
    if (!entry) return
    selectedModel.value = entry
    persistCommitModel(entry)
    modelPickerTone.value = 'default'
  }
})

function isModelSwitchError(raw: string): boolean {
  return /quota is exhausted|AccountQuotaExceeded|usage quota|cannot disable thinking|thinking\.type disabled|empty commit message/i.test(
    raw
  )
}

function generateFailureMessage(error: unknown): string {
  const raw = getErrorMessage(error)
  if (/quota is exhausted|AccountQuotaExceeded|usage quota/i.test(raw)) {
    const reset =
      raw.match(/until\s+(.+?)\.\s+Switch/i)?.[1] ?? raw.match(/reset at\s+(.+?)(?:\.|$)/i)?.[1]
    return reset
      ? t('workspace.gitGenerateQuotaReset', { time: reset.trim() })
      : t('workspace.gitGenerateQuota')
  }
  if (/cannot disable thinking|thinking\.type disabled/i.test(raw)) {
    return t('workspace.gitGenerateThinkingUnsupported')
  }
  if (/empty commit message/i.test(raw)) {
    return t('workspace.gitGenerateEmpty')
  }
  return raw
}

// Amend needs the previous commit's subject as the starting message.
watch(amend, async (amending) => {
  const cwd = repository.value
  if (!amending || !cwd || message.value) {
    if (!amending) message.value = ''
    return
  }
  try {
    const details = await callApi(() => getApi().git.history(cwd, 1))
    message.value = details[0]?.subject ?? ''
  } catch {
    // Leave the box empty; the user can type over it either way.
  }
})

async function mutate(action: 'stage' | 'unstage', targets: GitFileStatus[]) {
  const cwd = repository.value
  if (!cwd || !targets.length || mutating.value) return
  mutating.value = true
  try {
    await callApi(() =>
      getApi().git[action](
        cwd,
        targets.map((file) => file.filePath)
      )
    )
    await workspace.refreshContent()
  } catch (error) {
    toast.error(getErrorMessage(error))
  } finally {
    mutating.value = false
  }
}

async function runAction(input: Omit<GitActionRequest, 'cwd'>, label: string) {
  const cwd = repository.value
  if (!cwd || mutating.value) return
  mutating.value = true
  try {
    await callApi(() => getApi().git.action({ cwd, ...input }))
    await workspace.refreshContent()
    toast.success(t('workspace.gitActionDone', { action: label }))
  } catch (error) {
    toast.error(getErrorMessage(error))
  } finally {
    mutating.value = false
  }
}

async function discard(file: GitFileStatus) {
  const ok = await askConfirm({
    title: t('workspace.gitDiscardFile'),
    description: t('workspace.gitDiscardFileConfirm', {
      file: workspace.gitDisplayFilePath(file.filePath)
    }),
    confirmLabel: t('workspace.gitDiscard'),
    tone: 'danger'
  })
  if (!ok) return
  if (file.indexStatus === '?') {
    // Untracked: restore cannot remove it, drop the file itself.
    await runAction({ action: 'discard-all' }, t('workspace.gitDiscard'))
    return
  }
  await runAction({ action: 'discard-file', target: file.filePath }, t('workspace.gitDiscard'))
}

async function generate() {
  const cwd = repository.value
  if (!cwd || !staged.value.length || generating.value) return
  generating.value = true
  try {
    const model = effectiveModel.value
      ? {
          providerKey: effectiveModel.value.providerKey,
          modelId: effectiveModel.value.modelId
        }
      : null
    const result = await callApi(() =>
      getApi().git.generateCommitMessage(cwd, message.value, model)
    )
    message.value = result.message
    modelPickerTone.value = 'default'
    toast.success(t('workspace.gitMessageGenerated'))
  } catch (error) {
    const text = generateFailureMessage(error)
    toast.error(text)
    if (isModelSwitchError(text) || isModelSwitchError(getErrorMessage(error))) {
      modelPickerTone.value = 'error'
    }
  } finally {
    generating.value = false
  }
}

async function commit() {
  const cwd = repository.value
  const value = message.value.trim()
  if (!cwd || !value || !staged.value.length || conflicted.value || committing.value) return
  committing.value = true
  const amending = amend.value
  let toastHash = ''
  try {
    if (amending) {
      const result = await callApi(() =>
        getApi().git.action({ cwd, action: 'amend-commit', message: value })
      )
      amend.value = false
      toastHash = result.hash?.slice(0, 7) ?? ''
    } else {
      const result = await callApi(() => getApi().git.commit(cwd, value))
      toastHash = result.hash.slice(0, 7)
    }
    message.value = ''
    await workspace.refreshContent()
    toast.success(
      toastHash ? t('workspace.gitCommitted', { hash: toastHash }) : t('workspace.gitAmended')
    )
  } catch (error) {
    toast.error(getErrorMessage(error))
  } finally {
    committing.value = false
  }
}

const fileMenuEntries = computed(() => {
  const file = fileMenu.value?.file
  if (!file) return []
  const isStaged = file.indexStatus !== ' ' && file.indexStatus !== '?'
  const entries: Array<
    | { type: 'action'; id: string; label: string; disabled?: boolean; danger?: boolean }
    | { type: 'separator'; id: string }
  > = [
    {
      type: 'action',
      id: isStaged ? 'unstage' : 'stage',
      label: isStaged ? t('workspace.gitUnstage') : t('workspace.gitStage')
    },
    {
      type: 'action',
      id: 'stash-file',
      label: t('workspace.gitStashFile')
    },
    {
      type: 'action',
      id: 'file-history',
      label: t('workspace.gitFileHistory')
    },
    { type: 'separator', id: 's1' }
  ]
  if (file.indexStatus !== '?') {
    entries.push({
      type: 'action',
      id: 'discard',
      label: t('workspace.gitDiscard'),
      danger: true
    })
  }
  return entries
})

async function runFileMenuAction(action: string) {
  const file = fileMenu.value?.file
  if (!file) return
  if (action === 'stage') return mutate('stage', [file])
  if (action === 'unstage') return mutate('unstage', [file])
  if (action === 'discard') return discard(file)
  if (action === 'file-history') return emit('file-history', file.filePath)
  if (action === 'stash-file') {
    await runAction(
      { action: 'stash', ...(file.indexStatus !== '?' ? { target: file.filePath } : {}) },
      t('workspace.gitStash')
    )
  }
}

function statusClass(status: string, area: 'worktree' | 'index'): string {
  const code = area === 'worktree' ? status : status
  if (code === 'A' || code === '?') return 'text-[var(--success)]'
  if (code === 'D') return 'text-[var(--danger)]'
  if (code === 'R' || code === 'C') return 'text-[var(--warning)]'
  if (code === 'U') return 'text-[var(--error)]'
  return 'text-[var(--accent)]'
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[var(--bg-surface)]" data-testid="git-commit-panel">
    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- Unstaged -->
      <section class="pt-2">
        <div class="flex items-center gap-1.5 px-2.5 pb-1">
          <span class="text-[10.5px] font-semibold text-[var(--text-secondary)]">
            {{ $t('workspace.gitUnstaged') }} ({{ unstaged.length }})
          </span>
          <button
            v-if="unstaged.length"
            type="button"
            class="ml-auto text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)]"
            :disabled="mutating"
            data-testid="git-stage-all"
            @click="mutate('stage', unstaged)"
          >
            {{ $t('workspace.gitStageAll') }}
          </button>
        </div>
        <p v-if="!unstaged.length" class="px-2.5 pb-2 text-[10px] text-[var(--text-disabled)]">
          {{ $t('workspace.gitNoUnstaged') }}
        </p>
        <div v-else class="px-1.5">
          <div
            v-for="file in unstaged"
            :key="`unstaged-${file.filePath}`"
            class="group flex min-w-0 items-center rounded-[var(--radius-sm)] pr-0.5 hover:bg-[var(--bg-hover)]"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-1 text-left"
              :title="workspace.gitDisplayFilePath(file.filePath)"
              @click="emit('open-file', file)"
              @contextmenu.prevent="fileMenu = { file, x: $event.clientX, y: $event.clientY }"
            >
              <span
                class="w-3.5 shrink-0 text-center font-[family-name:var(--font-mono)] text-[9.5px] font-bold"
                :class="statusClass(file.worktreeStatus, 'worktree')"
              >
                {{ file.worktreeStatus }}
              </span>
              <span class="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">
                {{ workspace.gitDisplayFilePath(file.filePath) }}
              </span>
            </button>
            <IconButton
              :label="$t('workspace.gitDiscard')"
              class="mr-0.5 opacity-0 group-hover:opacity-100"
              :disabled="mutating"
              @click="discard(file)"
            >
              <Undo2 class="size-3" />
            </IconButton>
            <IconButton
              :label="$t('workspace.gitStage')"
              :disabled="mutating"
              @click="mutate('stage', [file])"
            >
              <Plus class="size-3" />
            </IconButton>
          </div>
        </div>
      </section>

      <!-- Staged -->
      <section class="mt-1 border-t border-[var(--border-subtle)] pt-2">
        <div class="flex items-center gap-1.5 px-2.5 pb-1">
          <span class="text-[10.5px] font-semibold text-[var(--text-secondary)]">
            {{ $t('workspace.gitStaged') }} ({{ staged.length }})
          </span>
          <button
            v-if="staged.length"
            type="button"
            class="ml-auto text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            :disabled="mutating"
            @click="mutate('unstage', staged)"
          >
            {{ $t('workspace.gitUnstageAll') }}
          </button>
        </div>
        <p v-if="!staged.length" class="px-2.5 pb-2 text-[10px] text-[var(--text-disabled)]">
          {{ $t('workspace.gitNothingStaged') }}
        </p>
        <div v-else class="px-1.5 pb-2">
          <div
            v-for="file in staged"
            :key="`staged-${file.filePath}`"
            class="group flex min-w-0 items-center rounded-[var(--radius-sm)] pr-0.5 hover:bg-[var(--bg-hover)]"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-1 text-left"
              :title="workspace.gitDisplayFilePath(file.filePath)"
              @click="emit('open-file', file)"
              @contextmenu.prevent="fileMenu = { file, x: $event.clientX, y: $event.clientY }"
            >
              <span
                class="w-3.5 shrink-0 text-center font-[family-name:var(--font-mono)] text-[9.5px] font-bold"
                :class="statusClass(file.indexStatus, 'index')"
              >
                {{ file.indexStatus }}
              </span>
              <span class="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">
                {{ workspace.gitDisplayFilePath(file.filePath) }}
              </span>
            </button>
            <IconButton
              :label="$t('workspace.gitUnstage')"
              :disabled="mutating"
              @click="mutate('unstage', [file])"
            >
              <Minus class="size-3" />
            </IconButton>
          </div>
        </div>
      </section>
    </div>

    <!-- Message area pinned below the file lists. -->
    <div class="shrink-0 border-t border-[var(--border-subtle)] p-2.5">
      <label
        class="mb-1 flex select-none items-center gap-1.5 text-[10px] text-[var(--text-secondary)]"
      >
        <input
          v-model="amend"
          type="checkbox"
          class="accent-[var(--accent)]"
          :disabled="committing"
        />
        {{ $t('workspace.gitAmendPrevious') }}
      </label>
      <Textarea
        v-model="message"
        :rows="4"
        :placeholder="$t('workspace.gitCommitPlaceholder')"
        :disabled="generating || committing"
        class="max-h-44 min-h-20 resize-y"
      />
      <div class="mt-1 flex min-w-0 items-center gap-1.5">
        <Select
          v-model="modelValue"
          size="sm"
          class="min-w-0 flex-1"
          data-testid="git-model-picker"
          :options="modelOptions"
          :disabled="!modelOptions.length || generating || committing"
          :aria-label="$t('workspace.gitSwitchModel')"
          :placeholder="$t('workspace.gitNoActiveModel')"
          :tone="modelPickerTone"
          cascade
        />
        <Button
          size="sm"
          variant="ghost"
          :loading="generating"
          :disabled="!staged.length || conflicted"
          :title="$t('workspace.gitGenerateHint')"
          data-testid="git-generate-message"
          @click="generate"
        >
          <Sparkles class="size-3 text-[var(--accent)]" />
          {{ $t('workspace.gitGenerate') }}
        </Button>
      </div>
      <p v-if="conflicted" class="mt-1 text-[10px] leading-snug text-[var(--error)]">
        {{ $t('workspace.gitResolveConflicts') }}
      </p>
      <Button
        class="mt-1.5 w-full"
        variant="primary"
        :loading="committing"
        :disabled="!message.trim() || !staged.length || conflicted"
        data-testid="git-create-commit"
        @click="commit"
      >
        {{
          amend
            ? $t('workspace.gitAmendCommit')
            : $t('workspace.gitCommitCount', { count: staged.length })
        }}
      </Button>
    </div>

    <ContextMenu
      :open="Boolean(fileMenu)"
      :x="fileMenu?.x ?? 0"
      :y="fileMenu?.y ?? 0"
      :label="fileMenu ? workspace.gitDisplayFilePath(fileMenu.file.filePath) : ''"
      :entries="fileMenuEntries"
      test-id="git-file-context-menu"
      @close="fileMenu = null"
      @select="runFileMenuAction"
    />
  </div>
</template>
