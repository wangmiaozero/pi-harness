<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onBeforeUnmount,
  onActivated,
  onDeactivated,
  provide,
  ref,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import WorkspaceSidebar from '@renderer/components/workspace/WorkspaceSidebar.vue'
import WorkspaceTabs from '@renderer/components/workspace/WorkspaceTabs.vue'
import ChatWindow from '@renderer/components/chat/ChatWindow.vue'
import WorkspaceFilesPanel from '@renderer/components/workspace/WorkspaceFilesPanel.vue'
import PortraitSkinPanel from '@renderer/components/layout/PortraitSkinPanel.vue'
import MingWorkspaceOrnaments from '@renderer/components/layout/MingWorkspaceOrnaments.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import GitDiffView from '@renderer/components/git/GitDiffView.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { FolderOpen, Network, Gauge, Bot } from '@lucide/vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useAgentStore } from '@renderer/stores/agent'
import { useSettingsStore } from '@renderer/stores/settings'
import { useHarnessStore } from '@renderer/stores/harness'
import { registerShortcut } from '@renderer/composables/shortcuts'
import { getApi } from '@renderer/composables/useApi'
import { CHAT_VIEW_ACTIVE } from '@renderer/composables/chat-view-activity'
import { useWorkspaceSidebarState } from '@renderer/composables/useWorkspaceSidebarState'
import type { RecentWorkspace } from '@shared/types/workspace'
import { getActiveVisualSkin } from '@renderer/utils/visual-skin'
import { isMingDynastySkin } from '@renderer/utils/skin-catalog'

const ProjectIntelligencePanel = defineAsyncComponent(
  () => import('@renderer/components/workspace/ProjectIntelligencePanel.vue')
)
const HarnessConsole = defineAsyncComponent(
  () => import('@renderer/features/harness/HarnessConsole.vue')
)
const OrchestrationConsole = defineAsyncComponent(
  () => import('@renderer/features/orchestration/OrchestrationConsole.vue')
)

const WORKSPACE_SIDEBAR_MIN_WIDTH = 220
const WORKSPACE_SIDEBAR_MAX_WIDTH = 480
const WORKSPACE_SIDEBAR_WIDTH_STORAGE_KEY = 'pi-harness.workspace-sidebar-width.v1'

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
const architectureOpen = ref(false)
const architectureProject = ref<string | null>(null)
const architectureRoot = computed(
  () =>
    architectureProject.value ??
    (workspace.currentCwd &&
    (workspace.hasSessionWorkspace ||
      workspace.importedProjectRoots.includes(workspace.currentCwd)) &&
    !workspace.isDefaultWorkspace(workspace.currentCwd)
      ? workspace.currentCwd
      : (workspace.importedProjectRoots[0] ?? null))
)
watch(
  () => workspace.currentCwd,
  () => {
    architectureProject.value = null
  }
)
async function explainArchitecture(moduleId?: string): Promise<void> {
  const root = architectureRoot.value
  if (!root) return
  if (workspace.currentCwd !== root) {
    sessions.selectSession(null)
    await workspace.resetDraftWorkspaceRoots(workspace.projectSourceRoots(root))
    workspace.ensureChatTab('new', t('workspace.newSession'))
  }
  const prompt = t('intelligence.explainPrompt', { moduleId: moduleId ?? '' })
  workspace.draft = workspace.draft.trim() ? `${workspace.draft}\n\n${prompt}` : prompt
  architectureOpen.value = false
  void nextTick(() => chatWindow.value?.focusComposer())
}
type WorkspaceSection = 'workspace' | 'tools'

const route = useRoute()
const activeWorkspaceSection = ref<WorkspaceSection>(
  route.query.tool === 'orchestration' ? 'tools' : 'workspace'
)
const activeTool = ref<'harness' | 'orchestration'>(
  route.query.tool === 'orchestration' ? 'orchestration' : 'harness'
)
const workspaceViewElement = ref<HTMLElement | null>(null)
const { collapsed: workspaceSidebarCollapsed } = useWorkspaceSidebarState()
const workspaceSidebarWidth = ref<number | null>(readStoredSidebarWidth())
const workspaceSidebarResizing = ref(false)
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let unsubWorkspaceChanged: (() => void) | null = null
let sessionSwitchQueue: Promise<void> = Promise.resolve()
let sessionSwitchSequence = 0
let stopSidebarResize: (() => void) | null = null

