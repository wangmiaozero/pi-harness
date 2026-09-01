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
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Input from '@renderer/components/ui/Input.vue'
import WorktreeSwitcher from '@renderer/components/git/WorktreeSwitcher.vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useAgentStore } from '@renderer/stores/agent'
import { useModelsStore } from '@renderer/stores/models'
import { useSettingsStore } from '@renderer/stores/settings'
import { useHarnessStore } from '@renderer/stores/harness'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import type {
  RecentWorkspace,
  SessionInfo,
  SessionProjectGroup,
  WorkspaceFolder
} from '@shared/types/workspace'
import StarshipModelHud from '@renderer/components/starship/StarshipModelHud.vue'
import ProjectWorkspaceDialog from './ProjectWorkspaceDialog.vue'
import RenameDialog from './RenameDialog.vue'
import { projectIdentityKey } from '@shared/workspace/project-identity'
import {
  groupSessionsByProject,
  mergeWorkspaceProjects,
  projectDisplayName
} from '@shared/workspace/session-tree'

const emit = defineEmits<{
  'focus-composer': []
  'open-harness': []
  'section-change': [section: 'sessions' | 'git' | 'harness']
}>()
const { t, locale } = useI18n()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const models = useModelsStore()
const settings = useSettingsStore()
const harness = useHarnessStore()
type WorkspaceSection = 'sessions' | 'git' | 'harness'
const section = ref<WorkspaceSection>('sessions')
const collapsedSessionIds = ref<string[]>([])
const collapsedProjectKeys = ref<string[]>([])
const dragActive = ref(false)
const refreshing = ref(false)
const importingProject = ref(false)
const importingWorkspace = ref(false)
const editingProject = ref<SessionProjectGroup | null>(null)
const editingName = ref('')
const editingFolders = ref<WorkspaceFolder[]>([])
const savingSessionFolders = ref(false)
const renaming = ref<{ session?: SessionInfo; project?: SessionProjectGroup } | null>(null)
const renameValue = ref('')
const renameSaving = ref(false)
const branchingProject = ref<SessionProjectGroup | null>(null)
const branchName = ref('')
const branchSaving = ref(false)
let dragDepth = 0

