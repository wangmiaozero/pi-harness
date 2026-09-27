<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { FileText, FolderOpen, FolderTree, PanelRightClose } from '@lucide/vue'
import FileExplorer from '@renderer/components/files/FileExplorer.vue'
import FileViewer from '@renderer/components/files/FileViewer.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import WorkspaceTabs from './WorkspaceTabs.vue'

const FILES_PANEL_MIN_WIDTH = 360
const FILES_PANEL_MAX_WIDTH = 760
const FILES_PANEL_DEFAULT_WIDTH = 640
const FILES_PANEL_WIDTH_STORAGE_KEY = 'pi-harness.workspace-files-panel-width.v1'

const workspace = useWorkspaceStore()
const sessions = useSessionStore()
const fileTabs = ref<InstanceType<typeof WorkspaceTabs> | null>(null)
const panelElement = ref<HTMLElement | null>(null)
const panelMode = ref<'tree' | 'preview'>(workspace.activeFileTab ? 'preview' : 'tree')
const panelWidth = ref<number | null>(readStoredPanelWidth())
const resizing = ref(false)
let stopResize: (() => void) | null = null

const panelStyle = computed(() =>
  panelWidth.value === null
    ? undefined
    : { '--workspace-files-panel-width': `${panelWidth.value}px` }
)

watch(
  () => workspace.activeFileTab?.id,
  (activeId, previousId) => {
    if (!activeId) panelMode.value = 'tree'
    else if (activeId !== previousId) panelMode.value = 'preview'
  }
)

function clampPanelWidth(width: number): number {
  return Math.round(Math.min(FILES_PANEL_MAX_WIDTH, Math.max(FILES_PANEL_MIN_WIDTH, width)))
}

function readStoredPanelWidth(): number | null {
  try {
    const stored = Number.parseFloat(localStorage.getItem(FILES_PANEL_WIDTH_STORAGE_KEY) ?? '')
    return Number.isFinite(stored) ? clampPanelWidth(stored) : null
  } catch {
    return null
  }
}

function persistPanelWidth(): void {
  try {
    if (panelWidth.value === null) localStorage.removeItem(FILES_PANEL_WIDTH_STORAGE_KEY)
    else localStorage.setItem(FILES_PANEL_WIDTH_STORAGE_KEY, String(panelWidth.value))
  } catch {
    // Renderer storage can be unavailable in restricted environments.
  }
}

function currentPanelWidth(): number {
  return clampPanelWidth(
    panelWidth.value ??
      panelElement.value?.getBoundingClientRect().width ??
      FILES_PANEL_DEFAULT_WIDTH
  )
}

function setPanelWidth(width: number): void {
  panelWidth.value = clampPanelWidth(width)
}

function startResize(event: PointerEvent): void {
  if (event.button !== 0) return
  stopResize?.()

  const target = event.currentTarget as HTMLElement
  const pointerId = event.pointerId
  const startX = event.clientX
  const startWidth = currentPanelWidth()
  resizing.value = true
  target.setPointerCapture(pointerId)

  const cleanup = () => {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', finish)
    target.removeEventListener('pointercancel', finish)
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
    resizing.value = false
    stopResize = null
  }
  const onMove = (moveEvent: PointerEvent) => {
    setPanelWidth(startWidth + startX - moveEvent.clientX)
  }
  const finish = () => {
    cleanup()
    persistPanelWidth()
  }

  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', finish)
  target.addEventListener('pointercancel', finish)
  stopResize = cleanup
  event.preventDefault()
}

function resetPanelWidth(): void {
  panelWidth.value = null
  persistPanelWidth()
}

function onResizeKeydown(event: KeyboardEvent): void {
  let width = currentPanelWidth()
  if (event.key === 'ArrowLeft') width += 16
  else if (event.key === 'ArrowRight') width -= 16
  else if (event.key === 'Home') width = FILES_PANEL_MIN_WIDTH
  else if (event.key === 'End') width = FILES_PANEL_MAX_WIDTH
  else return
  setPanelWidth(width)
  persistPanelWidth()
  event.preventDefault()
}

