<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  GitBranch,
  Pin,
  Plus,
  RefreshCw
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import IconButton from '@renderer/components/ui/IconButton.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import FileExplorer from '@renderer/components/files/FileExplorer.vue'
import WorktreeSwitcher from '@renderer/components/git/WorktreeSwitcher.vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useAgentStore } from '@renderer/stores/agent'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { callApi, getApi } from '@renderer/composables/useApi'
import { projectIdentityKey } from '@shared/workspace/project-identity'
import type { SessionInfo, SessionProjectGroup } from '@shared/types/workspace'

const emit = defineEmits<{ 'focus-composer': [] }>()
const { t, locale } = useI18n()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const section = ref<'sessions' | 'files' | 'git'>('sessions')
const collapsedProjectKeys = ref<string[]>([])
const dragActive = ref(false)
let dragDepth = 0

const projects = computed(() => workspace.projects)
const newChatActive = computed(
  () => workspace.activeTab?.kind === 'chat' && workspace.activeTab.sessionId === 'new'
)
const newSessionLabel = computed(() =>
  workspace.canChat ? t('workspace.newSession') : t('workspace.newSessionRequiresProject')
)

function running(id: string): boolean {
  return agent.runningIds.includes(id)
}

async function openSession(session: SessionInfo) {
  const projectRoot = session.projectRoot || session.cwd
  if (projectRoot) workspace.addProjectRoot(projectRoot)
  sessions.selectSession(session.id)
  workspace.ensureChatTab(
    session.id,
    session.name || session.firstMessage.slice(0, 28) || session.id
  )
  emit('focus-composer')
}

async function newSession() {
  if (!workspace.canChat) return
  sessions.selectSession(null)
  workspace.ensureChatTab('new', t('workspace.newSession'))
  emit('focus-composer')
}

async function activateProject(dir: string, announce = false) {
  await callApi(() => getApi().workspace.allowRoot(dir))
  const projectRoot = workspace.addProjectRoot(dir)
  const key = projectIdentityKey(projectRoot)
  const existing = sessions.projects.find((project) => project.projectKey === key)
  if (existing) sessions.selectProject(existing)
  else sessions.selectProjectKey(key)
  sessions.selectSession(null)
  workspace.ensureChatTab('new', t('workspace.newSession'))
  await Promise.all([workspace.loadFiles(), workspace.loadGit()])
  if (announce) toast.success(t('workspace.projectPicked'), { description: projectRoot })
}

async function pickProject(): Promise<boolean> {
  const dir = await callApi(() => getApi().workspace.pickDirectory())
  if (!dir) return false
  await activateProject(dir, true)
  return true
}

async function selectProject(project: SessionProjectGroup) {
  await activateProject(project.projectRoot)
}

async function newSessionForProject(project: SessionProjectGroup) {
  await activateProject(project.projectRoot)
  emit('focus-composer')
}

function isCollapsed(projectKey: string): boolean {
  return collapsedProjectKeys.value.includes(projectKey)
}

function toggleProject(projectKey: string) {
  collapsedProjectKeys.value = isCollapsed(projectKey)
    ? collapsedProjectKeys.value.filter((key) => key !== projectKey)
    : [...collapsedProjectKeys.value, projectKey]
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
    const path = getApi().workspace.getPathForFile(file)
    if (path) directories.push(path)
  }
  if (!directories.length) {
    toast.error(t('workspace.dropFolderOnly'))
    return
  }
  for (const directory of directories) {
    await callApi(() => getApi().workspace.allowRoot(directory))
    workspace.addProjectRoot(directory)
  }
  await activateProject(directories.at(-1) as string)
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
  if (action === 'open') {
    await openSession(session)
    return
  }
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
    const ok = await askConfirm({
      title: t('workspace.deleteTitle'),
      description: t('workspace.deleteConfirm', { name: session.name || session.id }),
      confirmLabel: t('common.delete'),
      tone: 'danger'
    })
    if (!ok) return
    await callApi(() => getApi().sessions.delete(session.id))
    workspace.setSessionPinned(session.id, false)
    if (sessions.currentId === session.id) sessions.selectSession(null)
    await sessions.refresh(true)
    return
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
  }
  if (action === 'fork') {
    toast.info(t('workspace.forkHint'))
  }
}