const visibleSessions = computed(() => {
  const archived = new Set(workspace.archivedSessionIds)
  return sessions.items
    .filter((session) => !archived.has(session.id))
    .map((session, index) => ({ session, index }))
    .sort(
      (a, b) =>
        Number(workspace.isSessionPinned(b.session.id)) -
          Number(workspace.isSessionPinned(a.session.id)) || a.index - b.index
    )
    .map(({ session }) => session)
})
const projectGroups = computed(() =>
  mergeWorkspaceProjects(
    workspace.importedProjectRoots,
    groupSessionsByProject(
      visibleSessions.value.map((session) => {
        const primary = sessionFolders(session)[0]
        return primary
          ? { ...session, projectRoot: primary.resolvedPath, projectKey: primary.id }
          : session
      })
    )
  )
    .filter((group) => !workspace.removedProjectKeys.includes(group.projectKey))
    .map((group) => ({
      ...group,
      name: workspace.projectSettings[group.projectKey]?.name || group.name,
      sessions: [...group.sessions].sort(
        (a, b) => Number(workspace.isSessionPinned(b.id)) - Number(workspace.isSessionPinned(a.id))
      )
    }))
    .sort(
      (a, b) =>
        Number(workspace.isProjectPinned(b.projectKey)) -
        Number(workspace.isProjectPinned(a.projectKey))
    )
)
const newChatActive = computed(
  () => workspace.activeTab?.kind === 'chat' && workspace.activeTab.sessionId === 'new'
)
const canShowSessionGit = computed(() => workspace.hasSessionWorkspace)
const canStartSessionFromCurrentProject = computed(
  () =>
    Boolean(sessions.currentId && sessions.current) &&
    workspace.activeSessionWorkspaceId === sessions.currentId &&
    workspace.workspaceFolders.length > 0
)
const sectionItems = computed(() => [
  { id: 'sessions' as const, label: t('workspace.projects') },
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
  emit('section-change', next)
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

async function newSessionFromProject(group: SessionProjectGroup) {
  try {
    await workspace.startDraftFromProject(group.projectRoot)
    sessions.selectSession(null)
    workspace.ensureChatTab('new', t('workspace.newSession'))
    emit('focus-composer')
  } catch (error) {
    toast.error(getErrorPayload(error).message)
  }
}

async function openDraftSession() {
  if (!workspace.hasDraftSession) return
  await workspace.restoreDraftWorkspace()
  sessions.selectSession(null)
  workspace.ensureChatTab('new', t('workspace.newSession'))
  emit('focus-composer')
}

function isProjectActive(group: SessionProjectGroup): boolean {
  return newChatActive.value && workspace.draftWorkspaceFolders[0]?.id === group.projectKey
}

function isProjectCollapsed(projectKey: string): boolean {
  return collapsedProjectKeys.value.includes(projectKey)
}

async function openProjectGroup(group: SessionProjectGroup) {
  if (!group.sessions.length) {
    if (workspace.hasDraftSession && workspace.draftWorkspaceFolders[0]?.id === group.projectKey) {
      await openDraftSession()
    } else {
      await newSessionFromProject(group)
    }
    return
  }
  collapsedProjectKeys.value = isProjectCollapsed(group.projectKey)
    ? collapsedProjectKeys.value.filter((key) => key !== group.projectKey)
    : [...collapsedProjectKeys.value, group.projectKey]
}

async function removeProject(group: SessionProjectGroup) {
  const confirmed = await askConfirm({
    title: t('workspace.deleteProjectTitle'),
    description: t('workspace.deleteProjectConfirm', { name: group.name }),
    confirmLabel: t('common.delete'),
    tone: 'danger'
  })
  if (!confirmed) return
  await workspace.removeProjectEntry(group.projectKey)
  toast.success(t('workspace.importedProjectRemoved'))
}

async function onProjectContextMenu(group: SessionProjectGroup, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  try {
    await handleProjectContextMenu(group)
  } catch (error) {
    toast.error(getErrorPayload(error).message)
  }
}

async function handleProjectContextMenu(group: SessionProjectGroup) {
  const action = await callApi(() =>
    getApi().workspace.projectContextMenu(
      group.projectKey,
      group.projectRoot,
      workspace.isProjectPinned(group.projectKey),
      locale.value === 'en-US' ? 'en-US' : 'zh-CN'
    )
  )
  if (action === 'pin' || action === 'unpin') {
    workspace.setProjectPinned(group.projectKey, action === 'pin')
  } else if (action === 'open') {
    collapsedProjectKeys.value = collapsedProjectKeys.value.filter(
      (key) => key !== group.projectKey
    )
    const session =
      group.sessions.find((item) => item.id === sessions.currentId) ?? group.sessions[0]
    if (session) await openSession(session)
    else await newSessionFromProject(group)
  } else if (action === 'edit') {
    editingProject.value = group
    editingName.value = group.name
    editingFolders.value = workspace.projectSourceRoots(group.projectRoot).map((root, index) => ({
      id: projectIdentityKey(root),
      name: projectDisplayName(root),
      path: root,
      resolvedPath: root,
      role: index === 0 ? 'main' : 'reference',
      readonly: false,
      exists: true
    }))
  } else if (action === 'rename') {
    renaming.value = { project: group }
    renameValue.value = group.name
  } else if (action === 'archive-chats') {
    const confirmed = await askConfirm({
      title: t('workspace.archiveProjectTitle'),
      description: t('workspace.archiveProjectConfirm', {
        name: group.name,
        count: group.sessions.length
      }),
      confirmLabel: t('workspace.archiveProjectTitle')
    })
    if (!confirmed) return
    workspace.rememberImportedProjects([group.projectRoot])
    workspace.archiveProjectSessions(group.projectKey)
    toast.success(t('workspace.projectChatsArchived'))
  } else if (action === 'create-worktree') {
    branchingProject.value = group
    branchName.value = ''
  } else if (action === 'export-html' || action === 'export-md') {
    if (!group.sessions.length) {
      toast.info(t('workspace.noSessionsToExport'))
      return
    }
    const path = await callApi(() =>
      getApi().sessions.exportProject(
        group.name,
        group.sessions.map((session) => session.id),
        action === 'export-html' ? 'html' : 'markdown'
      )
    )
    if (path) toast.success(t('workspace.exported'), { description: path })
  } else if (action === 'reveal') {
    await callApi(() => getApi().system.showItem(group.projectRoot))
  } else if (action === 'remove') {
    await removeProject(group)
  }
}

async function createProjectBranch() {
  if (!branchingProject.value || branchSaving.value || !branchName.value.trim()) return
  branchSaving.value = true
  try {
    const result = await callApi(() =>
      getApi().worktrees.create(branchingProject.value!.projectRoot, branchName.value.trim())
    )
    workspace.rememberImportedProjects([result.path])
    branchingProject.value = null
    toast.success(t('workspace.worktreeCreated'), { description: result.path })
  } catch (error) {
    toast.error(getErrorPayload(error).message)
  } finally {
    branchSaving.value = false
  }
}

async function pickProject(): Promise<boolean> {
  if (importingProject.value || importingWorkspace.value) return false
  importingProject.value = true
  try {
    const dir = await callApi(() => getApi().workspace.pickDirectory())
    if (!dir) return false
    await sessions.refresh(true)
    await workspace.resetDraftWorkspace(dir)
    workspace.rememberImportedProjects(workspace.draftProjectRoots)
    sessions.selectSession(null)
    workspace.ensureChatTab('new', t('workspace.newSession'))
    await Promise.all([workspace.loadFiles(), workspace.loadGit()])
    toast.success(t('workspace.projectPicked'), { description: dir })
    emit('focus-composer')
    return true
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('common.failed'))
    return false
  } finally {
    importingProject.value = false
  }
}

async function importWorkspace(): Promise<boolean> {
  if (importingProject.value || importingWorkspace.value) return false
  importingWorkspace.value = true
  try {
    const sources = await callApi(() => getApi().workspace.pickWorkspaceSources())
    if (!sources.length) return false
    await sessions.refresh(true)
    const workspaceFile = sources.find((source) => source.toLowerCase().endsWith('.code-workspace'))
    const directories = sources.filter(
      (source) => !source.toLowerCase().endsWith('.code-workspace')
    )
    if (workspaceFile) {
      await workspace.importDraftWorkspaceFile(workspaceFile, directories)
    } else {
      await workspace.resetDraftWorkspaceRoots(directories)
    }
    workspace.rememberDraftProject()
    sessions.selectSession(null)
    workspace.ensureChatTab('new', t('workspace.newSession'))
    await Promise.all([workspace.loadFiles(), workspace.loadGit()])
    toast.success(t('workspace.workspaceOpened'), {
      description: workspaceFile ?? directories[0]
    })
    emit('focus-composer')
    return true
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('common.failed'))
    return false
  } finally {
    importingWorkspace.value = false
  }
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
    workspace.markDraftSessionVisible()
    workspace.rememberDraftProject()
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
  else workspace.rememberDraftProject()
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
  else {
    workspace.markDraftSessionVisible()
    workspace.rememberDraftProject()
  }
  await Promise.all([workspace.loadFiles(), workspace.loadGit()])
  toast.success(
    directories.length === 1
      ? t('workspace.projectDropped')
      : t('workspace.projectsDropped', { count: directories.length })
  )
}