function closeActiveFile() {
  if (workspace.activeFileTab) void fileTabs.value?.requestCloseTab(workspace.activeFileTab.id)
}

onBeforeUnmount(() => stopResize?.())

defineExpose({ closeActiveFile })
</script>

<template>
  <section
    id="workspace-files-panel"
    ref="panelElement"
    data-testid="workspace-files-panel"
    :aria-label="$t('workspace.files')"
    class="workspace-files-panel flex min-h-0 min-w-0 flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)]"
    :class="resizing ? 'workspace-files-panel--resizing' : ''"
    :style="panelStyle"
  >
    <div
      class="workspace-files-resizer"
      :class="resizing ? 'workspace-files-resizer--active' : ''"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="$t('workspace.resizeFiles')"
      :aria-valuemin="FILES_PANEL_MIN_WIDTH"
      :aria-valuemax="FILES_PANEL_MAX_WIDTH"
      :aria-valuenow="currentPanelWidth()"
      :title="$t('common.reset')"
      data-testid="workspace-files-resizer"
      @pointerdown="startResize"
      @dblclick="resetPanelWidth"
      @keydown="onResizeKeydown"
    />
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
      <div class="flex shrink-0 items-center gap-1">
        <div
          v-if="workspace.hasSessionWorkspace"
          class="flex items-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-sidebar)] p-0.5"
          role="group"
          :aria-label="$t('workspace.filePanelMode')"
        >
          <IconButton
            :label="$t('workspace.fileTreeMode')"
            show-label
            :active="panelMode === 'tree'"
            :aria-pressed="panelMode === 'tree'"
            data-testid="workspace-files-mode-tree"
            @click="panelMode = 'tree'"
          >
            <FolderTree class="size-3.5" :stroke-width="1.75" />
          </IconButton>
          <IconButton
            :label="$t('workspace.filePreviewMode')"
            show-label
            :active="panelMode === 'preview'"
            :disabled="!workspace.activeFileTab"
            :aria-pressed="panelMode === 'preview'"
            data-testid="workspace-files-mode-preview"
            @click="panelMode = 'preview'"
          >
            <FileText class="size-3.5" :stroke-width="1.75" />
          </IconButton>
        </div>
        <IconButton
          :label="$t('workspace.collapseFiles')"
          data-testid="workspace-collapse-files"
          @click="workspace.filePanelOpen = false"
        >
          <PanelRightClose class="size-3.5" :stroke-width="1.75" />
        </IconButton>
      </div>
    </header>
    <template v-if="workspace.hasSessionWorkspace">
      <div
        v-if="panelMode === 'tree'"
        data-testid="workspace-file-tree"
        class="file-panel-tree min-h-0 flex-1 overflow-auto"
      >
        <FileExplorer :key="sessions.currentId!" />
      </div>
      <div
        v-else
        data-testid="workspace-file-preview-pane"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <WorkspaceTabs ref="fileTabs" scope="files" />
        <div class="min-h-0 flex-1 overflow-hidden">
          <FileViewer :key="sessions.currentId!" />
        </div>
      </div>
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
  position: relative;
  flex: 0 0 var(--workspace-files-panel-width, clamp(360px, 48%, 760px));
  max-width: 760px;
}

.workspace-files-resizer {
  position: absolute;
  z-index: 30;
  top: 0;
  bottom: 0;
  left: -4px;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}

.workspace-files-resizer::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: var(--border-default);
  content: '';
  transition:
    width var(--motion-fast) var(--ease-out),
    background-color var(--motion-fast) var(--ease-out),
    box-shadow var(--motion-fast) var(--ease-out);
}

.workspace-files-resizer:hover::after,
.workspace-files-resizer--active::after,
.workspace-files-resizer:focus-visible::after {
  width: 2px;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-tint-strong);
}

.workspace-files-resizer:focus-visible {
  outline: none;
}

.workspace-files-panel--resizing,
.workspace-files-panel--resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}

@container (max-width: 720px) {
  .workspace-files-resizer {
    display: none;
  }
}
</style>
