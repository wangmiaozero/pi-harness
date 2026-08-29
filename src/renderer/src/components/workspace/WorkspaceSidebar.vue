<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  GitBranch,
  MessageSquare,
  Pin,
  Plus,
  RefreshCw,
  X
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import IconButton from '@renderer/components/ui/IconButton.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import FileExplorer from '@renderer/components/files/FileExplorer.vue'
import WorktreeSwitcher from '@renderer/components/git/WorktreeSwitcher.vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useAgentStore } from '@renderer/stores/agent'
import { useModelsStore } from '@renderer/stores/models'
import { useSettingsStore } from '@renderer/stores/settings'
import { useHarnessStore } from '@renderer/stores/harness'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { callApi, getApi } from '@renderer/composables/useApi'
import type { RecentWorkspace, SessionInfo, WorkspaceFolder } from '@shared/types/workspace'
import StarshipModelHud from '@renderer/components/starship/StarshipModelHud.vue'

const emit = defineEmits<{ 'focus-composer': []; 'open-harness': [] }>()
const { t, locale } = useI18n()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const models = useModelsStore()
const settings = useSettingsStore()
const harness = useHarnessStore()
type WorkspaceSection = 'sessions' | 'files' | 'git' | 'harness'
const section = ref<WorkspaceSection>('sessions')
const collapsedSessionIds = ref<string[]>([])
const dragActive = ref(false)
const refreshing = ref(false)
let dragDepth = 0

const visibleSessions = computed(() => {
  const archived = new Set(workspace.archivedSessionIds)
  return sessions.items
    .filter(
      (session) => !archived.has(session.id) && workspace.isSessionInActiveWorkspace(session)
    )
    .map((session, index) => ({ session, index }))
    .sort(
      (a, b) =>
        Number(workspace.isSessionPinned(b.session.id)) -
          Number(workspace.isSessionPinned(a.session.id)) || a.index - b.index
    )
    .map(({ session }) => session)
})
const newChatActive = computed(
  () => workspace.activeTab?.kind === 'chat' && workspace.activeTab.sessionId === 'new'
)
const canShowSessionFiles = computed(
  () =>
    Boolean(sessions.currentId && sessions.current) &&
    workspace.activeSessionWorkspaceId === sessions.currentId
)
const canStartSessionFromCurrentProject = computed(() => workspace.canChat)
const sectionItems = computed(() => [
  { id: 'sessions' as const, label: t('workspace.sessions') },
  { id: 'files' as const, label: t('workspace.files') },
  { id: 'git' as const, label: t('workspace.git') },
  { id: 'harness' as const, label: t('workspace.harness') }
])
const activeProviderKey = computed(() => agent.state?.model?.provider ?? models.active.providerKey)
const activeModelId = computed(() => agent.state?.model?.id ?? models.active.modelId)

function running(id: string): boolean {
  return agent.runningIds.includes(id)
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id
}

function sessionFolders(session: SessionInfo): WorkspaceFolder[] {
  return workspace.sessionFolders(session)
}

function selectSection(next: WorkspaceSection) {
  section.value = next
  if (next === 'harness') emit('open-harness')
}

async function openSession(session: SessionInfo) {
  sessions.selectSession(session.id)
  workspace.ensureChatTab(session.id, sessionTitle(session).slice(0, 28))
  emit('focus-composer')
}

async function newSession() {
  if (!canStartSessionFromCurrentProject.value) return
  if (!(await workspace.startDraftFromActiveWorkspace())) return
  sessions.selectSession(null)
  workspace.ensureChatTab('new', t('workspace.newSession'))
  emit('focus-composer')
}

async function pickProject(): Promise<boolean> {
  const dir = await callApi(() => getApi().workspace.pickDirectory())
  if (!dir) return false
  await sessions.refresh(true)
  await workspace.resetDraftWorkspace(dir)
  sessions.selectSession(null)
  workspace.ensureChatTab('new', t('workspace.newSession'))
  await Promise.all([workspace.loadFiles(), workspace.loadGit()])
  toast.success(t('workspace.projectPicked'), { description: dir })
  return true
}