async function onContextMenu(session: SessionInfo, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const action = await callApi(() =>
    getApi().sessions.contextMenu(
      session.id,
      Boolean(session.worktreeBranch),
      workspace.isSessionPinned(session.id),
      locale.value === 'en-US' ? 'en-US' : 'zh-CN'
    )
  )
  if (action === 'rename') {
    renaming.value = { session }
    renameValue.value = sessionTitle(session)
  } else if (action === 'delete') {
    await deleteSession(session)
  }
}

async function saveRename() {
  if (!renaming.value || renameSaving.value || !renameValue.value.trim()) return
  renameSaving.value = true
  try {
    const name = renameValue.value.trim()
    if (renaming.value.session) {
      const id = renaming.value.session.id
      await callApi(() => getApi().sessions.rename(id, name))
      await sessions.refresh(true)
      const tab = workspace.tabs.find((item) => item.kind === 'chat' && item.sessionId === id)
      if (tab) tab.title = name.slice(0, 28)
    } else if (renaming.value.project) {
      const root = renaming.value.project.projectRoot
      workspace.saveProjectSettings(root, name, workspace.projectSourceRoots(root))
    }
    renaming.value = null
  } catch (error) {
    toast.error(getErrorPayload(error).message)
  } finally {
    renameSaving.value = false
  }
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
  const root = sessionFolders(session)[0]?.resolvedPath
  if (root) workspace.rememberImportedProjects([root])
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
  await workspace.saveSessionFolders(
    session.id,
    folders.filter((candidate) => candidate.id !== folder.id)
  )
  toast.success(t('workspace.projectRemoved'), { description: folder.name })
}

