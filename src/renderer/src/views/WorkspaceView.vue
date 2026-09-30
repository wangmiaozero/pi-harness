<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import WorkspaceSidebar from '@renderer/components/workspace/WorkspaceSidebar.vue'
import WorkspaceTabs from '@renderer/components/workspace/WorkspaceTabs.vue'
import ChatWindow from '@renderer/components/chat/ChatWindow.vue'
import WorkspaceFilesPanel from '@renderer/components/workspace/WorkspaceFilesPanel.vue'
import PortraitSkinPanel from '@renderer/components/layout/PortraitSkinPanel.vue'
import MingWorkspaceOrnaments from '@renderer/components/layout/MingWorkspaceOrnaments.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import GitDiffView from '@renderer/components/git/GitDiffView.vue'
import HarnessConsole from '@renderer/features/harness/HarnessConsole.vue'
import OrchestrationConsole from '@renderer/features/orchestration/OrchestrationConsole.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { FolderOpen, PanelLeftClose, PanelLeftOpen } from '@lucide/vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useAgentStore } from '@renderer/stores/agent'
import { useCompactionStore } from '@renderer/stores/compaction'
import { useSettingsStore } from '@renderer/stores/settings'
import { useHarnessStore } from '@renderer/stores/harness'
import { registerShortcut } from '@renderer/composables/shortcuts'
import { getApi } from '@renderer/composables/useApi'
import type { RecentWorkspace } from '@shared/types/workspace'
import { getActiveVisualSkin } from '@renderer/utils/visual-skin'
import { isMingDynastySkin } from '@renderer/utils/skin-catalog'

const WORKSPACE_SIDEBAR_MIN_WIDTH = 220
const WORKSPACE_SIDEBAR_MAX_WIDTH = 480
const WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY = 'pi-harness.workspace-sidebar-width.v1'
const WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY = 'pi-harness.workspace-sidebar-collapsed.v1'

const { t } = useI18n()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const settings = useSettingsStore()
const harness = useHarnessStore()
const workspaceSidebar = ref<InstanceType<typeof WorkspaceSidebar> | null>(null)
const chatWindow = ref<InstanceType<typeof ChatWindow> | null>(null)
const workspaceTabs = ref<InstanceType<typeof WorkspaceTabs> | null>(null)
const filesPanel = ref<InstanceType<typeof WorkspaceFilesPanel> | null>(null)
type WorkspaceSection = 'workspace' | 'harness' | 'orchestration'

const activeWorkspaceSection = ref<WorkspaceSection>('workspace')
const workspaceViewElement = ref<HTMLElement | null>(null)
const workspaceSidebarCollapsed = ref(readStoredSidebarCollapsed())
const workspaceSidebarWidth = ref<number | null>(readStoredSidebarWidth())
const workspaceSidebarResizing = ref(false)
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let unsubWorkspaceChanged: (() => void) | null = null
let sessionSwitchQueue: Promise<void> = Promise.resolve()
let stopSidebarResize: (() => void) | null = null

