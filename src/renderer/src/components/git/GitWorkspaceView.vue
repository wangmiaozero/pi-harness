<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  FileCode2,
  GitBranch,
  GitCommit,
  RefreshCw,
  Search,
  X
} from '@lucide/vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import type {
  GitAction,
  GitCommitDetails,
  GitCommitFileInfo,
  GitCommitInfo
} from '@shared/types/workspace'
import { filterGitCommitsByTip } from '@shared/workspace/git-graph'
import IconButton from '@renderer/components/ui/IconButton.vue'
import GitHistoryGraph from './GitHistoryGraph.vue'
import { toast } from 'vue-sonner'

interface RefSelection {
  name: string
  hash: string
}

const { t } = useI18n()
const workspace = useWorkspaceStore()
const commits = ref<GitCommitInfo[]>([])
const historyLoading = ref(false)
const actionBusy = ref(false)
const selectedHash = ref<string | null>(null)
const selectedDetails = ref<GitCommitDetails | null>(null)
const detailsLoading = ref(false)
const selectedFile = ref<GitCommitFileInfo | null>(null)
const commitPatch = ref('')
const patchLoading = ref(false)
const activeRef = ref<RefSelection | null>(null)
const searchQuery = ref('')
let historyRequest = 0
let detailsRequest = 0
let patchRequest = 0

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

function clearFilter() {
  activeRef.value = null
}

function selectRef(selection: RefSelection) {
  if (activeRef.value?.name === selection.name && activeRef.value.hash === selection.hash) {
    clearFilter()
    return
  }
  activeRef.value = selection
  selectedHash.value = selection.hash
}

async function loadHistory() {
  const request = ++historyRequest
  const cwd = repository.value
  if (!cwd) {
    commits.value = []
    selectedHash.value = null
    activeRef.value = null
    return
  }
  historyLoading.value = true
  try {
    const nextCommits = await callApi(() => getApi().git.history(cwd, 200))
    if (request !== historyRequest || repository.value !== cwd) return
    commits.value = nextCommits
    if (selectedHash.value && !commits.value.some((item) => item.hash === selectedHash.value)) {
      selectedHash.value = null
    }
    if (activeRef.value && !commits.value.some((item) => item.hash === activeRef.value?.hash)) {
      activeRef.value = null
    }
  } catch (error) {
    if (request !== historyRequest || repository.value !== cwd) return
    commits.value = []
    toast.error(getErrorPayload(error).message)
  } finally {
    if (request === historyRequest) historyLoading.value = false
  }
}

async function loadDetails(hash: string | null) {
  const request = ++detailsRequest
  const cwd = repository.value
  selectedDetails.value = null
  selectedFile.value = null
  commitPatch.value = ''
  if (!cwd || !hash) return
  detailsLoading.value = true
  try {
    const details = await callApi(() => getApi().git.commitDetails(cwd, hash))
    if (request !== detailsRequest || repository.value !== cwd || selectedHash.value !== hash) return
    selectedDetails.value = details
    if (details.files[0]) await loadCommitDiff(details.files[0])
  } catch (error) {
    if (request !== detailsRequest || repository.value !== cwd || selectedHash.value !== hash) return
    toast.error(getErrorPayload(error).message)
  } finally {
    if (request === detailsRequest) detailsLoading.value = false
  }
}

