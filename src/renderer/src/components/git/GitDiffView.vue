<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'
import type { GitFileDiffResponse } from '@shared/types/workspace'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { GitBranch } from '@lucide/vue'

const workspace = useWorkspaceStore()
const diff = ref<GitFileDiffResponse | null>(null)
const filePath = computed(() => workspace.activeTab?.filePath ?? null)

watch(
  [filePath, () => workspace.contentRevision],
  async ([path]) => {
    diff.value = null
    if (!path) return
    const cwd =
      workspace.folderForPath(path)?.resolvedPath ??
      workspace.gitFolderForPath(path)?.resolvedPath ??
      workspace.currentCwd
    if (!cwd) return
    diff.value = await callApi(() => getApi().git.diff(cwd, path))
  },
  { immediate: true }
)
</script>

<template>
  <div class="git-diff-view h-full overflow-auto p-3">
    <EmptyState v-if="!diff?.patch" :title="$t('workspace.noDiff')" :icon="GitBranch" />
    <pre
      v-else
      class="whitespace-pre-wrap font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)]"
      v-text="diff.patch"
    />
  </div>
</template>