const activeKind = computed(() => workspace.activeTab?.kind ?? 'chat')
const visibleMainTabs = computed(() => workspace.mainTabs.filter((tab) => tab.kind !== 'chat'))
const activeVisualSkin = computed(() => getActiveVisualSkin(settings.settings))
const portraitSkinActive = computed(() => activeVisualSkin.value?.portrait === true)
const mingDynastyActive = computed(() => isMingDynastySkin(activeVisualSkin.value?.id))
const zhangJuzhengActive = computed(() => activeVisualSkin.value?.id === 'zhang-juzheng-snow')
const workspaceSidebarMinWidth = computed(() => {
  switch (activeVisualSkin.value?.id) {
    case 'zhang-juzheng-snow':
      return 310
    case 'ming-snow':
    case 'ming-moon':
      return 390
    case 'starship-cockpit':
      return 280
    default:
      return WORKSPACE_SIDEBAR_MIN_WIDTH
  }
})
const workspaceSidebarDefaultWidth = computed(() => {
  switch (activeVisualSkin.value?.id) {
    case 'zhang-juzheng-snow':
      return 310
    case 'ming-snow':
    case 'ming-moon':
      return 390
    case 'starship-cockpit':
      return 320
    default:
      return 260
  }
})
const workspaceSidebarEffectiveWidth = computed(() =>
  clampWorkspaceSidebarWidthForActiveTheme(
    workspaceSidebarWidth.value ?? workspaceSidebarDefaultWidth.value
  )
)
const workspaceSidebarStyle = computed(() =>
  workspaceSidebarWidth.value === null
    ? undefined
    : { width: `${workspaceSidebarEffectiveWidth.value}px` }
)
const workspaceViewStyle = computed<Record<string, string>>(() => ({
  '--workspace-sidebar-current-width': workspaceSidebarCollapsed.value
    ? '0px'
    : `${workspaceSidebarEffectiveWidth.value}px`
}))

function clampWorkspaceSidebarWidth(width: number): number {
  return Math.round(
    Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, width))
  )
}

function clampWorkspaceSidebarWidthForActiveTheme(width: number): number {
  return Math.round(
    Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, Math.max(workspaceSidebarMinWidth.value, width))
  )
}

function readStoredSidebarWidth(): number | null {
  try {
    const stored = Number.parseFloat(
      localStorage.getItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY) ?? ''
    )
    return Number.isFinite(stored) ? clampWorkspaceSidebarWidth(stored) : null
  } catch {
    return null
  }
}

function readStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function persistSidebarWidth(): void {
  try {
    if (workspaceSidebarWidth.value === null) {
      localStorage.removeItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY)
    } else {
      localStorage.setItem(WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY, String(workspaceSidebarWidth.value))
    }
  } catch {
    // Renderer storage can be unavailable in restricted environments.
  }
}

function persistSidebarCollapsed(): void {
  try {
    localStorage.setItem(
      WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(workspaceSidebarCollapsed.value)
    )
  } catch {
    // Renderer storage can be unavailable in restricted environments.
  }
}

function currentWorkspaceSidebarWidth(): number {
  const sidebar = workspaceViewElement.value?.querySelector<HTMLElement>(
    '[data-testid="workspace-sidebar"]'
  )
  return clampWorkspaceSidebarWidthForActiveTheme(
    workspaceSidebarWidth.value ??
      sidebar?.getBoundingClientRect().width ??
      workspaceSidebarDefaultWidth.value
  )
}

function setWorkspaceSidebarWidth(width: number): void {
  workspaceSidebarWidth.value = clampWorkspaceSidebarWidthForActiveTheme(width)
}

function startWorkspaceSidebarResize(event: PointerEvent): void {
  if (event.button !== 0 || workspaceSidebarCollapsed.value) return
  stopSidebarResize?.()

  const target = event.currentTarget as HTMLElement
  const pointerId = event.pointerId
  const startX = event.clientX
  const startWidth = currentWorkspaceSidebarWidth()
  workspaceSidebarResizing.value = true
  target.setPointerCapture(pointerId)

  const cleanup = () => {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', finish)
    target.removeEventListener('pointercancel', finish)
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
    workspaceSidebarResizing.value = false
    stopSidebarResize = null
  }
  const onMove = (moveEvent: PointerEvent) => {
    setWorkspaceSidebarWidth(startWidth + moveEvent.clientX - startX)
  }
  const finish = () => {
    cleanup()
    persistSidebarWidth()
  }

  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', finish)
  target.addEventListener('pointercancel', finish)
  stopSidebarResize = cleanup
  event.preventDefault()
}

function resetWorkspaceSidebarWidth(): void {
  workspaceSidebarWidth.value = null
  persistSidebarWidth()
}

function toggleWorkspaceSidebar(): void {
  workspaceSidebarCollapsed.value = !workspaceSidebarCollapsed.value
  persistSidebarCollapsed()
}