async function importWorkspace(): Promise<boolean> {
  const sources = await callApi(() => getApi().workspace.pickWorkspaceSources())
  if (!sources.length) return false
  await sessions.refresh(true)
  const workspaceFile = sources.find((source) =>
    source.toLowerCase().endsWith('.code-workspace')
  )
  const directories = sources.filter(
    (source) => !source.toLowerCase().endsWith('.code-workspace')
  )
  if (workspaceFile) {
    await workspace.importDraftWorkspaceFile(workspaceFile)
    for (const directory of directories) workspace.addProjectRoot(directory)
    if (directories.length) await workspace.syncActiveWorkspace()
  } else {
    await workspace.resetDraftWorkspaceRoots(directories)
  }
  sessions.selectSession(null)
  workspace.ensureChatTab('new', t('workspace.newSession'))
  await Promise.all([workspace.loadFiles(), workspace.loadGit()])
  toast.success(
    workspaceFile
      ? t('workspace.workspaceOpened')
      : t('workspace.projectsImported', { count: directories.length }),
    { description: workspaceFile ?? directories[0] }
  )
  emit('focus-composer')
  return true
}

async function refreshWorkspace() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await sessions.refresh(true)
    workspace.pruneUnavailableSessionTabs()
    await workspace.refreshSessionBindings()
    if (sessions.currentId) await workspace.restoreSessionWorkspace(sessions.currentId)
    await Promise.all([workspace.refreshContent(), harness.load(sessions.currentId)])
  } finally {
    refreshing.value = false
  }
}

async function addFolder(target?: SessionInfo): Promise<boolean> {
  const dir = await callApi(() => getApi().workspace.pickDirectory())
  if (!dir) return false
  await callApi(() => getApi().workspace.allowRoot(dir))
  const session = target ?? sessions.current
  if (session) {
    if (sessions.currentId !== session.id) {
      sessions.selectSession(session.id)
      workspace.ensureChatTab(session.id, sessionTitle(session).slice(0, 28))
      await workspace.restoreSessionWorkspace(session.id)
    }
    workspace.addProjectRoot(dir)
    await workspace.syncActiveWorkspace()
    await workspace.bindCurrentSession(session.id)
  } else {
    if (workspace.activeSessionWorkspaceId !== null) await workspace.restoreDraftWorkspace()
    workspace.addProjectRoot(dir)
    await workspace.syncActiveWorkspace()
  }
  await Promise.all([workspace.loadFiles(), workspace.loadGit()])
  toast.success(t('workspace.folderAdded'), { description: dir })
  return true
}

async function openWorkspaceFile(): Promise<boolean> {
  const path = await callApi(() => getApi().workspace.pickWorkspaceFile())
  if (!path) return false
  await sessions.refresh(true)
  await workspace.openWorkspaceFile(path)
  if (sessions.currentId) await workspace.bindCurrentSession(sessions.currentId)
  workspace.ensureChatTab(
    sessions.currentId ?? 'new',
    sessions.current ? sessionTitle(sessions.current).slice(0, 28) : t('workspace.newSession')
  )
  toast.success(t('workspace.workspaceOpened'), { description: path })
  return true
}

async function saveWorkspace(): Promise<boolean> {
  const dest = await callApi(() => getApi().workspace.saveWorkspaceFile())
  if (!dest) return false
  await workspace.saveWorkspaceAs(dest)
  toast.success(t('workspace.workspaceSaved'), { description: dest })
  return true
}

function isCollapsed(sessionId: string): boolean {
  return collapsedSessionIds.value.includes(sessionId)
}

