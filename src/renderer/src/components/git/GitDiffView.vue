<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'
import type { GitFileDiffResponse } from '@shared/types/workspace'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { GitBranch } from '@lucide/vue'
import UnifiedDiffPreview from './UnifiedDiffPreview.vue'

const workspace = useWorkspaceStore()
const diff = ref<GitFileDiffResponse | null>(null)
const loading = ref(false)
const filePath = computed(() => workspace.activeTab?.filePath ?? null)
const snapshotPatch = computed(() => workspace.activeDiffPreview)

watch(
  [filePath, () => workspace.contentRevision, snapshotPatch],
  async ([path, _revision, savedPatch]) => {
    diff.value = null
    loading.value = false
    if (!path) return
    if (savedPatch !== null) {
      diff.value = { supported: true, patch: savedPatch }
      return
    }
    const cwd =
      workspace.folderForPath(path)?.resolvedPath ??
      workspace.gitFolderForPath(path)?.resolvedPath ??
      workspace.currentCwd
    if (!cwd) return
    loading.value = true
    try {
      diff.value = await callApi(() => getApi().git.diff(cwd, path))
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="git-diff-view flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-surface)]">
    <div
      v-if="loading"
      class="flex h-full items-center justify-center text-[11px] text-[var(--text-tertiary)]"
    >
      {{ $t('common.loading') }}
    </div>
    <EmptyState v-else-if="!diff?.patch" :title="$t('workspace.noDiff')" :icon="GitBranch" />
    <UnifiedDiffPreview v-else :patch="diff.patch" />
  </div>
</template>