function onWorkspaceSidebarResizeKeydown(event: KeyboardEvent): void {
  if (workspaceSidebarCollapsed.value) return
  let width = currentWorkspaceSidebarWidth()
  if (event.key === 'ArrowLeft') width -= 16
  else if (event.key === 'ArrowRight') width += 16
  else if (event.key === 'Home') width = WORKSPACE_SIDEBAR_MIN_WIDTH
  else if (event.key === 'End') width = WORKSPACE_SIDEBAR_MAX_WIDTH
  else return
  setWorkspaceSidebarWidth(width)
  persistSidebarWidth()
  event.preventDefault()
}

async function focusComposer() {
  await nextTick()
  chatWindow.value?.focusComposer()
}

async function startNewSession() {
  if (!workspace.canChat) {
    await workspace.ensureDefaultWorkspace(t('workspace.defaultWorkspace'))
  } else if (sessions.currentId) {
    await workspace.startDraftFromActiveWorkspace()
  }
  sessions.selectSession(null)
  workspace.ensureChatTab('new', t('workspace.newSession'))
  void focusComposer()
}

function openProject() {
  void workspaceSidebar.value?.pickProject()
}

function openWorkspace() {
  void workspaceSidebar.value?.openWorkspaceFile()
}

function addFolder() {
  void workspaceSidebar.value?.addFolder()
}

function saveWorkspace() {
  void workspaceSidebar.value?.saveWorkspace()
}

function setWorkspaceSection(section: WorkspaceSection) {
  activeWorkspaceSection.value = section
}

const offNew = registerShortcut({
  id: 'workspace-new-session',
  label: t('workspace.newSession'),
  keys: ['meta+n', 'ctrl+n'],
  run: () => void startNewSession()
})
const offClose = registerShortcut({
  id: 'workspace-close-tab',
  label: t('workspace.closeTab'),
  keys: ['meta+w', 'ctrl+w'],
  run: () => {
    if (['harness', 'orchestration'].includes(activeWorkspaceSection.value)) return
    if (workspace.filePanelOpen && document.activeElement?.closest('#workspace-files-panel')) {
      filesPanel.value?.closeActiveFile()
      return
    }
    if (workspace.activeTabId) void workspaceTabs.value?.requestCloseTab(workspace.activeTabId)
  }
})

function onAbortEvent() {
  if (sessions.currentId) void agent.abort(sessions.currentId)
}

function onCompactEvent() {
  void useCompactionStore().requestSmartCompaction({
    sessionId: sessions.currentId,
    source: 'command-palette'
  })
}

function onOpenFolderEvent() {
  openProject()
}

function onOpenWorkspaceEvent() {
  openWorkspace()
}

function onAddFolderEvent() {
  addFolder()
}

function onSaveWorkspaceEvent() {
  saveWorkspace()
}

function onOpenRecentEvent(event: Event) {
  const item = (event as CustomEvent<RecentWorkspace>).detail
  if (item) openRecent(item)
}

function scheduleContentRefresh() {
  if (document.visibilityState === 'hidden') return
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void workspace.refreshContent()
  }, 120)
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') scheduleContentRefresh()
}

onMounted(() => {
  void (async () => {
    await sessions.refresh()
    await workspace.restore({
      restoreTabs: settings.settings?.restoreTabs !== false,
      autoOpenLastProject: settings.settings?.autoOpenLastProject !== false
    })
    if (!workspace.canChat) {
      await workspace.ensureDefaultWorkspace(t('workspace.defaultWorkspace'))
    }
    if (!workspace.tabs.some((tab) => tab.kind === 'chat')) {
      workspace.ensureChatTab('new', t('workspace.newSession'))
    }
    await Promise.all([workspace.loadFiles(), workspace.loadGit()])
    await workspace.refreshRecent()
  })()
  window.addEventListener('pi-harness:abort-agent', onAbortEvent)
  window.addEventListener('pi-harness:compact-session', onCompactEvent)
  window.addEventListener('pi-harness:workspace-open-folder', onOpenFolderEvent)
  window.addEventListener('pi-harness:workspace-open-file', onOpenWorkspaceEvent)
  window.addEventListener('pi-harness:workspace-add-folder', onAddFolderEvent)
  window.addEventListener('pi-harness:workspace-save', onSaveWorkspaceEvent)
  window.addEventListener('pi-harness:workspace-open-recent', onOpenRecentEvent)
  window.addEventListener('focus', scheduleContentRefresh)
  document.addEventListener('visibilitychange', onVisibilityChange)
  unsubWorkspaceChanged = getApi().on('workspace-changed', () => {
    scheduleContentRefresh()
  })
})