function toggleSession(sessionId: string) {
  collapsedSessionIds.value = isCollapsed(sessionId)
    ? collapsedSessionIds.value.filter((id) => id !== sessionId)
    : [...collapsedSessionIds.value, sessionId]
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragEnter(event: DragEvent) {
  if (!hasFiles(event)) return
  dragDepth += 1
  dragActive.value = true
}

function onDragLeave() {
  if (!dragActive.value) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragActive.value = false
}

function onDragOver(event: DragEvent) {
  if (!hasFiles(event) || !event.dataTransfer) return
  event.dataTransfer.dropEffect = 'copy'
}

async function onDrop(event: DragEvent) {
  dragDepth = 0
  dragActive.value = false
  const directories: string[] = []
  for (const item of Array.from(event.dataTransfer?.items ?? [])) {
    const entry = item.webkitGetAsEntry?.()
    if (item.kind !== 'file' || !entry?.isDirectory) continue
    const file = item.getAsFile()
    if (!file) continue
    const path = await getApi().workspace.getPathForFile(file)
    if (path) directories.push(path)
  }
  if (!directories.length) {
    toast.error(t('workspace.dropFolderOnly'))
    return
  }
  for (const directory of directories) workspace.addProjectRoot(directory)
  await workspace.syncActiveWorkspace()
  if (sessions.currentId) await workspace.bindCurrentSession(sessions.currentId)
  await Promise.all([workspace.loadFiles(), workspace.loadGit()])
  toast.success(
    directories.length === 1
      ? t('workspace.projectDropped')
      : t('workspace.projectsDropped', { count: directories.length })
  )
}

async function onContextMenu(session: SessionInfo, event: MouseEvent) {
  event.preventDefault()
  const action = await callApi(() =>
    getApi().sessions.contextMenu(
      session.id,
      Boolean(session.worktreeBranch),
      workspace.isSessionPinned(session.id),
      locale.value === 'en-US' ? 'en-US' : 'zh-CN'
    )
  )
  if (!action) return
  if (action === 'pin' || action === 'unpin') {
    const pinned = action === 'pin'
    workspace.setSessionPinned(session.id, pinned)
    toast.success(t(pinned ? 'workspace.sessionPinned' : 'workspace.sessionUnpinned'))
    return
  }
  if (action === 'open') return openSession(session)
  if (action === 'rename') {
    const name = window.prompt(t('workspace.renamePrompt'), session.name ?? '')
    if (!name?.trim()) return
    await callApi(() => getApi().sessions.rename(session.id, name.trim()))
    await sessions.refresh(true)
    return
  }
  if (action === 'archive') {
    workspace.archiveSession(session.id)
    toast.success(t('workspace.sessionArchived'))
    return
  }
  if (action === 'delete') {
    return deleteSession(session)
  }
  if (action === 'export-html' || action === 'export-md') {
    const path = await callApi(() =>
      getApi().sessions.export(session.id, action === 'export-html' ? 'html' : 'markdown')
    )
    if (path) toast.success(t('workspace.exported'), { description: path })
    return
  }
  if (action === 'reveal') {
    await callApi(() => getApi().system.showItem(session.path))
    return
  }
  if (action === 'open-worktree' && session.cwd) {
    await callApi(() => getApi().system.openPath(session.cwd))
    return
  }
  if (action === 'fork') toast.info(t('workspace.forkHint'))
}

async function deleteSession(session: SessionInfo) {
  const ok = await askConfirm({
    title: t('workspace.deleteTitle'),
    description: t('workspace.deleteConfirm', { name: sessionTitle(session) }),
    confirmLabel: t('common.delete'),
    tone: 'danger'
  })
  if (!ok) return
  await callApi(() => getApi().sessions.delete(session.id))
  if (session.transient) sessions.removeTransientSession(session.id)
  workspace.forgetSession(session.id)
  await sessions.refresh(true)
}

async function removeFolder(session: SessionInfo, folder: WorkspaceFolder) {
  const folders = sessionFolders(session)
  if (folders.length <= 1) return
  const confirmed = await askConfirm({
    title: t('workspace.removeFolder'),
    description: folder.name,
    confirmLabel: t('workspace.removeFolder'),
    tone: 'danger'
  })
  if (!confirmed) return
  if (sessions.currentId !== session.id) {
    sessions.selectSession(session.id)
    await workspace.restoreSessionWorkspace(session.id)
  }
  workspace.removeProject(folder.id)
  await workspace.syncActiveWorkspace()
  await workspace.bindCurrentSession(session.id)
  toast.success(t('workspace.projectRemoved'), { description: folder.name })
}

async function openRecent(item: RecentWorkspace) {
  await sessions.refresh(true)
  await workspace.openRecentWorkspace(item)
  if (sessions.currentId) await workspace.bindCurrentSession(sessions.currentId)
  workspace.ensureChatTab(
    sessions.currentId ?? 'new',
    sessions.current ? sessionTitle(sessions.current).slice(0, 28) : t('workspace.newSession')
  )
  toast.success(t('workspace.workspaceOpened'), {
    description: item.workspaceFile || item.folderPaths[0]
  })
}

defineExpose({ pickProject, addFolder, openWorkspaceFile, saveWorkspace, openRecent })
</script>

<template>
  <aside
    data-testid="workspace-sidebar"
    class="workspace-control-panel relative flex w-[260px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)]"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div
      class="mission-control-header flex h-[var(--height-page-header)] items-center justify-between border-b border-[var(--border-subtle)] px-2.5"
    >
      <p
        class="flex flex-col text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
      >
        <span>{{ $t('workspace.title') }}</span>
        <span class="cockpit-only text-[7px] tracking-[0.18em] text-[var(--accent)]">
          MISSION CONTROL
        </span>
      </p>
      <div class="workspace-command-actions flex items-center">
        <IconButton
          variant="accent"
          :active="newChatActive"
          :disabled="!canStartSessionFromCurrentProject"
          :label="$t('workspace.newSession')"
          :aria-pressed="newChatActive"
          data-testid="workspace-new-session"
          @click="newSession"
        >
          <Plus class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <IconButton
          :disabled="refreshing"
          :label="$t('common.refresh')"
          data-testid="workspace-refresh"
          @click="refreshWorkspace"
        >
          <RefreshCw
            class="size-3.5"
            :class="refreshing ? 'animate-spin' : ''"
            :stroke-width="1.75"
          />
        </IconButton>
        <IconButton
          :label="$t('workspace.importProject')"
          data-testid="workspace-import-project"
          @click="pickProject"
        >
          <FolderOpen class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <IconButton
          :label="$t('workspace.importWorkspace')"
          data-testid="workspace-import-workspace"
          @click="importWorkspace"
        >
          <FolderPlus class="size-3.5" :stroke-width="1.75" />
        </IconButton>
      </div>
    </div>

    <div class="workspace-section-tabs flex border-b border-[var(--border-subtle)] px-1 py-1">
      <button
        v-for="item in sectionItems"
        :key="item.id"
        :data-testid="`workspace-section-${item.id}`"
        class="workspace-section-tab flex-1 rounded-[var(--radius-sm)] py-1 text-[11px]"
        :class="
          section === item.id
            ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
            : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'
        "
        :aria-pressed="section === item.id"
        @click="selectSection(item.id as WorkspaceSection)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <template v-if="section === 'sessions'">
        <div class="px-2 py-2" data-testid="workspace-session-tree">
          <p class="mb-1 text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
            {{ $t('workspace.sessions') }}
          </p>
          <EmptyState
            v-if="!visibleSessions.length"
            :title="$t('workspace.noSessions')"
            :description="
              workspace.canChat ? $t('workspace.noSessionsHint') : $t('workspace.dropProjectHint')
            "
            :icon="MessageSquare"
          >
            <button
              v-if="workspace.canChat"
              type="button"
              class="mt-3 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-tint-strong)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] active:bg-[var(--bg-selected)]"
              data-testid="workspace-empty-new-session"
              @click="newSession"
            >
              {{ $t('workspace.newSession') }}
            </button>
          </EmptyState>

          <div v-for="session in visibleSessions" :key="session.id" class="mb-1">
            <div
              class="group flex h-8 items-center rounded-[var(--radius-sm)] px-1 text-[12.5px]"
              :class="
                sessions.currentId === session.id
                  ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              "
              @contextmenu="onContextMenu(session, $event)"
            >
              <button
                v-if="session.transient"
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] opacity-70 hover:bg-[var(--bg-hover)] hover:text-[var(--danger)] hover:opacity-100"
                :title="$t('common.delete')"
                :aria-label="`${$t('common.delete')}: ${sessionTitle(session)}`"
                @click.stop="deleteSession(session)"
              >
                <X class="size-3.5" :stroke-width="1.75" />
              </button>
              <button
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                @click.stop="toggleSession(session.id)"
              >
                <ChevronRight v-if="isCollapsed(session.id)" class="size-3" :stroke-width="1.75" />
                <ChevronDown v-else class="size-3" :stroke-width="1.75" />
              </button>
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                :title="sessionTitle(session)"
                @click="openSession(session)"
              >
                <GitBranch
                  v-if="session.worktreeBranch"
                  class="size-3 shrink-0 text-[var(--text-tertiary)]"
                  :stroke-width="1.75"
                />
                <MessageSquare v-else class="size-3.5 shrink-0" :stroke-width="1.7" />
                <span class="min-w-0 flex-1 truncate font-medium">{{ sessionTitle(session) }}</span>
                <Pin
                  v-if="workspace.isSessionPinned(session.id)"
                  class="size-3 shrink-0 text-[var(--text-tertiary)]"
                  :stroke-width="1.75"
                />
                <span
                  v-if="running(session.id)"
                  class="size-1.5 shrink-0 rounded-full bg-[var(--success)]"
                />
              </button>
              <button
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] opacity-60 hover:bg-[var(--accent-tint-strong)] hover:text-[var(--accent)] hover:opacity-100"
                :title="$t('workspace.addFolder')"
                @click.stop="addFolder(session)"
              >
                <Plus class="size-3.5" :stroke-width="1.75" />
              </button>
            </div>

            <div
              v-if="!isCollapsed(session.id)"
              class="ml-5 border-l border-[var(--border-subtle)] pl-2"
            >
              <div
                v-for="(folder, index) in sessionFolders(session)"
                :key="folder.id"
                class="group/folder flex h-7 items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]"
              >
                <Folder class="size-3.5 shrink-0" :stroke-width="1.7" />
                <span class="min-w-0 flex-1 truncate" :title="folder.resolvedPath">{{
                  folder.name
                }}</span>
                <span v-if="index === 0" class="text-[9.5px] text-[var(--text-tertiary)]">
                  {{ $t('workspace.primaryProject') }}
                </span>
                <button
                  v-if="sessionFolders(session).length > 1"
                  type="button"
                  class="flex size-5 items-center justify-center rounded text-[var(--text-tertiary)] opacity-70 hover:bg-[var(--bg-hover)] hover:text-[var(--danger)] hover:opacity-100"
                  :title="$t('workspace.removeFolder')"
                  :aria-label="`${$t('workspace.removeFolder')}: ${folder.name}`"
                  @click="removeFolder(session, folder)"
                >
                  <X class="size-3" :stroke-width="1.75" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
      <FileExplorer v-else-if="section === 'files' && canShowSessionFiles" />
      <div v-else-if="section === 'files'" data-testid="workspace-files-unavailable" class="p-3">
        <EmptyState
          :title="$t('workspace.noSessions')"
          :description="$t('workspace.noSessionsHint')"
          :icon="MessageSquare"
        />
      </div>
      <WorktreeSwitcher v-else-if="section === 'git'" />
      <div v-else-if="section === 'harness'" class="p-3" data-testid="harness-sidebar-status">
        <div
          class="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        >
          <div class="flex items-center gap-2">
            <Gauge class="size-4 text-[var(--accent)]" :stroke-width="1.6" />
            <p class="text-[12px] font-medium text-[var(--text-primary)]">
              {{ $t('workspace.harnessTitle') }}
            </p>
          </div>
          <p class="mt-2 text-[10.5px] leading-relaxed text-[var(--text-tertiary)]">
            {{
              sessions.currentId
                ? $t('workspace.harnessInspectCurrent')
                : $t('workspace.harnessNoSessionHint')
            }}
          </p>
          <div
            v-if="agent.state"
            class="mt-3 flex items-center gap-2 text-[10.5px] text-[var(--text-secondary)]"
          >
            <span
              class="size-1.5 rounded-full"
              :class="
                agent.state.status === 'running'
                  ? 'bg-[var(--success)]'
                  : 'bg-[var(--text-disabled)]'
              "
            />
            <span class="capitalize">{{ agent.state.status }}</span>
            <span class="ml-auto font-mono">
              {{
                agent.state.contextUsage?.percent === null || !agent.state.contextUsage
                  ? '—'
                  : `${agent.state.contextUsage.percent.toFixed(0)}%`
              }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <StarshipModelHud
      :provider-key="activeProviderKey"
      :model-id="activeModelId"
      :thinking-level="agent.thinkingLevel"
      :total-tokens="agent.sessionStats?.tokens.total ?? null"
      :message-count="agent.sessionStats?.totalMessages ?? null"
      :context-percent="agent.state?.contextUsage?.percent ?? null"
      :animated="settings.settings?.petAnimations ?? true"
    />

    <div
      v-if="dragActive"
      data-testid="project-drop-overlay"
      class="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--accent)] bg-[var(--bg-sidebar)]"
    >
      <div class="flex flex-col items-center gap-2 px-4 text-center text-[var(--text-primary)]">
        <FolderOpen class="size-7 text-[var(--accent)]" :stroke-width="1.5" />
        <p class="text-[12.5px] font-medium">{{ $t('workspace.dropProject') }}</p>
        <p class="text-[10.5px] text-[var(--text-tertiary)]">
          {{ $t('workspace.dropProjectHint') }}
        </p>
      </div>
    </div>
  </aside>
</template>
