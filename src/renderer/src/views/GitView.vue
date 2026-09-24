<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FolderOpen, GitBranch } from '@lucide/vue'
import { toast } from 'vue-sonner'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import GitSidebar from '@renderer/components/git/GitSidebar.vue'
import GitWorkspaceView from '@renderer/components/git/GitWorkspaceView.vue'
import GitCommitPanel from '@renderer/components/git/GitCommitPanel.vue'
import GitCommitDetailsDrawer from '@renderer/components/git/GitCommitDetailsDrawer.vue'
import { callApi, getApi, getErrorMessage } from '@renderer/composables/useApi'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useSettingsStore } from '@renderer/stores/settings'
import type {
  GitCommitDetails,
  GitCommitFileInfo,
  GitCommitInfo,
  GitFileStatus
} from '@shared/types/workspace'

/**
 * The Git page, laid out like the reference app's RepoView: a sidebar, a
 * graph, and a commit panel. The two right-hand surfaces — the commit panel
 * and the selected commit's details — and the graph and its drawers are
 * stacked with overlays, never swapped: swapping takes panes out of the
 * tree, and their scroll positions and dragged widths come off with them.
 */
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const settings = useSettingsStore()
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let unsubWorkspaceChanged: (() => void) | null = null

const hasProjects = computed(() => workspace.sessionProjectGroups.length > 0)

// --- Commit review (right pane overlay) -----------------------------------
const selectedHash = ref<string | null>(null)
const selectedDetails = ref<GitCommitDetails | null>(null)
const detailsLoading = ref(false)
let detailsRequest = 0

// --- Historical file diff (graph pane overlay) ----------------------------
const commitFile = ref<GitCommitFileInfo | null>(null)
const commitPatch = ref('')
const commitDiffLoading = ref(false)
const commitDiffCommitHash = ref<string | null>(null)
let patchRequest = 0

// --- Working-tree file diff (graph pane overlay) ---------------------------
const workingFile = ref<GitFileStatus | null>(null)
const workingPatch = ref('')
const workingLoading = ref(false)
let workingRequest = 0

// --- File history (graph pane overlay) --------------------------------------
const historyFile = ref<string | null>(null)
const historyCommits = ref<GitCommitInfo[]>([])
const historyListLoading = ref(false)
let historyListRequest = 0

const repository = computed(() => workspace.gitStatus?.repositoryRoot ?? null)
const workspaceView = ref<InstanceType<typeof GitWorkspaceView> | null>(null)

// --- Pane widths: both side panes are drag-resizable -----------------------
const SIDEBAR_DEFAULT = 256
const PANEL_DEFAULT = 320
const sidebarWidth = ref(SIDEBAR_DEFAULT)
const panelWidth = ref(PANEL_DEFAULT)
const resizing = ref<'sidebar' | 'panel' | null>(null)

function clampWidth(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)))
}

function startResize(side: 'sidebar' | 'panel', event: PointerEvent) {
  if (event.button !== 0) return
  const startX = event.clientX
  const startSidebar = sidebarWidth.value
  const startPanel = panelWidth.value
  resizing.value = side
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)

  const onMove = (move: PointerEvent) => {
    const delta = move.clientX - startX
    if (side === 'sidebar') {
      sidebarWidth.value = clampWidth(startSidebar + delta, 200, 460)
    } else {
      panelWidth.value = clampWidth(startPanel - delta, 260, 560)
    }
  }
  const onUp = () => {
    resizing.value = null
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onUp)
  }
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', onUp)
  event.preventDefault()
}

function resetSidebarWidth() {
  sidebarWidth.value = SIDEBAR_DEFAULT
}

function resetPanelWidth() {
  panelWidth.value = PANEL_DEFAULT
}

function scheduleGitRefresh() {
  if (document.visibilityState === 'hidden') return
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void workspace.loadGit()
  }, 240)
}

