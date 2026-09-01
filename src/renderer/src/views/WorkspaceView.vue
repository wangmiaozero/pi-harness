<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import WorkspaceSidebar from '@renderer/components/workspace/WorkspaceSidebar.vue'
import WorkspaceTabs from '@renderer/components/workspace/WorkspaceTabs.vue'
import ChatWindow from '@renderer/components/chat/ChatWindow.vue'
import WorkspaceFilesPanel from '@renderer/components/workspace/WorkspaceFilesPanel.vue'
import PortraitSkinPanel from '@renderer/components/layout/PortraitSkinPanel.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import GitDiffView from '@renderer/components/git/GitDiffView.vue'
import GitWorkspaceView from '@renderer/components/git/GitWorkspaceView.vue'
import HarnessConsole from '@renderer/components/harness/HarnessConsole.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { FolderOpen } from '@lucide/vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useAgentStore } from '@renderer/stores/agent'
import { useSettingsStore } from '@renderer/stores/settings'
import { registerShortcut } from '@renderer/composables/shortcuts'
import { getApi } from '@renderer/composables/useApi'
import type { RecentWorkspace } from '@shared/types/workspace'
import { getActiveVisualSkin } from '@renderer/utils/visual-skin'

const { t } = useI18n()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const settings = useSettingsStore()
const workspaceSidebar = ref<InstanceType<typeof WorkspaceSidebar> | null>(null)
const chatWindow = ref<InstanceType<typeof ChatWindow> | null>(null)
const workspaceTabs = ref<InstanceType<typeof WorkspaceTabs> | null>(null)
const filesPanel = ref<InstanceType<typeof WorkspaceFilesPanel> | null>(null)
const activeWorkspaceSection = ref<'sessions' | 'git' | 'harness'>('sessions')
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let unsubWorkspaceChanged: (() => void) | null = null
let sessionSwitchQueue: Promise<void> = Promise.resolve()

const activeKind = computed(() => workspace.activeTab?.kind ?? 'chat')
const portraitSkinActive = computed(() => getActiveVisualSkin(settings.settings)?.portrait === true)

async function focusComposer() {
  await nextTick()
  chatWindow.value?.focusComposer()
}

function startNewSession() {
  if (!workspace.canChat) return
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

function openHarness() {
  workspace.ensureHarnessTab(t('workspace.harnessTitle'))
}

function setWorkspaceSection(section: 'sessions' | 'git' | 'harness') {
  activeWorkspaceSection.value = section
}

const offNew = registerShortcut({
  id: 'workspace-new-session',
  label: t('workspace.newSession'),
  keys: ['meta+n', 'ctrl+n'],
  run: startNewSession
})
const offClose = registerShortcut({
  id: 'workspace-close-tab',
  label: t('workspace.closeTab'),
  keys: ['meta+w', 'ctrl+w'],
  run: () => {
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
  if (sessions.currentId) void agent.compact(sessions.currentId)
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
    if (workspace.canChat && !workspace.tabs.length) {
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
    await agent.load(null)
    return
  }
  if (id) await workspace.restoreSessionWorkspace(id)
  else await workspace.restoreDraftWorkspace()
  await agent.load(id)
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
  <div class="workspace-view flex h-full min-h-0">
    <WorkspaceSidebar
      ref="workspaceSidebar"
      @focus-composer="focusComposer"
      @open-harness="openHarness"
      @section-change="setWorkspaceSection"
    />
    <section class="workspace-main flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        class="workspace-tabbar flex h-[var(--height-page-header)] min-w-0 shrink-0 items-center"
      >
        <WorkspaceTabs
          v-if="workspace.mainTabs.length"
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
          :show-status="settings.settings.petStatusText"
        />
        <div class="workspace-primary min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            v-if="!workspace.canChat && activeKind !== 'harness'"
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
            <GitWorkspaceView v-if="activeWorkspaceSection === 'git'" />
            <ChatWindow v-else-if="activeKind === 'chat'" ref="chatWindow" />
            <GitDiffView v-else-if="activeKind === 'diff'" />
            <HarnessConsole v-else-if="activeKind === 'harness'" />
          </div>
        </div>
        <WorkspaceFilesPanel v-if="workspace.filePanelOpen" ref="filesPanel" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.workspace-main {
  container-type: inline-size;
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
