<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Archive, ArchiveRestore, ArrowDownToLine, ArrowUpToLine, ChevronDown, GitBranch, RefreshCw, Search, X } from '@lucide/vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi, getErrorMessage } from '@renderer/composables/useApi'
import type {
  GitAction,
  GitCommitInfo,
  GitCommitFileInfo,
  GitFileStatus
} from '@shared/types/workspace'
import { filterGitCommitsByTip } from '@shared/workspace/git-graph'
import IconButton from '@renderer/components/ui/IconButton.vue'
import ContextMenu from '@renderer/components/ui/ContextMenu.vue'
import GitHistoryGraph from './GitHistoryGraph.vue'
import GitFileDiffDrawer from './GitFileDiffDrawer.vue'
import GitFileHistoryDrawer from './GitFileHistoryDrawer.vue'

interface RefSelection {
  name: string
  hash: string
}

type ContextMenuEntry =
  | {
      type: 'action'
      id: string
      label: string
      disabled?: boolean
      danger?: boolean
      checked?: boolean
      inset?: boolean
      value?: string
      testId?: string
    }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: string }

/** Overlay state handed down by GitView so panes below stay alive. */
defineProps<{
  selectedHash: string | null
  /** Working-tree diff drawer (from the commit panel). */
  workingFile: GitFileStatus | null
  workingPatch: string
  workingLoading: boolean
  /** Historical diff drawer (from the commit review). */
  commitFile: GitCommitFileInfo | null
  commitPatch: string
  commitLoading: boolean
  commitHash: string | null
  /** File history drawer (from either file list). */
  historyFile: string | null
  historyCommits: GitCommitInfo[]
  fileHistoryLoading: boolean
}>()

const emit = defineEmits<{
  'select-commit': [hash: string]
  'close-working-diff': []
  'close-commit-diff': []
  'close-file-history': []
  'open-commit': [commit: GitCommitInfo]
  'select-ref': [selection: RefSelection]
}>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const commits = ref<GitCommitInfo[]>([])
const historyLoading = ref(false)
const actionBusy = ref(false)
const activeRef = ref<RefSelection | null>(null)
const searchQuery = ref('')
const pullMenu = ref<{ x: number; y: number } | null>(null)
let historyRequest = 0

const repository = computed(() => workspace.gitStatus?.repositoryRoot ?? null)
const visibleCommits = computed(() => {
  const filtered = filterGitCommitsByTip(commits.value, activeRef.value?.hash ?? null)
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (!query) return filtered
  return filtered.filter((commit) =>
    [commit.subject, commit.author, commit.email, commit.hash, ...commit.refs]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query)
  )
})

const pullMenuEntries = computed<ContextMenuEntry[]>(() => [
  { type: 'action', id: 'pull', label: t('workspace.gitPull') },
  { type: 'action', id: 'pull-rebase', label: t('workspace.gitPullRebase') },
  { type: 'separator', id: 's1' },
  { type: 'action', id: 'fetch', label: t('workspace.gitFetch') },
  { type: 'action', id: 'push', label: t('workspace.gitPush') }
])

function clearFilter() {
  activeRef.value = null
}

function selectRef(selection: RefSelection) {
  if (activeRef.value?.name === selection.name && activeRef.value.hash === selection.hash) {
    clearFilter()
    return
  }
  activeRef.value = selection
}

async function loadHistory() {
  const request = ++historyRequest
  const cwd = repository.value
  if (!cwd) {
    commits.value = []
    activeRef.value = null
    return
  }
  historyLoading.value = true
  try {
    const nextCommits = await callApi(() => getApi().git.history(cwd, 200))
    if (request !== historyRequest || repository.value !== cwd) return
    commits.value = nextCommits
    if (activeRef.value && !commits.value.some((item) => item.hash === activeRef.value?.hash)) {
      activeRef.value = null
    }
  } catch (error) {
    if (request !== historyRequest || repository.value !== cwd) return
    commits.value = []
    toast.error(getErrorMessage(error))
  } finally {
    if (request === historyRequest) historyLoading.value = false
  }
}