async function selectCommit(hash: string | null) {
  selectedHash.value = hash
  const request = ++detailsRequest
  const cwd = repository.value
  selectedDetails.value = null
  commitFile.value = null
  commitPatch.value = ''
  if (!cwd || !hash) return
  detailsLoading.value = true
  try {
    const details = await callApi(() => getApi().git.commitDetails(cwd, hash))
    if (request !== detailsRequest || repository.value !== cwd || selectedHash.value !== hash)
      return
    selectedDetails.value = details
  } catch (error) {
    if (request !== detailsRequest || repository.value !== cwd) return
    toast.error(getErrorMessage(error))
  } finally {
    if (request === detailsRequest) detailsLoading.value = false
  }
}

async function openCommit(commit: GitCommitInfo) {
  await selectCommit(commit.hash)
}

function closeCommitDiff() {
  commitFile.value = null
  commitPatch.value = ''
  commitDiffLoading.value = false
  patchRequest += 1
}

async function openCommitFile(file: GitCommitFileInfo) {
  const request = ++patchRequest
  const cwd = repository.value
  const details = selectedDetails.value
  if (!cwd || !details) return
  commitFile.value = file
  commitDiffCommitHash.value = details.hash
  commitPatch.value = ''
  commitDiffLoading.value = true
  try {
    const result = await callApi(() => getApi().git.commitDiff(cwd, details.hash, file.path))
    if (
      request === patchRequest &&
      repository.value === cwd &&
      selectedDetails.value?.hash === details.hash &&
      commitFile.value?.path === file.path
    ) {
      commitPatch.value = result.patch
    }
  } catch (error) {
    if (request !== patchRequest || repository.value !== cwd) return
    toast.error(getErrorMessage(error))
  } finally {
    if (request === patchRequest) commitDiffLoading.value = false
  }
}

async function openWorkingFile(file: GitFileStatus) {
  const request = ++workingRequest
  const cwd = repository.value
  if (!cwd) return
  workingFile.value = file
  workingPatch.value = ''
  workingLoading.value = true
  try {
    const result = await callApi(() => getApi().git.diff(cwd, file.filePath))
    if (request === workingRequest && repository.value === cwd) {
      workingPatch.value = result.patch ?? ''
    }
  } catch (error) {
    if (request !== workingRequest || repository.value !== cwd) return
    toast.error(getErrorMessage(error))
  } finally {
    if (request === workingRequest) workingLoading.value = false
  }
}

function closeWorkingDiff() {
  workingFile.value = null
  workingPatch.value = ''
  workingLoading.value = false
  workingRequest += 1
}

function closeFileHistory() {
  historyFile.value = null
  historyCommits.value = []
  historyListRequest += 1
}

async function openFileHistory(filePath: string) {
  const request = ++historyListRequest
  const cwd = repository.value
  if (!cwd) return
  historyFile.value = filePath
  historyCommits.value = []
  historyListLoading.value = true
  try {
    const commits = await callApi(() => getApi().git.fileHistory(cwd, filePath, 100))
    if (request !== historyListRequest || repository.value !== cwd) return
    historyCommits.value = commits
  } catch (error) {
    if (request !== historyListRequest || repository.value !== cwd) return
    toast.error(getErrorMessage(error))
  } finally {
    if (request === historyListRequest) historyListLoading.value = false
  }
}

onMounted(() => {
  void (async () => {
    await sessions.refresh()
    await workspace.restore({
      restoreTabs: settings.settings?.restoreTabs !== false,
      autoOpenLastProject: settings.settings?.autoOpenLastProject !== false
    })
    await workspace.loadGit()
  })()
  window.addEventListener('focus', scheduleGitRefresh)
  document.addEventListener('visibilitychange', scheduleGitRefresh)
  unsubWorkspaceChanged = getApi().on('workspace-changed', scheduleGitRefresh)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  unsubWorkspaceChanged?.()
  window.removeEventListener('focus', scheduleGitRefresh)
  document.removeEventListener('visibilitychange', scheduleGitRefresh)
})