async function onProjectContextMenu(project: SessionProjectGroup, event: MouseEvent) {
  event.preventDefault()
  const action = await callApi(() =>
    getApi().workspace.projectContextMenu(
      project.projectKey,
      project.projectRoot,
      workspace.isProjectPinned(project.projectKey),
      locale.value === 'en-US' ? 'en-US' : 'zh-CN'
    )
  )
  if (!action) return
  if (action === 'pin' || action === 'unpin') {
    const pinned = action === 'pin'
    workspace.setProjectPinned(project.projectKey, pinned)
    toast.success(t(pinned ? 'workspace.projectPinned' : 'workspace.projectUnpinned'))
    return
  }
  if (action === 'reveal') {
    await callApi(() => getApi().system.showItem(project.projectRoot))
    return
  }
  if (action === 'archive-chats') {
    workspace.archiveProjectSessions(project.projectKey)
    toast.success(t('workspace.projectChatsArchived'))
    return
  }
  if (action === 'remove') {
    if (workspace.dirtyFilePathsAfterProjectRemoval(project.projectKey).length) {
      const confirmed = await askConfirm({
        title: t('workspace.fileDiscardTitle'),
        description: t('workspace.fileDiscardConfirm'),
        confirmLabel: t('workspace.fileDiscardAction'),
        tone: 'danger'
      })
      if (!confirmed) return
    }
    workspace.removeProject(project.projectKey)
    toast.success(t('workspace.projectRemoved'))
    return
  }
  if (action === 'create-worktree') {
    const branch = window.prompt(t('workspace.worktreeBranchPrompt'), '')?.trim()
    if (!branch) return
    try {
      const created = await callApi(() => getApi().worktrees.create(project.projectRoot, branch))
      await activateProject(created.path)
      toast.success(t('workspace.worktreeCreated'), { description: created.path })
    } catch (error) {
      toast.error(t('workspace.worktreeCreateFailed'), {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

defineExpose({ pickProject })
</script>

<template>
  <aside
    data-testid="workspace-sidebar"
    class="relative flex w-[260px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)]"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div
      class="flex items-center justify-between px-2.5 h-9 border-b border-[var(--border-subtle)]"
    >
      <p class="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
        {{ $t('workspace.title') }}
      </p>
      <div class="flex items-center">
        <IconButton
          variant="accent"
          :active="newChatActive"
          :disabled="!workspace.canChat"
          :label="newSessionLabel"
          :aria-pressed="newChatActive"
          data-testid="workspace-new-session"
          @click="newSession"
        >
          <Plus class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <IconButton :label="$t('common.refresh')" @click="sessions.refresh(true)">
          <RefreshCw class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <IconButton :label="$t('workspace.openProject')" @click="pickProject">
          <FolderOpen class="size-3.5" :stroke-width="1.75" />
        </IconButton>
      </div>
    </div>

    <div class="flex border-b border-[var(--border-subtle)] px-1 py-1">
      <button
        v-for="item in [
          { id: 'sessions', label: $t('workspace.sessions') },
          { id: 'files', label: $t('workspace.files') },
          { id: 'git', label: $t('workspace.git') }
        ]"
        :key="item.id"
        class="flex-1 rounded-[var(--radius-sm)] py-1 text-[11px]"
        :class="
          section === item.id
            ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
            : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'
        "
        @click="section = item.id as 'sessions' | 'files' | 'git'"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <template v-if="section === 'sessions'">
        <div class="px-2 py-2" data-testid="workspace-project-tree">
          <p class="mb-1 text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
            {{ $t('workspace.projects') }}
          </p>
          <EmptyState
            v-if="!projects.length"
            :title="$t('workspace.noProjects')"
            :description="$t('workspace.dropProjectHint')"
            :icon="FolderOpen"
          />
          <div v-for="project in projects" :key="project.projectKey" class="mb-1">
            <div
              class="group flex h-8 items-center rounded-[var(--radius-sm)] px-1 text-[12.5px]"
              :class="
                sessions.currentProjectKey === project.projectKey
                  ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              "
              :data-project-key="project.projectKey"
              @contextmenu="onProjectContextMenu(project, $event)"
            >
              <button
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                :aria-label="
                  isCollapsed(project.projectKey)
                    ? $t('workspace.expandProject')
                    : $t('workspace.collapseProject')
                "
                @click.stop="toggleProject(project.projectKey)"
              >
                <ChevronRight
                  v-if="isCollapsed(project.projectKey)"
                  class="size-3"
                  :stroke-width="1.75"
                />
                <ChevronDown v-else class="size-3" :stroke-width="1.75" />
              </button>
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                :title="project.projectRoot"
                @click="selectProject(project)"
              >
                <Folder class="size-4 shrink-0" :stroke-width="1.65" />
                <span class="truncate font-medium">{{ project.name }}</span>
                <Pin
                  v-if="workspace.isProjectPinned(project.projectKey)"
                  class="size-3 shrink-0 text-[var(--text-tertiary)]"
                  :stroke-width="1.75"
                  :aria-label="$t('workspace.pinned')"
                />
              </button>
              <button
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded border border-transparent text-[var(--text-tertiary)] opacity-60 transition-[color,background-color,border-color,opacity] hover:border-[var(--accent-border)] hover:bg-[var(--accent-tint-strong)] hover:text-[var(--accent)] hover:opacity-100 focus-visible:border-[var(--accent-border)] focus-visible:bg-[var(--accent-tint)] focus-visible:text-[var(--accent)] focus-visible:opacity-100 focus-visible:outline-none active:bg-[var(--bg-selected)]"
                :aria-label="$t('workspace.newSessionForProject', { project: project.name })"
                :title="$t('workspace.newSessionForProject', { project: project.name })"
                @click.stop="newSessionForProject(project)"
              >
                <Plus class="size-3.5" :stroke-width="1.75" />
              </button>
            </div>

            <div
              v-if="!isCollapsed(project.projectKey)"
              class="ml-5 mt-0.5 border-l border-[var(--border-subtle)] pl-1"
            >
              <p
                v-if="!project.sessions.length"
                class="px-2 py-1 text-[10.5px] text-[var(--text-tertiary)]"
              >
                {{ $t('workspace.noSessions') }}
              </p>
              <button
                v-for="session in project.sessions"
                :key="session.id"
                type="button"
                class="group/session relative flex h-7 w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-left transition-[color,background-color,box-shadow] active:bg-[var(--accent-tint-strong)]"
                :class="
                  sessions.currentId === session.id
                    ? 'font-medium text-[var(--accent)]'
                    : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                "
                :aria-current="sessions.currentId === session.id ? 'page' : undefined"
                :title="session.name || session.firstMessage"
                @click="openSession(session)"
                @contextmenu="onContextMenu(session, $event)"
              >
                <span
                  v-if="sessions.currentId === session.id"
                  class="absolute left-0.5 size-1 rounded-full bg-[var(--accent)]"
                  aria-hidden="true"
                />
                <GitBranch
                  v-if="session.worktreeBranch"
                  class="size-3 shrink-0 text-[var(--text-tertiary)]"
                  :stroke-width="1.75"
                />
                <Pin
                  v-if="workspace.isSessionPinned(session.id)"
                  class="size-3 shrink-0 text-[var(--text-tertiary)]"
                  :stroke-width="1.75"
                  :aria-label="$t('workspace.pinned')"
                />
                <span class="min-w-0 flex-1 truncate text-[12px] text-current">
                  {{ session.name || session.firstMessage || session.id }}
                </span>
                <span
                  v-if="running(session.id)"
                  class="size-1.5 shrink-0 rounded-full bg-[var(--success)]"
                  :title="$t('workspace.running')"
                />
              </button>
            </div>
          </div>
        </div>
      </template>
      <FileExplorer v-else-if="section === 'files'" />
      <WorktreeSwitcher v-else />
    </div>

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