async function runAction(action: GitAction, label: string) {
  const cwd = repository.value
  if (!cwd || actionBusy.value) return
  actionBusy.value = true
  try {
    await callApi(() => getApi().git.action({ cwd, action }))
    await workspace.refreshContent()
    await loadHistory()
    toast.success(t('workspace.gitActionDone', { action: label }))
  } catch (error) {
    toast.error(getErrorMessage(error))
  } finally {
    actionBusy.value = false
  }
}

async function runPullMenuAction(id: string) {
  if (id === 'pull') return runAction('pull', t('workspace.gitPull'))
  if (id === 'pull-rebase') return runAction('pull-rebase', t('workspace.gitPullRebase'))
  if (id === 'fetch') return runAction('fetch', t('workspace.gitFetch'))
  if (id === 'push') return runAction('push', t('workspace.gitPush'))
}

function focusCommitPanel() {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    '[data-testid="git-commit-panel"] textarea'
  )
  textarea?.focus()
}

function openCreateBranch() {
  document.querySelector<HTMLButtonElement>('[data-testid="git-create-branch-sidebar"]')?.click()
}

/** A ref picked in the sidebar filters the graph; a commit locates a row. */
function applySidebarRef(selection: RefSelection) {
  selectRef(selection)
}

function locateCommit(hash: string) {
  emit('select-commit', hash)
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-commit-hash="${hash}"]`)
    row?.scrollIntoView({ block: 'center' })
  })
}

watch([repository, () => workspace.gitRevision], loadHistory, { immediate: true })

defineExpose({
  applySidebarRef,
  locateCommit,
  loadHistory
})
</script>

<template>
  <div
    class="git-workspace-view flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    data-testid="git-workspace-view"
  >
    <header
      class="git-toolbar flex h-11 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2"
    >
      <button type="button" class="git-command" @click="focusCommitPanel">
        {{ $t('workspace.gitCommit') }}
      </button>
      <button
        type="button"
        class="git-command"
        :disabled="actionBusy"
        data-testid="git-pull"
        @click="runAction('pull', $t('workspace.gitPull'))"
      >
        <ArrowDownToLine class="size-3.5" />{{ $t('workspace.gitPull') }}
      </button>
      <button
        type="button"
        class="git-command git-command--careted"
        :disabled="actionBusy"
        :aria-label="$t('workspace.gitPullMode')"
        data-testid="git-pull-mode"
        @click.stop="
          pullMenu = {
            x: ($event.currentTarget as HTMLElement).getBoundingClientRect().left,
            y: ($event.currentTarget as HTMLElement).getBoundingClientRect().bottom + 4
          }
        "
      >
        <ChevronDown class="size-3" />
      </button>
      <button
        type="button"
        class="git-command"
        :disabled="actionBusy"
        @click="runAction('fetch', $t('workspace.gitFetch'))"
      >
        <RefreshCw class="size-3.5" />{{ $t('workspace.gitFetch') }}
      </button>
      <button
        type="button"
        class="git-command"
        :disabled="actionBusy"
        data-testid="git-push"
        @click="runAction('push', $t('workspace.gitPush'))"
      >
        <ArrowUpToLine class="size-3.5" />{{ $t('workspace.gitPush') }}
      </button>
      <button type="button" class="git-command" @click="openCreateBranch">
        <GitBranch class="size-3.5" />{{ $t('workspace.gitBranch') }}
      </button>
      <button
        type="button"
        class="git-command"
        :disabled="actionBusy"
        @click="runAction('stash', $t('workspace.gitStash'))"
      >
        <Archive class="size-3.5" />{{ $t('workspace.gitStash') }}
      </button>
      <button
        type="button"
        class="git-command"
        :disabled="actionBusy"
        @click="runAction('stash-pop', $t('workspace.gitPop'))"
      >
        <ArchiveRestore class="size-3.5" />{{ $t('workspace.gitPop') }}
      </button>

      <div class="relative ml-auto w-[min(240px,28%)] min-w-32">
        <Search
          class="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[var(--text-tertiary)]"
        />
        <input
          v-model="searchQuery"
          type="search"
          class="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] pl-7 pr-7 text-[10.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-border)]"
          :placeholder="$t('workspace.gitSearchCommits')"
          data-testid="git-search"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
          @click="searchQuery = ''"
        >
          <X class="size-3" />
        </button>
      </div>
    </header>

    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
      <GitBranch class="size-3.5 text-[var(--accent)]" :stroke-width="1.7" />
      <span class="text-[11.5px] font-medium text-[var(--text-primary)]">
        {{ $t('workspace.gitGraph') }}
      </span>
      <span class="text-[10px] text-[var(--text-tertiary)]">
        {{ visibleCommits.length }}<template v-if="activeRef"> / {{ commits.length }}</template>
      </span>
      <button
        v-if="activeRef"
        type="button"
        class="flex min-w-0 max-w-[320px] items-center gap-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-0.5 text-[10px] text-[var(--accent)] hover:bg-[var(--accent-tint-strong)]"
        :title="$t('workspace.gitClearRefFilter')"
        data-testid="git-active-ref-filter"
        @click="clearFilter"
      >
        <span class="truncate">{{ $t('workspace.gitFilteredBy', { ref: activeRef.name }) }}</span>
        <X class="size-2.5 shrink-0" />
      </button>
      <IconButton
        class="ml-auto"
        :label="$t('common.refresh')"
        :disabled="historyLoading"
        @click="loadHistory"
      >
        <RefreshCw class="size-3.5" :class="historyLoading ? 'animate-spin' : ''" />
      </IconButton>
    </div>

    <!-- The graph pane: drawers OVERLAY it instead of replacing it, so its
         scroll position and selection survive open/close. -->
    <div class="relative min-h-0 min-w-0 flex-1">
      <GitHistoryGraph
        class="absolute inset-0 min-h-0 min-w-0"
        :commits="visibleCommits"
        :loading="historyLoading"
        :selected-hash="selectedHash"
        :active-ref="activeRef?.name ?? null"
        @select="emit('select-commit', $event.hash)"
        @select-ref="selectRef"
      />

      <GitFileHistoryDrawer
        v-if="historyFile"
        :file-path="historyFile"
        :commits="historyCommits"
        :loading="fileHistoryLoading"
        @close="emit('close-file-history')"
        @select-commit="emit('open-commit', $event)"
      />

      <GitFileDiffDrawer
        v-if="commitFile"
        :file-path="commitFile.path"
        :patch="commitPatch"
        :loading="commitLoading"
        :badge="$t('workspace.gitHistoricalDiff')"
        :commit-hash="commitHash"
        test-id="git-historical-diff"
        @close="emit('close-commit-diff')"
      />

      <GitFileDiffDrawer
        v-if="workingFile"
        :file-path="workingFile.filePath"
        :patch="workingPatch"
        :loading="workingLoading"
        :badge="$t('workspace.gitWorkingDiff')"
        test-id="git-working-diff"
        @close="emit('close-working-diff')"
      />
    </div>

    <ContextMenu
      :open="Boolean(pullMenu)"
      :x="pullMenu?.x ?? 0"
      :y="pullMenu?.y ?? 0"
      :label="t('workspace.gitPullMode')"
      :entries="pullMenuEntries"
      test-id="git-pull-mode-menu"
      @close="pullMenu = null"
      @select="runPullMenuAction"
    />
  </div>
</template>

<style scoped>
.git-workspace-view {
  container-type: inline-size;
}

.git-command {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 0.3rem;
  border-radius: var(--radius-sm);
  padding: 0 0.45rem;
  color: var(--text-secondary);
  font-size: 10px;
  white-space: nowrap;
}

.git-command--careted {
  padding: 0 0.15rem;
}

.git-command:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.git-command:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

@container (max-width: 820px) {
  .git-command {
    width: 28px;
    justify-content: center;
    overflow: hidden;
    padding: 0;
    text-indent: 100px;
  }

  .git-command svg {
    flex: none;
    text-indent: 0;
  }
}
</style>