// Projects added or removed in the Workspace appear and disappear here too.
watch(
  () => workspace.gitRoots,
  () => {
    void workspace.loadGit()
  }
)

// A repository switch invalidates every open drawer.
watch(repository, () => {
  void selectCommit(null)
  closeCommitDiff()
  closeWorkingDiff()
  closeFileHistory()
})
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0" data-testid="git-view">
    <div
      v-if="!hasProjects"
      data-testid="git-no-projects"
      class="flex min-h-0 flex-1 items-center justify-center"
    >
      <EmptyState
        :title="$t('workspace.gitNoProjectsTitle')"
        :description="$t('workspace.gitNoProjectsHint')"
        :icon="FolderOpen"
      />
    </div>
    <template v-else>
      <GitSidebar
        class="shrink-0 border-r border-[var(--border-subtle)]"
        :style="{ width: `${sidebarWidth}px` }"
        @select-ref="workspaceView?.applySidebarRef($event)"
        @locate-commit="workspaceView?.locateCommit($event)"
      />
      <div
        class="pane-resizer"
        :class="resizing === 'sidebar' ? 'pane-resizer--active' : ''"
        role="separator"
        :aria-label="$t('workspace.gitSidebarWidth')"
        :title="$t('common.reset')"
        @pointerdown="startResize('sidebar', $event)"
        @dblclick="resetSidebarWidth"
      />

      <GitWorkspaceView
        v-if="workspace.gitStatus?.isGitRepository"
        ref="workspaceView"
        class="min-h-0 min-w-0 flex-1"
        :selected-hash="selectedHash"
        :working-file="workingFile"
        :working-patch="workingPatch"
        :working-loading="workingLoading"
        :commit-file="commitFile"
        :commit-patch="commitPatch"
        :commit-loading="commitDiffLoading"
        :commit-hash="commitDiffCommitHash"
        :history-file="historyFile"
        :history-commits="historyCommits"
        :file-history-loading="historyListLoading"
        @select-commit="selectCommit"
        @open-commit="openCommit"
        @close-working-diff="closeWorkingDiff"
        @close-commit-diff="closeCommitDiff"
        @close-file-history="closeFileHistory"
      />
      <div v-else class="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          :title="$t('workspace.notGit')"
          :description="$t('workspace.gitNoRepositoryHint')"
          :icon="GitBranch"
        />
      </div>

      <div
        v-if="workspace.gitStatus?.isGitRepository"
        class="pane-resizer"
        :class="resizing === 'panel' ? 'pane-resizer--active' : ''"
        role="separator"
        :aria-label="$t('workspace.gitPanelWidth')"
        :title="$t('common.reset')"
        @pointerdown="startResize('panel', $event)"
        @dblclick="resetPanelWidth"
      />

      <!-- Right pane: the commit panel, with the selected commit's details
           OVER it (absolute, not swapped) so the panel keeps its layout. -->
      <aside
        v-if="workspace.gitStatus?.isGitRepository"
        class="relative flex min-h-0 shrink-0 flex-col border-l border-[var(--border-subtle)]"
        :style="{ width: `${panelWidth}px` }"
      >
        <GitCommitPanel @open-file="openWorkingFile" @file-history="openFileHistory" />
        <GitCommitDetailsDrawer
          v-if="selectedDetails"
          :details="selectedDetails"
          :loading="detailsLoading"
          :selected-file="commitFile"
          @close="selectCommit(null)"
          @open-file="openCommitFile"
          @file-history="openFileHistory"
        />
      </aside>
    </template>
  </div>
</template>

<style scoped>
.pane-resizer {
  position: relative;
  z-index: 10;
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  transition: background-color 0.15s ease;
  touch-action: none;
}

.pane-resizer::after {
  content: '';
  position: absolute;
  inset: 0 2px;
  border-radius: 2px;
}

.pane-resizer:hover,
.pane-resizer--active {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
</style>
