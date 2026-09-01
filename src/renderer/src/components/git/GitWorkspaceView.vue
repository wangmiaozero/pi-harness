<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import type { GitCommitInfo, GitFileDiffResponse } from '@shared/types/workspace'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import GitHistoryGraph from './GitHistoryGraph.vue'
import { FileDiff, GitBranch, RefreshCw } from '@lucide/vue'
import { toast } from 'vue-sonner'

const workspace = useWorkspaceStore()
const diff = ref<GitFileDiffResponse | null>(null)
const commits = ref<GitCommitInfo[]>([])
const historyLoading = ref(false)

const repository = computed(() => workspace.gitStatus?.repositoryRoot ?? null)
const filePath = computed(() => {
  const path = workspace.activeTab?.kind === 'diff' ? workspace.activeTab.filePath : null
  if (!path || !workspace.gitStatus?.folderId) return null
  return workspace.folderForPath(path)?.id === workspace.gitStatus.folderId ? path : null
})

async function loadHistory() {
  const cwd = repository.value
  if (!cwd) {
    commits.value = []
    return
  }
  historyLoading.value = true
  try {
    commits.value = await callApi(() => getApi().git.history(cwd, 120))
  } catch (error) {
    commits.value = []
    toast.error(getErrorPayload(error).message)
  } finally {
    historyLoading.value = false
  }
}

watch(
  [filePath, repository, () => workspace.gitRevision],
  async ([path, cwd]) => {
    diff.value = null
    if (path && cwd) diff.value = await callApi(() => getApi().git.diff(cwd, path))
  },
  { immediate: true }
)

watch([repository, () => workspace.gitRevision], loadHistory, { immediate: true })
</script>

<template>
  <div class="git-workspace-view flex h-full min-h-0 min-w-0 overflow-hidden">
    <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header
        class="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3"
      >
        <FileDiff class="size-3.5 text-[var(--text-tertiary)]" :stroke-width="1.7" />
        <span
          class="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[var(--text-secondary)]"
        >
          {{ filePath ? workspace.displayFilePath(filePath) : $t('workspace.gitDiff') }}
        </span>
      </header>
      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        <EmptyState
          v-if="!filePath"
          :title="$t('workspace.gitSelectChange')"
          :description="$t('workspace.gitSelectChangeHint')"
          :icon="FileDiff"
        />
        <EmptyState v-else-if="!diff?.patch" :title="$t('workspace.noDiff')" :icon="GitBranch" />
        <pre
          v-else
          class="max-w-full whitespace-pre-wrap break-words font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)] [overflow-wrap:anywhere]"
          v-text="diff.patch"
        />
      </div>
    </section>

    <aside
      class="git-history-panel flex min-h-0 w-[40%] min-w-[320px] max-w-[520px] shrink-0 flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)]"
    >
      <header
        class="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2.5"
      >
        <GitBranch class="size-3.5 text-[var(--accent)]" :stroke-width="1.7" />
        <span class="text-[11.5px] font-medium text-[var(--text-primary)]">
          {{ $t('workspace.gitGraph') }}
        </span>
        <span class="text-[10px] text-[var(--text-tertiary)]">{{ commits.length }}</span>
        <IconButton
          class="ml-auto"
          :label="$t('common.refresh')"
          :disabled="historyLoading"
          @click="loadHistory"
        >
          <RefreshCw class="size-3.5" :class="historyLoading ? 'animate-spin' : ''" />
        </IconButton>
      </header>
      <GitHistoryGraph :commits="commits" :loading="historyLoading" />
    </aside>
  </div>
</template>

<style scoped>
.git-workspace-view {
  container-type: inline-size;
}

@container (max-width: 780px) {
  .git-history-panel {
    width: 44%;
    min-width: 260px;
  }
}
</style>