const viewActive = ref(true)
let initialized = false
let inactiveSessionId: string | null = null
let inactiveModified: string | undefined
const chatActive = computed(
  () =>
    viewActive.value &&
    activeWorkspaceSection.value === 'workspace' &&
    activeKind.value === 'chat' &&
    !architectureOpen.value
)
provide(CHAT_VIEW_ACTIVE, chatActive)
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

async function focusComposer(owner: Element | null = document.activeElement) {
  await nextTick()
  if (!viewActive.value) return
  if (document.activeElement !== owner && document.activeElement !== document.body) return
  chatWindow.value?.focusComposer()
}

async function startNewSession() {
  const focusOwner = document.activeElement
  if (!workspace.canChat) {
    await workspace.ensureDefaultWorkspace(t('workspace.defaultWorkspace'))
  } else if (sessions.currentId) {
    await workspace.startDraftFromActiveWorkspace()
  }
  sessions.selectSession(null)
  workspace.ensureChatTab('new', t('workspace.newSession'))
  void focusComposer(focusOwner)
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
function onToolTabKeydown(event: KeyboardEvent): void {
  const next =
    event.key === 'Home'
      ? 'harness'
      : event.key === 'End'
        ? 'orchestration'
        : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
          ? activeTool.value === 'harness'
            ? 'orchestration'
            : 'harness'
          : null
  if (!next) return
  event.preventDefault()
  activeTool.value = next
  void nextTick(() => document.getElementById(`workspace-tool-tab-${next}`)?.focus())
}

let offNew: (() => void) | null = null
let offClose: (() => void) | null = null
function installShortcuts() {
  offNew?.()
  offClose?.()
  offNew = registerShortcut({
    id: 'workspace-new-session',
    label: t('workspace.newSession'),
    keys: ['meta+n', 'ctrl+n'],
    run: () => void startNewSession()
  })
  offClose = registerShortcut({
    id: 'workspace-close-tab',
    label: t('workspace.closeTab'),
    keys: ['meta+w', 'ctrl+w'],
    run: () => {
      if (activeWorkspaceSection.value === 'tools') return
      if (workspace.filePanelOpen && document.activeElement?.closest('#workspace-files-panel')) {
        filesPanel.value?.closeActiveFile()
        return
      }
      if (workspace.activeTabId) void workspaceTabs.value?.requestCloseTab(workspace.activeTabId)
    }
  })
}

function onAbortEvent() {
  if (sessions.currentId) void agent.abort(sessions.currentId)
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
  if (!viewActive.value || document.visibilityState === 'hidden') return
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
    await Promise.all([workspace.loadFiles(), workspace.loadGit(), workspace.refreshRecent()])
    initialized = true
  })()
})

function installViewListeners() {
  window.addEventListener('pi-harness:abort-agent', onAbortEvent)
  window.addEventListener('pi-harness:workspace-open-folder', onOpenFolderEvent)
  window.addEventListener('pi-harness:workspace-open-file', onOpenWorkspaceEvent)
  window.addEventListener('pi-harness:workspace-add-folder', onAddFolderEvent)
  window.addEventListener('pi-harness:workspace-save', onSaveWorkspaceEvent)
  window.addEventListener('pi-harness:workspace-open-recent', onOpenRecentEvent)
  window.addEventListener('focus', scheduleContentRefresh)
  document.addEventListener('visibilitychange', onVisibilityChange)
  unsubWorkspaceChanged?.()
  unsubWorkspaceChanged = getApi().on('workspace-changed', scheduleContentRefresh)
}

function stopViewListeners() {
  stopSidebarResize?.()
  offNew?.()
  offClose?.()
  offNew = null
  offClose = null
  if (refreshTimer) clearTimeout(refreshTimer)
  unsubWorkspaceChanged?.()
  unsubWorkspaceChanged = null
  window.removeEventListener('pi-harness:abort-agent', onAbortEvent)
  window.removeEventListener('pi-harness:workspace-open-folder', onOpenFolderEvent)
  window.removeEventListener('pi-harness:workspace-open-file', onOpenWorkspaceEvent)
  window.removeEventListener('pi-harness:workspace-add-folder', onAddFolderEvent)
  window.removeEventListener('pi-harness:workspace-save', onSaveWorkspaceEvent)
  window.removeEventListener('pi-harness:workspace-open-recent', onOpenRecentEvent)
  window.removeEventListener('focus', scheduleContentRefresh)
  document.removeEventListener('visibilitychange', onVisibilityChange)
}