async function onFolderContextMenu(
  session: SessionInfo,
  folder: WorkspaceFolder,
  event: MouseEvent
) {
  event.preventDefault()
  event.stopPropagation()
  if (sessionFolders(session).length <= 1) return
  const action = await callApi(() =>
    getApi().workspace.sessionFolderContextMenu(locale.value === 'en-US' ? 'en-US' : 'zh-CN')
  )
  if (action === 'remove') await removeFolder(session, folder)
}

async function addEditingFolder() {
  const dir = await callApi(() => getApi().workspace.pickDirectory())
  if (!dir) return
  const id = projectIdentityKey(dir)
  if (editingFolders.value.some((folder) => folder.id === id)) return
  editingFolders.value = [
    ...editingFolders.value,
    {
      id,
      name: projectDisplayName(dir),
      path: dir,
      resolvedPath: dir,
      role: editingFolders.value.length === 0 ? 'main' : 'reference',
      readonly: false,
      exists: true
    }
  ]
}

function removeEditingFolder(folder: WorkspaceFolder) {
  if (editingFolders.value[0]?.id === folder.id) return
  editingFolders.value = editingFolders.value
    .filter((candidate) => candidate.id !== folder.id)
    .map((candidate, index) => ({
      ...candidate,
      role: index === 0 ? 'main' : 'reference'
    }))
}

async function saveEditingFolders() {
  if (!editingProject.value || savingSessionFolders.value || !editingName.value.trim()) return
  savingSessionFolders.value = true
  try {
    for (const folder of editingFolders.value)
      await callApi(() => getApi().workspace.allowRoot(folder.resolvedPath))
    workspace.saveProjectSettings(
      editingProject.value.projectRoot,
      editingName.value,
      editingFolders.value.map((folder) => folder.resolvedPath)
    )
    toast.success(t('workspace.projectSettingsUpdated'))
    editingProject.value = null
  } catch (error) {
    toast.error(getErrorPayload(error).message)
  } finally {
    savingSessionFolders.value = false
  }
}