onBeforeUnmount(() => {
  stopSidebarResize?.()
  offNew()
  offClose()
  if (refreshTimer) clearTimeout(refreshTimer)
  unsubWorkspaceChanged?.()
  window.removeEventListener('pi-harness:abort-agent', onAbortEvent)
  window.removeEventListener('pi-harness:compact-session', onCompactEvent)
  window.removeEventListener('pi-harness:workspace-open-folder', onOpenFolderEvent)
  window.removeEventListener('pi-harness:workspace-open-file', onOpenWorkspaceEvent)
  window.removeEventListener('pi-harness:workspace-add-folder', onAddFolderEvent)
  window.removeEventListener('pi-harness:workspace-save', onSaveWorkspaceEvent)
  window.removeEventListener('pi-harness:workspace-open-recent', onOpenRecentEvent)
  window.removeEventListener('focus', scheduleContentRefresh)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

function openRecent(item: RecentWorkspace) {
  void workspaceSidebar.value?.openRecent(item)
}

async function switchSession(id: string | null) {
  if (id && !sessions.items.some((session) => session.id === id)) {
    workspace.pruneUnavailableSessionTabs()
    sessions.selectSession(null)
    await Promise.all([agent.load(null), harness.load(null)])
    return
  }
  if (id) await workspace.restoreSessionWorkspace(id)
  else {
    await workspace.restoreDraftWorkspace()
    if (!workspace.canChat) {
      await workspace.ensureDefaultWorkspace(t('workspace.defaultWorkspace'))
    }
    workspace.ensureChatTab('new', t('workspace.newSession'))
  }
  await agent.load(id)
  await harness.load(id)
  if (id) {
    const session = sessions.current
    workspace.ensureChatTab(id, session?.name || session?.firstMessage?.slice(0, 32) || id)
  }
  await Promise.all([workspace.loadFiles(), workspace.loadGit()])
}

watch(
  () => sessions.currentId,
  (id) => {
    sessionSwitchQueue = sessionSwitchQueue.catch(() => undefined).then(() => switchSession(id))
  }
)

watch(
  () => agent.completionCount,
  (next, previous) => {
    if (next > previous) scheduleContentRefresh()
  }
)
</script>

<template>
  <div
    ref="workspaceViewElement"
    class="workspace-view flex h-full min-h-0"
    :class="[
      workspaceSidebarResizing ? 'workspace-view--resizing' : '',
      workspaceSidebarCollapsed ? 'workspace-view--sidebar-collapsed' : ''
    ]"
    :style="workspaceViewStyle"
  >
    <WorkspaceSidebar
      v-show="!workspaceSidebarCollapsed"
      id="workspace-project-sidebar"
      ref="workspaceSidebar"
      :style="workspaceSidebarStyle"
      :active-section="activeWorkspaceSection"
      @focus-composer="focusComposer"
      @section-change="setWorkspaceSection"
    />
    <div
      class="workspace-sidebar-divider"
      :class="[
        workspaceSidebarResizing ? 'workspace-sidebar-divider--active' : '',
        workspaceSidebarCollapsed ? 'workspace-sidebar-divider--collapsed' : ''
      ]"
    >
      <div
        class="workspace-sidebar-resizer"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="$t('workspace.resizeSidebar')"
        :aria-valuemin="workspaceSidebarMinWidth"
        :aria-valuemax="WORKSPACE_SIDEBAR_MAX_WIDTH"
        :aria-valuenow="workspaceSidebarCollapsed ? undefined : currentWorkspaceSidebarWidth()"
        :aria-disabled="workspaceSidebarCollapsed"
        :title="$t('common.reset')"
        data-testid="workspace-sidebar-resizer"
        @pointerdown="startWorkspaceSidebarResize"
        @dblclick="resetWorkspaceSidebarWidth"
        @keydown="onWorkspaceSidebarResizeKeydown"
      />
      <button
        type="button"
        class="workspace-sidebar-toggle"
        :aria-label="
          workspaceSidebarCollapsed
            ? $t('workspace.expandSidebar')
            : $t('workspace.collapseSidebar')
        "
        :title="
          workspaceSidebarCollapsed
            ? $t('workspace.expandSidebar')
            : $t('workspace.collapseSidebar')
        "
        :aria-expanded="!workspaceSidebarCollapsed"
        aria-controls="workspace-project-sidebar"
        data-testid="workspace-sidebar-toggle"
        @pointerdown.stop
        @click="toggleWorkspaceSidebar"
      >
        <PanelLeftOpen v-if="workspaceSidebarCollapsed" aria-hidden="true" />
        <PanelLeftClose v-else aria-hidden="true" />
      </button>
    </div>
    <section
      data-testid="workspace-main"
      class="workspace-main flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <HarnessConsole v-if="activeWorkspaceSection === 'harness'" />
      <OrchestrationConsole v-else-if="activeWorkspaceSection === 'orchestration'" />
      <template v-else>
        <MingWorkspaceOrnaments
          v-if="mingDynastyActive && !workspace.filePanelOpen"
          :zhang-juzheng="zhangJuzhengActive"
        />
        <div
          class="workspace-tabbar flex h-[var(--height-page-header)] min-w-0 shrink-0 items-center"
        >
          <WorkspaceTabs
            v-if="visibleMainTabs.length"
            ref="workspaceTabs"
            @focus-composer="focusComposer"
          />
          <div
            class="ml-auto flex h-full shrink-0 items-center border-b border-[var(--border-subtle)] px-2"
          >
            <IconButton
              :label="$t('workspace.files')"
              :active="workspace.filePanelOpen"
              show-label
              :aria-expanded="workspace.filePanelOpen"
              aria-controls="workspace-files-panel"
              data-testid="workspace-toggle-files"
              @click="workspace.filePanelOpen = !workspace.filePanelOpen"
            >
              <FolderOpen class="size-3.5" :stroke-width="1.75" />
            </IconButton>
          </div>
        </div>
        <div
          data-testid="workspace-scene"
          class="workspace-content flex min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          <PortraitSkinPanel
            v-if="portraitSkinActive && settings.settings && !workspace.filePanelOpen"
            :style="settings.settings.mascotStyle"
            :custom-skin="activeVisualSkin?.custom"
            :show-status="settings.settings.petStatusText"
          />
          <div class="workspace-primary min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              v-if="!workspace.canChat"
              data-testid="workspace-project-required"
              class="flex h-full min-h-0 items-center justify-center"
            >
              <EmptyState
                :title="$t('workspace.projectRequired')"
                :description="$t('workspace.projectRequiredHint')"
                :icon="FolderOpen"
              >
                <button
                  type="button"
                  class="mt-3 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-tint-strong)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] active:bg-[var(--bg-selected)]"
                  @click="openProject"
                >
                  {{ $t('workspace.openProject') }}
                </button>
                <button
                  type="button"
                  class="mt-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                  @click="openWorkspace"
                >
                  {{ $t('workspace.openWorkspace') }}
                </button>
                <p
                  v-if="workspace.recentWorkspaces.length"
                  class="mt-4 text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
                >
                  {{ $t('workspace.recentWorkspaces') }}
                </p>
                <button
                  v-for="item in workspace.recentWorkspaces.slice(0, 8)"
                  :key="item.id"
                  type="button"
                  class="mt-1 max-w-[280px] truncate rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  @click="openRecent(item)"
                >
                  {{ item.name || item.workspaceFile || item.folderPaths[0] }}
                </button>
              </EmptyState>
            </div>
            <div v-else class="h-full min-h-0 overflow-hidden">
              <ChatWindow v-if="activeKind === 'chat'" ref="chatWindow" />
              <GitDiffView v-else-if="activeKind === 'diff'" />
            </div>
          </div>
          <WorkspaceFilesPanel v-if="workspace.filePanelOpen" ref="filesPanel" />
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.workspace-main {
  container-type: inline-size;
}