onActivated(() => {
  viewActive.value = true
  installShortcuts()
  installViewListeners()
  if (!initialized) return
  void (async () => {
    await sessions.refresh()
    if (!viewActive.value) return
    if (
      sessions.currentId === inactiveSessionId &&
      sessions.current?.modified !== inactiveModified
    ) {
      const sequence = ++sessionSwitchSequence
      sessionSwitchQueue = sessionSwitchQueue
        .catch(() => undefined)
        .then(() => switchSession(sessions.currentId, sequence))
      await sessionSwitchQueue
    }
    if (viewActive.value) scheduleContentRefresh()
  })()
})
onDeactivated(() => {
  viewActive.value = false
  inactiveSessionId = sessions.currentId
  inactiveModified = sessions.current?.modified
  stopViewListeners()
})
onBeforeUnmount(stopViewListeners)

function openRecent(item: RecentWorkspace) {
  void workspaceSidebar.value?.openRecent(item)
}

async function switchSession(id: string | null, sequence: number) {
  // Rapid selections queue several switches. Only the newest one matters;
  // running a stale switch to completion would re-select an old session at
  // the end and make the UI bounce back and forth between sessions.
  if (sequence !== sessionSwitchSequence) return
  if (id && !sessions.items.some((session) => session.id === id)) {
    workspace.pruneUnavailableSessionTabs()
    sessions.selectSession(null)
    await Promise.all([agent.load(null), harness.load(null)])
    return
  }
  // Session data loads are generation-guarded, so they can overlap the
  // workspace restore; the newest switch still decides the final state.
  const sessionLoads = Promise.all([agent.load(id), harness.load(id)])
  sessionLoads.catch(() => undefined)
  if (id) await workspace.restoreSessionWorkspace(id)
  else {
    await workspace.restoreDraftWorkspace()
    if (!workspace.canChat) {
      await workspace.ensureDefaultWorkspace(t('workspace.defaultWorkspace'))
    }
  }
  if (sequence !== sessionSwitchSequence || sessions.currentId !== id) return
  await sessionLoads
  // A newer selection superseded this queued switch while it was awaiting.
  // Re-activating the stale session here would queue yet another switch and
  // ping-pong forever, so leave the selection alone instead.
  if (sequence !== sessionSwitchSequence || sessions.currentId !== id) return
  if (id) {
    const session = sessions.current
    workspace.ensureChatTab(id, session?.name || session?.firstMessage?.slice(0, 32) || id)
  } else {
    workspace.ensureChatTab('new', t('workspace.newSession'))
  }
  await Promise.all([workspace.loadFiles(), workspace.loadGit()])
}

