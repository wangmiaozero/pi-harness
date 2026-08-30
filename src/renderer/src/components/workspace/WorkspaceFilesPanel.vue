<script setup lang="ts">
import { ref } from 'vue'
import { FolderOpen, PanelRightClose } from '@lucide/vue'
import FileExplorer from '@renderer/components/files/FileExplorer.vue'
import FileViewer from '@renderer/components/files/FileViewer.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import WorkspaceTabs from './WorkspaceTabs.vue'

const workspace = useWorkspaceStore()
const sessions = useSessionStore()
const fileTabs = ref<InstanceType<typeof WorkspaceTabs> | null>(null)

function closeActiveFile() {
  if (workspace.activeFileTab) void fileTabs.value?.requestCloseTab(workspace.activeFileTab.id)
}
defineExpose({ closeActiveFile })
</script>

<template>
  <section
    id="workspace-files-panel"
    data-testid="workspace-files-panel"
    :aria-label="$t('workspace.files')"
    class="workspace-files-panel flex min-h-0 min-w-0 flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)]"
  >
    <header
      class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3"
    >
      <span class="flex min-w-0 items-center gap-2 text-[12px] font-medium">
        <FolderOpen class="size-3.5 shrink-0" />
        {{ $t('workspace.files') }}
        <span class="truncate text-[11px] font-normal text-[var(--text-tertiary)]">
          {{ workspace.hasSessionWorkspace ? sessions.current?.name : '' }}
        </span>
      </span>
      <IconButton
        :label="$t('workspace.collapseFiles')"
        data-testid="workspace-collapse-files"
        @click="workspace.filePanelOpen = false"
      >
        <PanelRightClose class="size-3.5" :stroke-width="1.75" />
      </IconButton>
    </header>
    <template v-if="workspace.hasSessionWorkspace">
      <div data-testid="workspace-file-tree" class="file-panel-tree min-h-0 overflow-auto">
        <FileExplorer :key="sessions.currentId!" />
      </div>
      <template v-if="workspace.activeFileTab">
        <WorkspaceTabs ref="fileTabs" scope="files" />
        <div class="min-h-0 flex-1 overflow-hidden">
          <FileViewer :key="sessions.currentId!" />
        </div>
      </template>
    </template>
    <div v-else data-testid="workspace-files-unavailable">
      <EmptyState
        :title="$t('workspace.noFile')"
        :description="$t('workspace.filesRequireSession')"
        :icon="FolderOpen"
      />
    </div>
  </section>
</template>

<style scoped>
.workspace-files-panel {
  flex: 0 0 clamp(360px, 48%, 760px);
}
.file-panel-tree {
  flex: 1 1 auto;
}
.file-panel-tree:has(+ [data-testid='workspace-file-tabs']) {
  flex: 0 1 30%;
  min-height: 120px;
  border-bottom: 1px solid var(--border-subtle);
}
</style>
