<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import type { GitCommitInfo } from '@shared/types/workspace'
import { filterGitCommitsByTip } from '@shared/workspace/git-graph'
import IconButton from '@renderer/components/ui/IconButton.vue'
import GitHistoryGraph from './GitHistoryGraph.vue'
import { GitBranch, RefreshCw, X } from '@lucide/vue'
import { toast } from 'vue-sonner'

interface RefSelection {
  name: string
  hash: string
}

const workspace = useWorkspaceStore()
const commits = ref<GitCommitInfo[]>([])
const historyLoading = ref(false)
const selectedHash = ref<string | null>(null)
const activeRef = ref<RefSelection | null>(null)

const repository = computed(() => workspace.gitStatus?.repositoryRoot ?? null)
const visibleCommits = computed(() =>
  filterGitCommitsByTip(commits.value, activeRef.value?.hash ?? null)
)
const selectedCommit = computed(
  () => commits.value.find((commit) => commit.hash === selectedHash.value) ?? null
)

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
  const cwd = repository.value
  if (!cwd) {
    commits.value = []
    selectedHash.value = null
    activeRef.value = null
    return
  }
  historyLoading.value = true
  try {
    commits.value = await callApi(() => getApi().git.history(cwd, 120))
    if (selectedHash.value && !commits.value.some((item) => item.hash === selectedHash.value)) {
      selectedHash.value = null
    }
    if (activeRef.value && !commits.value.some((item) => item.hash === activeRef.value?.hash)) {
      activeRef.value = null
    }
  } catch (error) {
    commits.value = []
    toast.error(getErrorPayload(error).message)
  } finally {
    historyLoading.value = false
  }
}

watch([repository, () => workspace.gitRevision], loadHistory, { immediate: true })
</script>

<template>
  <div
    class="git-workspace-view flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    data-testid="git-workspace-view"
  >
    <header
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
    </header>

    <div
      v-if="selectedCommit"
      class="flex min-w-0 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--accent-tint)] px-3 py-2"
      data-testid="git-commit-detail"
    >
      <div class="min-w-0 flex-1">
        <p class="truncate text-[11.5px] font-medium text-[var(--text-primary)]">
          {{ selectedCommit.subject }}
        </p>
        <p
          class="mt-0.5 truncate font-[family-name:var(--font-mono)] text-[9.5px] text-[var(--text-tertiary)]"
        >
          {{ selectedCommit.hash }} · {{ selectedCommit.author }} &lt;{{ selectedCommit.email }}&gt;
        </p>
      </div>
      <span class="shrink-0 text-[9.5px] text-[var(--text-tertiary)]">
        {{ $t('workspace.gitParents', { count: selectedCommit.parents.length }) }}
      </span>
      <IconButton :label="$t('common.close')" @click="selectedHash = null">
        <X class="size-3.5" />
      </IconButton>
    </div>

    <GitHistoryGraph
      class="min-h-0 flex-1"
      :commits="visibleCommits"
      :loading="historyLoading"
      :selected-hash="selectedHash"
      :active-ref="activeRef?.name ?? null"
      @select="selectedHash = $event.hash"
      @select-ref="selectRef"
    />
  </div>
</template>

<style scoped>
.git-workspace-view {
  container-type: inline-size;
}
</style>