watch(
  () => sessions.currentId,
  (id, previousId) => {
    // A continuation may already be selected before this route mounts.
    // Initial draft restoration remains owned by onMounted above.
    if (id === null && previousId === undefined) return
    const sequence = ++sessionSwitchSequence
    sessionSwitchQueue = sessionSwitchQueue
      .catch(() => undefined)
      .then(() => switchSession(id, sequence))
  },
  { immediate: true }
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
    <Teleport v-if="viewActive" defer to="#titlebar-workspace-actions">
      <div class="flex items-center gap-1">
        <IconButton
          :label="$t('intelligence.architecture')"
          :active="architectureOpen"
          data-testid="workspace-architecture"
          @click="architectureOpen = !architectureOpen"
        >
          <Network class="size-4" :stroke-width="1.75" />
        </IconButton>
        <IconButton
          :label="$t('workspace.files')"
          :active="workspace.filePanelOpen"
          :aria-expanded="workspace.filePanelOpen"
          aria-controls="workspace-files-panel"
          data-testid="workspace-toggle-files"
          @click="workspace.filePanelOpen = !workspace.filePanelOpen"
        >
          <FolderOpen class="size-4" :stroke-width="1.75" />
        </IconButton>
      </div>
    </Teleport>

    <WorkspaceSidebar
      v-show="!workspaceSidebarCollapsed"
      id="workspace-project-sidebar"
      ref="workspaceSidebar"
      :style="workspaceSidebarStyle"
      :active-section="activeWorkspaceSection"
      :active-tool="activeTool"
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
        :aria-valuenow="workspaceSidebarCollapsed ? undefined : workspaceSidebarEffectiveWidth"
        :aria-disabled="workspaceSidebarCollapsed"
        :title="$t('common.reset')"
        data-testid="workspace-sidebar-resizer"
        @pointerdown="startWorkspaceSidebarResize"
        @dblclick="resetWorkspaceSidebarWidth"
        @keydown="onWorkspaceSidebarResizeKeydown"
      />
    </div>
    <section
      data-testid="workspace-main"
      class="workspace-main flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div
        v-if="viewActive && activeWorkspaceSection === 'tools'"
        class="flex min-h-0 flex-1 flex-col"
        data-testid="workspace-tools"
      >
        <div
          class="flex shrink-0 flex-wrap gap-1 border-b border-[var(--border-subtle)] px-3 py-1.5"
          role="tablist"
          :aria-label="$t('workspace.tools')"
          @keydown="onToolTabKeydown"
        >
          <button
            v-for="tool in [
              { id: 'harness' as const, label: $t('workspace.harness'), icon: Gauge },
              { id: 'orchestration' as const, label: $t('orchestration.sidebarLabel'), icon: Bot }
            ]"
            :id="`workspace-tool-tab-${tool.id}`"
            :key="tool.id"
            type="button"
            role="tab"
            :data-testid="`workspace-tool-${tool.id}`"
            :aria-selected="activeTool === tool.id"
            :tabindex="activeTool === tool.id ? 0 : -1"
            :aria-controls="`workspace-tool-panel-${tool.id}`"
            class="flex min-h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1 text-xs"
            :class="
              activeTool === tool.id
                ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            "
            @click="activeTool = tool.id"
          >
            <component :is="tool.icon" class="size-3.5 shrink-0" />{{ tool.label }}
          </button>
        </div>
        <div
          :id="`workspace-tool-panel-${activeTool}`"
          role="tabpanel"
          :aria-labelledby="`workspace-tool-tab-${activeTool}`"
          class="min-h-0 flex-1"
        >
          <HarnessConsole v-if="activeTool === 'harness'" />
          <OrchestrationConsole v-else />
        </div>
      </div>
      <div v-show="activeWorkspaceSection === 'workspace'" class="flex min-h-0 flex-1 flex-col">
        <MingWorkspaceOrnaments
          v-if="mingDynastyActive && !workspace.filePanelOpen && !architectureOpen"
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
        </div>
        <div
          data-testid="workspace-scene"
          class="workspace-content flex min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          <PortraitSkinPanel
            v-if="
              portraitSkinActive &&
              settings.settings &&
              !workspace.filePanelOpen &&
              !architectureOpen
            "
            :style="settings.settings.mascotStyle"
            :custom-skin="activeVisualSkin?.custom"
            :show-status="settings.settings.petStatusText"
          />
          <div class="workspace-primary min-h-0 min-w-0 flex-1 overflow-hidden">
            <div v-if="architectureOpen" class="h-full min-h-0">
              <ProjectIntelligencePanel
                v-if="viewActive && activeWorkspaceSection === 'workspace'"
                :root="architectureRoot"
                :projects="workspace.importedProjectRoots"
                @select-project="architectureProject = $event"
                @close="architectureOpen = false"
                @explain="explainArchitecture"
              />
            </div>
            <div
              v-else-if="!workspace.canChat"
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
      </div>
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
  background: var(--bg-sidebar);
}

.workspace-sidebar-resizer {
  position: absolute;
  inset: 0;
  cursor: col-resize;
  touch-action: none;
}

/* No resting line: the sidebar edge comes from the background change; a short grip appears on hover. */
.workspace-sidebar-resizer::before {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 28px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 45%, transparent);
  content: '';
  opacity: 0;
  transform: translate(-50%, -50%);
  transition:
    opacity var(--motion-fast) var(--ease-out),
    height var(--motion-fast) var(--ease-out),
    background-color var(--motion-fast) var(--ease-out);
}

.workspace-sidebar-divider:hover .workspace-sidebar-resizer::before,
.workspace-sidebar-resizer:focus-visible::before {
  opacity: 1;
}

.workspace-sidebar-divider--active .workspace-sidebar-resizer::before {
  height: 44px;
  background: var(--accent);
  opacity: 1;
}

.workspace-sidebar-divider--collapsed .workspace-sidebar-resizer::before {
  display: none;
}

.workspace-sidebar-resizer:focus-visible {
  outline: none;
}

.workspace-view--resizing,
.workspace-view--resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}

:global(:root[data-visual-skin='starship-cockpit']) .workspace-sidebar-divider {
  background: rgb(4 15 34 / 0.88);
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