async function openRecent(item: RecentWorkspace) {
  await sessions.refresh(true)
  await workspace.openRecentWorkspace(item)
  if (sessions.currentId) await workspace.bindCurrentSession(sessions.currentId)
  else workspace.rememberDraftProject()
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
          :disabled="importingProject || importingWorkspace"
          :label="$t('workspace.importProject')"
          data-testid="workspace-import-project"
          @click="pickProject"
        >
          <FolderOpen
            class="size-3.5"
            :class="importingProject ? 'animate-pulse' : ''"
            :stroke-width="1.75"
          />
        </IconButton>
        <IconButton
          :disabled="importingProject || importingWorkspace"
          :label="$t('workspace.importWorkspace')"
          data-testid="workspace-import-workspace"
          @click="importWorkspace"
        >
          <FolderPlus
            class="size-3.5"
            :class="importingWorkspace ? 'animate-pulse' : ''"
            :stroke-width="1.75"
          />
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
            {{ $t('workspace.projects') }}
          </p>
          <EmptyState
            v-if="!projectGroups.length"
            :title="$t('workspace.noProjects')"
            :description="$t('workspace.dropProjectHint')"
            :icon="FolderOpen"
          />

          <div
            v-for="(group, groupIndex) in projectGroups"
            :key="group.projectKey"
            :data-testid="`workspace-project-group-${groupIndex}`"
            class="mb-2"
          >
            <div
              class="group flex h-8 items-center rounded-[var(--radius-sm)] px-1 text-[12.5px]"
              :data-testid="`workspace-project-${groupIndex}`"
              :class="
                isProjectActive(group)
                  ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              "
              @contextmenu="onProjectContextMenu(group, $event)"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                :title="group.projectRoot"
                :aria-expanded="
                  group.sessions.length ? !isProjectCollapsed(group.projectKey) : undefined
                "
                @click="openProjectGroup(group)"
              >
                <span class="flex size-5 shrink-0 items-center justify-center">
                  <ChevronRight
                    v-if="group.sessions.length && isProjectCollapsed(group.projectKey)"
                    class="size-3"
                    :stroke-width="1.75"
                  />
                  <ChevronDown
                    v-else-if="group.sessions.length"
                    class="size-3"
                    :stroke-width="1.75"
                  />
                </span>
                <Folder class="size-3.5 shrink-0" :stroke-width="1.7" />
                <span class="min-w-0 flex-1 truncate font-medium">
                  {{ group.name }}
                </span>
              </button>
              <Pin
                v-if="workspace.isProjectPinned(group.projectKey)"
                class="mr-1 size-3 shrink-0 text-[var(--text-tertiary)]"
                :stroke-width="1.75"
              />
              <button
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--accent-tint-strong)] hover:text-[var(--accent)]"
                :title="$t('workspace.newSession')"
                :aria-label="`${$t('workspace.newSession')}: ${group.name}`"
                :data-testid="`workspace-new-project-session-${groupIndex}`"
                @click.stop="newSessionFromProject(group)"
              >
                <Plus class="size-3.5" :stroke-width="1.75" />
              </button>
            </div>

            <div v-if="!isProjectCollapsed(group.projectKey)" class="ml-10 pl-1">
              <div v-for="session in group.sessions" :key="session.id" class="mb-1">
                <div
                  :data-testid="`session-row-${session.id}`"
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
                    v-if="sessionFolders(session).length > 1"
                    type="button"
                    class="flex size-6 shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                    :aria-label="
                      isCollapsed(session.id)
                        ? $t('workspace.expandProject')
                        : $t('workspace.collapseProject')
                    "
                    @click.stop="toggleSession(session.id)"
                  >
                    <ChevronRight
                      v-if="isCollapsed(session.id)"
                      class="size-3"
                      :stroke-width="1.75"
                    />
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
                    <span class="min-w-0 flex-1 truncate">{{ sessionTitle(session) }}</span>
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
                </div>

                <div
                  v-if="sessionFolders(session).length > 1 && !isCollapsed(session.id)"
                  class="ml-5 border-l border-[var(--border-subtle)] pl-2"
                >
                  <div
                    v-for="(folder, index) in sessionFolders(session)"
                    :key="folder.id"
                    :data-testid="`session-project-${session.id}-${index}`"
                    class="flex h-7 cursor-default items-center gap-1.5 pr-1 text-[11.5px] text-[var(--text-tertiary)]"
                    @contextmenu="onFolderContextMenu(session, folder, $event)"
                  >
                    <Folder class="size-3.5 shrink-0 opacity-80" :stroke-width="1.7" />
                    <span class="min-w-0 flex-1 truncate" :title="folder.resolvedPath">{{
                      folder.name
                    }}</span>
                    <span v-if="index === 0" class="text-[9.5px] text-[var(--text-tertiary)]">
                      {{ $t('workspace.primaryProject') }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <WorktreeSwitcher v-else-if="section === 'git' && canShowSessionGit" />
      <div v-else-if="section === 'git'" data-testid="workspace-git-unavailable" class="p-3">
        <EmptyState
          :title="$t('workspace.noSessions')"
          :description="$t('workspace.gitRequiresSession')"
          :icon="MessageSquare"
        />
      </div>
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

    <ProjectWorkspaceDialog
      v-if="editingProject"
      v-model:name="editingName"
      :open="true"
      :folders="editingFolders"
      :saving="savingSessionFolders"
      @update:open="(open) => !open && !savingSessionFolders && (editingProject = null)"
      @add="addEditingFolder"
      @remove="removeEditingFolder"
      @save="saveEditingFolders"
    />
    <RenameDialog
      v-if="renaming"
      v-model:name="renameValue"
      :open="true"
      :title="
        $t(renaming.session ? 'workspace.renameSessionTitle' : 'workspace.renameProjectTitle')
      "
      :saving="renameSaving"
      @update:open="(open) => !open && !renameSaving && (renaming = null)"
      @save="saveRename"
    />
    <Dialog
      v-if="branchingProject"
      :open="true"
      :title="$t('workspace.createBranchTitle')"
      :description="$t('workspace.createBranchHint', { name: branchingProject.name })"
      @update:open="(open) => !open && !branchSaving && (branchingProject = null)"
    >
      <form id="project-branch-form" @submit.prevent="createProjectBranch">
        <Input
          v-model="branchName"
          :label="$t('workspace.branchName')"
          :disabled="branchSaving"
          data-testid="project-branch-name"
        />
      </form>
      <template #footer>
        <Button variant="ghost" :disabled="branchSaving" @click="branchingProject = null">
          <span>{{ $t('common.cancel') }}</span>
        </Button>
        <Button
          variant="primary"
          type="submit"
          form="project-branch-form"
          :disabled="!branchName.trim()"
          :loading="branchSaving"
        >
          <span>{{ $t('common.create') }}</span>
        </Button>
      </template>
    </Dialog>
  </aside>
</template>