async function loadCommitDiff(file: GitCommitFileInfo) {
  const request = ++patchRequest
  const cwd = repository.value
  const details = selectedDetails.value
  if (!cwd || !details) return
  selectedFile.value = file
  commitPatch.value = ''
  patchLoading.value = true
  try {
    const result = await callApi(() => getApi().git.commitDiff(cwd, details.hash, file.path))
    if (
      request === patchRequest &&
      repository.value === cwd &&
      selectedDetails.value?.hash === details.hash &&
      selectedFile.value?.path === file.path
    ) {
      commitPatch.value = result.patch
    }
  } catch (error) {
    if (request !== patchRequest || repository.value !== cwd) return
    toast.error(getErrorPayload(error).message)
  } finally {
    if (request === patchRequest) patchLoading.value = false
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
    toast.error(getErrorPayload(error).message)
  } finally {
    actionBusy.value = false
  }
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

async function copyHash() {
  if (!selectedDetails.value) return
  await navigator.clipboard.writeText(selectedDetails.value.hash)
}

function fileStatusClass(status: GitCommitFileInfo['status']): string {
  if (status === 'A') return 'text-[var(--success)]'
  if (status === 'D') return 'text-[var(--danger)]'
  if (status === 'R' || status === 'C') return 'text-[var(--warning)]'
  return 'text-[var(--accent)]'
}

watch([repository, () => workspace.gitRevision], loadHistory, { immediate: true })
watch(selectedHash, loadDetails)
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
        <GitCommit class="size-3.5" />{{ $t('workspace.gitCommit') }}
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

    <div
      class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3"
    >
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

    <div class="relative flex min-h-0 min-w-0 flex-1">
      <GitHistoryGraph
        class="min-h-0 min-w-0 flex-1"
        :commits="visibleCommits"
        :loading="historyLoading"
        :selected-hash="selectedHash"
        :active-ref="activeRef?.name ?? null"
        @select="selectedHash = $event.hash"
        @select-ref="selectRef"
      />

      <aside
        v-if="selectedHash"
        class="git-review-panel flex min-h-0 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface-raised)]"
        data-testid="git-commit-review"
      >
        <header class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
          <span class="text-[10.5px] font-semibold text-[var(--text-secondary)]">
            {{ $t('workspace.gitCommitDetails') }}
          </span>
          <IconButton class="ml-auto" :label="$t('common.close')" @click="selectedHash = null">
            <X class="size-3.5" />
          </IconButton>
        </header>

        <div v-if="detailsLoading" class="space-y-2 p-3">
          <div class="h-4 animate-pulse rounded bg-[var(--bg-hover)]" />
          <div class="h-12 animate-pulse rounded bg-[var(--bg-hover)]" />
        </div>
        <template v-else-if="selectedDetails">
          <div class="shrink-0 border-b border-[var(--border-subtle)] p-3">
            <h3 class="text-[12px] font-semibold leading-snug text-[var(--text-primary)]">
              {{ selectedDetails.subject }}
            </h3>
            <p
              v-if="selectedDetails.body"
              class="mt-1 whitespace-pre-wrap text-[10.5px] leading-relaxed text-[var(--text-secondary)]"
            >
              {{ selectedDetails.body }}
            </p>
            <p class="mt-2 text-[9.5px] text-[var(--text-tertiary)]">
              {{ selectedDetails.author }} &lt;{{ selectedDetails.email }}&gt;
            </p>
            <div class="mt-1 flex items-center gap-1 text-[9.5px] text-[var(--text-tertiary)]">
              <code>{{ selectedDetails.hash }}</code>
              <IconButton :label="$t('common.copy')" @click="copyHash">
                <Copy class="size-3" />
              </IconButton>
            </div>
          </div>

          <div class="flex min-h-0 flex-1 flex-col">
            <div class="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2 text-[10px] font-semibold text-[var(--text-secondary)]">
              {{ $t('workspace.gitChangedFiles', { count: selectedDetails.files.length }) }}
            </div>
            <div class="max-h-44 shrink-0 overflow-y-auto border-b border-[var(--border-subtle)] p-1">
              <button
                v-for="file in selectedDetails.files"
                :key="`${file.status}-${file.path}`"
                type="button"
                class="flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
                :class="selectedFile?.path === file.path ? 'bg-[var(--bg-selected)]' : ''"
                @click="loadCommitDiff(file)"
              >
                <span class="w-3 shrink-0 font-mono text-[9.5px] font-bold" :class="fileStatusClass(file.status)">
                  {{ file.status }}
                </span>
                <span class="min-w-0 flex-1 truncate text-[10px] text-[var(--text-secondary)]">
                  {{ file.path }}
                </span>
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-auto bg-[var(--bg-surface)]">
              <div v-if="patchLoading" class="p-3 text-[10px] text-[var(--text-tertiary)]">
                {{ $t('common.loading') }}
              </div>
              <pre
                v-else-if="commitPatch"
                class="min-w-max whitespace-pre p-3 font-[family-name:var(--font-mono)] text-[9.5px] leading-[1.55] text-[var(--text-secondary)]"
              ><code>{{ commitPatch }}</code></pre>
              <div
                v-else
                class="flex h-full min-h-28 items-center justify-center gap-2 px-4 text-center text-[10px] text-[var(--text-disabled)]"
              >
                <FileCode2 class="size-4" />
                {{ selectedFile ? $t('workspace.gitNoPatch') : $t('workspace.gitSelectCommitFile') }}
              </div>
            </div>
          </div>
        </template>
      </aside>
    </div>
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

.git-command:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.git-command:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.git-review-panel {
  width: clamp(360px, 40%, 620px);
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

  .git-review-panel {
    width: min(440px, 60%);
    min-width: 320px;
  }
}
</style>
