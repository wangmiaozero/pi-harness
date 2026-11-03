<script setup lang="ts">
import { computed } from 'vue'
import { FolderSearch } from '@lucide/vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import UnifiedDiffPreview from '@renderer/components/git/UnifiedDiffPreview.vue'
const workspace = useWorkspaceStore()
const selected = computed(
  () =>
    workspace.changePreview?.files.find(
      (file) => file.path === workspace.changePreview?.selectedPath
    ) ?? workspace.changePreview?.files[0]
)
</script>
<template>
  <section class="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="run-changes-preview">
    <div class="flex flex-wrap gap-1 border-b border-[var(--border-subtle)] p-2">
      <button
        v-for="file in workspace.changePreview?.files"
        :key="file.path"
        type="button"
        class="min-w-0 max-w-full rounded-md px-2 py-1 text-left text-xs hover:bg-[var(--bg-hover)]"
        :class="{ 'bg-[var(--accent-tint)]': selected?.path === file.path }"
        :aria-pressed="selected?.path === file.path"
        @click="workspace.changePreview = { ...workspace.changePreview!, selectedPath: file.path }"
      >
        <span class="break-all">{{ file.displayPath }}</span>
        <span class="ml-2 text-[var(--success)]">+{{ file.additions }}</span
        ><span class="ml-1 text-[var(--danger)]">-{{ file.deletions }}</span>
      </button>
    </div>
    <div
      v-if="selected"
      class="flex min-w-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-xs"
    >
      <span class="min-w-0 truncate" :title="selected.path">{{ selected.displayPath }}</span>
      <button
        type="button"
        data-testid="changes-reveal-file"
        :disabled="!workspace.folderForPath(selected.path)"
        :aria-label="$t('workspace.revealFile')"
        :title="$t('workspace.revealFile')"
        class="shrink-0 rounded p-1 hover:bg-[var(--bg-hover)] disabled:opacity-40"
        @click="workspace.revealFileInTree(selected.path)"
      >
        <FolderSearch class="size-4" />
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto">
      <UnifiedDiffPreview v-if="selected?.patch" :patch="selected.patch" />
      <p v-else class="p-4 text-xs text-[var(--text-tertiary)]">{{ $t('workspace.noDiff') }}</p>
    </div>
  </section>
</template>