.workspace-view {
  position: relative;
  isolation: isolate;
}

.workspace-sidebar-divider {
  position: relative;
  z-index: 40;
  width: 7px;
  flex: 0 0 7px;
  background: color-mix(in srgb, var(--bg-sidebar) 86%, transparent);
}

.workspace-sidebar-resizer {
  position: absolute;
  inset: 0;
  cursor: col-resize;
  touch-action: none;
}

.workspace-sidebar-resizer::before {
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

.workspace-sidebar-divider:hover .workspace-sidebar-resizer::before,
.workspace-sidebar-divider--active .workspace-sidebar-resizer::before,
.workspace-sidebar-resizer:focus-visible::before {
  width: 2px;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-tint-strong);
}

.workspace-sidebar-resizer:focus-visible {
  outline: none;
}

.workspace-sidebar-toggle {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  display: grid;
  width: 22px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-surface-raised);
  box-shadow: var(--shadow-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transform: translate(-50%, -50%);
  transition:
    background-color var(--motion-fast) var(--ease-out),
    color var(--motion-fast) var(--ease-out),
    box-shadow var(--motion-fast) var(--ease-out);
}

.workspace-sidebar-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.workspace-sidebar-toggle:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring), var(--shadow-sm);
}

.workspace-sidebar-toggle svg {
  width: 14px;
  height: 14px;
  stroke-width: 1.75;
}

