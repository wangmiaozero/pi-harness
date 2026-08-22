<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import WorkspaceSidebar from '@renderer/components/workspace/WorkspaceSidebar.vue'
import WorkspaceTabs from '@renderer/components/workspace/WorkspaceTabs.vue'
import ChatWindow from '@renderer/components/chat/ChatWindow.vue'
import FileViewer from '@renderer/components/files/FileViewer.vue'
import GitDiffView from '@renderer/components/git/GitDiffView.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { FolderOpen } from '@lucide/vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useAgentStore } from '@renderer/stores/agent'
import { useSettingsStore } from '@renderer/stores/settings'
import { registerShortcut } from '@renderer/composables/shortcuts'

const { t } = useI18n()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const settings = useSettingsStore()
const workspaceSidebar = ref<InstanceType<typeof WorkspaceSidebar> | null>(null)
const chatWindow = ref<InstanceType<typeof ChatWindow> | null>(null)
const workspaceTabs = ref<InstanceType<typeof WorkspaceTabs> | null>(null)
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const activeKind = computed(() => workspace.activeTab?.kind ?? 'chat')

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
    if (workspace.activeTabId) void workspaceTabs.value?.requestCloseTab(workspace.activeTabId)
  }
})

function onAbortEvent() {
  if (sessions.currentId) void agent.abort(sessions.currentId)
}

function onCompactEvent() {
  if (sessions.currentId) void agent.compact(sessions.currentId)
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
    await Promise.all([workspace.loadFiles(), workspace.loadGit()])
  })()
  window.addEventListener('pi-harness:abort-agent', onAbortEvent)
  window.addEventListener('pi-harness:compact-session', onCompactEvent)
  window.addEventListener('focus', scheduleContentRefresh)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  offNew()
  offClose()
  if (refreshTimer) clearTimeout(refreshTimer)
  window.removeEventListener('pi-harness:abort-agent', onAbortEvent)
  window.removeEventListener('pi-harness:compact-session', onCompactEvent)
  window.removeEventListener('focus', scheduleContentRefresh)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

watch(
  () => sessions.currentId,
  async (id) => {
    await agent.load(id)
    if (id) {
      const session = sessions.current
      workspace.ensureChatTab(id, session?.name || session?.firstMessage?.slice(0, 32) || id)
    }
    await Promise.all([workspace.loadFiles(), workspace.loadGit()])
  }
)

watch(
  () => sessions.currentProjectKey,
  () => {
    void workspace.loadFiles()
    void workspace.loadGit()
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
  <div class="flex h-full min-h-0">
    <WorkspaceSidebar ref="workspaceSidebar" @focus-composer="focusComposer" />
    <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-workspace)]">
      <template v-if="workspace.canChat">
        <WorkspaceTabs ref="workspaceTabs" @focus-composer="focusComposer" />
      </template>
      <div
        v-if="!workspace.canChat"
        data-testid="workspace-project-required"
        class="flex min-h-0 flex-1 items-center justify-center"
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
        </EmptyState>
      </div>
      <div v-else class="min-h-0 flex-1 overflow-hidden">
        <ChatWindow v-if="activeKind === 'chat'" ref="chatWindow" />
        <FileViewer v-else-if="activeKind === 'file'" />
        <GitDiffView v-else-if="activeKind === 'diff'" />
      </div>
    </section>
  </div>
</template>