.workspace-sidebar-divider--collapsed .workspace-sidebar-toggle {
  color: var(--accent);
}

.workspace-view--resizing,
.workspace-view--resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}

:global(:root[data-visual-skin='starship-cockpit']) .workspace-sidebar-divider {
  background: rgb(4 15 34 / 0.88);
}

:global(:root[data-visual-skin='starship-cockpit']) .workspace-sidebar-toggle {
  border-color: rgb(104 220 255 / 0.32);
  background: rgb(5 18 41 / 0.94);
  color: #68dcff;
  box-shadow: 0 0 12px rgb(45 156 240 / 0.24);
}

:global(
    :root:is(
      [data-visual-skin='ming-snow'],
      [data-visual-skin='zhang-juzheng-snow'],
      [data-visual-skin='ming-moon']
    )
  )
  .workspace-sidebar-divider {
  background: var(--ming-lacquer);
}

:global(
    :root:is(
      [data-visual-skin='ming-snow'],
      [data-visual-skin='zhang-juzheng-snow'],
      [data-visual-skin='ming-moon']
    )
  )
  .workspace-sidebar-toggle {
  border-color: var(--ming-gold-soft);
  border-radius: 2px;
  background: var(--ming-lacquer-soft);
  color: #d7b57d;
  box-shadow:
    inset 0 0 0 1px rgb(246 215 167 / 0.08),
    0 3px 8px rgb(0 0 0 / 0.42);
}

/* On narrow windows keep both conversation and files usable, without covering navigation. */
@container (max-width: 720px) {
  .workspace-content:has(.workspace-files-panel) {
    flex-direction: column;
  }
  .workspace-content > .workspace-files-panel {
    flex-basis: 50%;
    border-left: 0;
    border-top: 1px solid var(--border-default);
  }
}
</style>
