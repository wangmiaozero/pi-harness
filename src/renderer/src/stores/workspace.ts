import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type {
  AgentImageAttachment,
  FileSearchHit,
  FileSearchScope,
  FileTreeEntry,
  GitRepositoryStatus,
  GitStatusResponse,
  RecentWorkspace,
  SessionInfo,
  SessionProjectGroup,
  SessionWorkspaceBinding,
  WorkspaceFolder,
  WorkspaceFolderRole,
  WorkspaceTab
} from '@shared/types/workspace'
import { isPathWithinProjectRoots, projectIdentityKey } from '@shared/workspace/project-identity'
import { findContainingWorkspaceFolder } from '@shared/workspace/workspace-permission'
import {
  groupSessionsByProject,
  mergeWorkspaceProjects,
  projectDisplayName
} from '@shared/workspace/session-tree'
import { MAX_ATTACHED_IMAGES } from '@shared/workspace/image-attachments'
import { callApi, getApi } from '@renderer/composables/useApi'
import { useSessionStore } from './sessions'

const STORAGE_KEY = 'pi-harness.workspace.v1'

interface WorkspaceSnapshot {
  projectKey: string | null
  pickedCwd: string | null
  projectRoots?: string[]
  draftProjectRoots?: string[]
  importedProjectRoots?: string[]
  projectSettings?: Record<string, ProjectSettings>
  pinnedProjectKeys?: string[]
  pinnedSessionIds?: string[]
  archivedSessionIds?: string[]
  removedProjectKeys?: string[]
  workspaceFile?: string | null
  draftWorkspaceFile?: string | null
  folderMeta?: Record<string, FolderMeta>
  draftFolderMeta?: Record<string, FolderMeta>
  recentWorkspaces?: RecentWorkspace[]
  tabs: WorkspaceTab[]
  activeTabId: string | null
}

interface FolderMeta {
  role?: WorkspaceFolderRole
  readonly?: boolean
  name?: string
  exists?: boolean
}

interface ProjectSettings {
  name: string
  roots: string[]
}

export interface ChatDraftImage extends AgentImageAttachment {
  id: string
  name: string
  size: number
}

export interface FileEditBuffer {
  content: string
  savedContent: string
  revision: string
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const tabs = ref<WorkspaceTab[]>([])
  const activeTabId = ref<string | null>(null)
  const activeFileTabId = ref<string | null>(null)
  const filePanelOpen = ref(false)
  const drafts = ref<Record<string, string>>({})
  const draftImageMap = ref<Record<string, ChatDraftImage[]>>({})
  const fileEditBuffers = ref<Record<string, FileEditBuffer>>({})
  const files = shallowRef<FileTreeEntry[]>([])
  const fileChildren = shallowRef<Record<string, FileTreeEntry[]>>({})
  const gitStatus = shallowRef<GitStatusResponse | null>(null)
  const gitStatuses = shallowRef<GitRepositoryStatus[]>([])
  const selectedGitFolderId = ref<string | null>(null)
  const gitRevision = ref(0)
  const filesLoading = ref(false)
  const gitLoading = ref(false)
  const sidebarWidth = ref(260)
  const pickedCwd = ref<string | null>(null)
  const projectRoots = ref<string[]>([])
  const draftProjectRoots = ref<string[]>([])
  // Navigation entries are independent of the selected session's file/Git roots.
  const importedProjectRoots = ref<string[]>([])
  const projectSettings = ref<Record<string, ProjectSettings>>({})
  const draftSessionVisible = ref(false)
  const workspaceFile = ref<string | null>(null)
  const draftWorkspaceFile = ref<string | null>(null)
  const folderMeta = ref<Record<string, FolderMeta>>({})
  const draftFolderMeta = ref<Record<string, FolderMeta>>({})
  const sessionBindings = ref<Record<string, SessionWorkspaceBinding>>({})
  const activeSessionWorkspaceId = ref<string | null>(null)
  const recentWorkspaces = ref<RecentWorkspace[]>([])
  const workspaceSettings = ref<Record<string, unknown>>({})
  const pinnedProjectKeys = ref<string[]>([])
  const pinnedSessionIds = ref<string[]>([])
  const archivedSessionIds = ref<string[]>([])
  const removedProjectKeys = ref<string[]>([])
  const listedPath = ref<string | null>(null)
  const contentRevision = ref(0)
  const hydrated = ref(false)
  let filesLoadVersion = 0
  let fileScopeVersion = 0
  let gitLoadVersion = 0

  const sessions = useSessionStore()

  const projects = computed(() => {
    const current = activeSessionWorkspaceId.value
      ? sessions.items.find((session) => session.id === activeSessionWorkspaceId.value)
      : null
    return projectRoots.value.map((projectRoot) => {
      const projectKey = projectIdentityKey(projectRoot)
      return {
        projectKey,
        projectRoot,
        name: projectDisplayName(projectRoot),
        sessions:
          current && sessionFolders(current).some((folder) => folder.id === projectKey)
            ? [current]
            : []
      }
    })
  })

  const workspaceFolders = computed<WorkspaceFolder[]>(() => {
    const folders = projects.value.map((project, index) => {
      const meta = folderMeta.value[project.projectKey] ?? {}
      return {
        id: project.projectKey,
        name: meta.name || project.name,
        path: project.projectRoot,
        resolvedPath: project.projectRoot,
        role: meta.role ?? (index === 0 ? 'main' : 'reference'),
        readonly: meta.readonly === true,
        exists: meta.exists !== false
      } satisfies WorkspaceFolder
    })
    const mainIndex = folders.findIndex((folder) => folder.role === 'main')
    if (mainIndex > 0) {
      return folders.map((folder, index) =>
        index === mainIndex
          ? folder
          : { ...folder, role: folder.role === 'main' ? 'reference' : folder.role }
      )
    }
    if (folders.length && mainIndex === -1) {
      return folders.map((folder, index) => ({
        ...folder,
        role: index === 0 ? 'main' : folder.role
      }))
    }
    return folders
  })
  const draftWorkspaceFolders = computed<WorkspaceFolder[]>(() =>
    draftProjectRoots.value.map((projectRoot, index) => {
      const id = projectIdentityKey(projectRoot)
      const meta = draftFolderMeta.value[id] ?? {}
      return {
        id,
        name: meta.name || projectDisplayName(projectRoot),
        path: projectRoot,
        resolvedPath: projectRoot,
        role: index === 0 ? 'main' : (meta.role ?? 'reference'),
        readonly: meta.readonly === true,
        exists: meta.exists !== false
      }
    })
  )
  const hasDraftSession = computed(
    () => draftSessionVisible.value && draftWorkspaceFolders.value.length > 0
  )
  // All navigation projects shown in the Workspace sidebar. The Git view reads
  // the same list, so removing a project removes it from Git as well.
  const sessionProjectGroups = computed<SessionProjectGroup[]>(() => {
    const archived = new Set(archivedSessionIds.value)
    const grouped = groupSessionsByProject(
      sessions.items
        .filter((session) => !archived.has(session.id))
        .map((session, index) => ({ session, index }))
        .sort(
          (a, b) =>
            Number(isSessionPinned(b.session.id)) - Number(isSessionPinned(a.session.id)) ||
            a.index - b.index
        )
        .map(({ session }) => {
          const primary = sessionFolders(session)[0]
          return primary
            ? { ...session, projectRoot: primary.resolvedPath, projectKey: primary.id }
            : session
        })
    )
    return mergeWorkspaceProjects(importedProjectRoots.value, grouped)
      .filter((group) => !removedProjectKeys.value.includes(group.projectKey))
      .map((group) => ({
        ...group,
        name: projectSettings.value[group.projectKey]?.name || group.name,
        sessions: [...group.sessions].sort(
          (a, b) => Number(isSessionPinned(b.id)) - Number(isSessionPinned(a.id))
        )
      }))
      .sort(
        (a, b) =>
          Number(isProjectPinned(b.projectKey)) - Number(isProjectPinned(a.projectKey))
      )
  })
  // Every source root across all workspace projects, in stable project order.
  const gitRoots = computed(() => {
    const roots: Array<{ id: string; name: string; path: string }> = []
    const seen = new Set<string>()
    for (const group of sessionProjectGroups.value) {
      projectSourceRoots(group.projectRoot).forEach((root, index) => {
        if (!root) return
        const id = projectIdentityKey(root)
        if (seen.has(id)) return
        seen.add(id)
        roots.push({
          id,
          name: index === 0 ? group.name : projectDisplayName(root),
          path: root
        })
      })
    }
    return roots
  })
  const mainFolder = computed(
    () =>
      workspaceFolders.value.find((folder) => folder.role === 'main') ??
      workspaceFolders.value[0] ??
      null
  )
  const workspaceName = computed(() => {
    if (workspaceFile.value) {
      const base = workspaceFile.value.split(/[\\/]/).pop() ?? workspaceFile.value
      return base.endsWith('.code-workspace')
        ? base.slice(0, -'.code-workspace'.length) || base
        : base
    }
    return mainFolder.value?.name ?? null
  })
  const isMultiRoot = computed(() => workspaceFolders.value.length > 1)

  const currentCwd = computed(() => mainFolder.value?.resolvedPath ?? pickedCwd.value ?? null)
  const canChat = computed(() => {
    const cwd = currentCwd.value
    return Boolean(
      cwd &&
      isPathWithinProjectRoots(
        cwd,
        projects.value.map((project) => project.projectRoot)
      )
    )
  })
  const mainTabs = computed(() => tabs.value.filter((tab) => tab.kind !== 'file'))
  const activeTab = computed(() => mainTabs.value.find((t) => t.id === activeTabId.value) ?? null)
  const hasSessionWorkspace = computed(
    () =>
      Boolean(sessions.currentId && sessions.current) &&
      activeSessionWorkspaceId.value === sessions.currentId
  )
  const sessionFileTabs = computed(() =>
    hasSessionWorkspace.value
      ? tabs.value.filter((tab) => tab.kind === 'file' && Boolean(folderForPath(tab.filePath)))
      : []
  )
  const activeFileTab = computed(
    () =>
      sessionFileTabs.value.find((tab) => tab.id === activeFileTabId.value) ??
      sessionFileTabs.value.at(-1) ??
      null
  )
  const draftKey = computed(() => sessions.currentId ?? '__new__')
  const draft = computed({
    get: () => drafts.value[draftKey.value] ?? '',
    set: (value: string) => {
      drafts.value = { ...drafts.value, [draftKey.value]: value }
    }
  })
  const draftImages = computed(() => draftImageMap.value[draftKey.value] ?? [])
  const dirtyFilePaths = computed(() =>
    Object.entries(fileEditBuffers.value)
      .filter(([, buffer]) => buffer.content !== buffer.savedContent)
      .map(([filePath]) => filePath)
  )
  const hasDirtyFiles = computed(() => dirtyFilePaths.value.length > 0)

  function ensureFileEditBuffer(
    filePath: string,
    content: string,
    revision: string
  ): FileEditBuffer {
    const existing = fileEditBuffers.value[filePath]
    const dirty = existing?.content !== existing?.savedContent
    if (!existing || (!dirty && existing.revision !== revision)) {
      fileEditBuffers.value = {
        ...fileEditBuffers.value,
        [filePath]: { content, savedContent: content, revision }
      }
    }
    return fileEditBuffers.value[filePath]
  }

  function updateFileEditBuffer(filePath: string, content: string) {
    const existing = fileEditBuffers.value[filePath]
    if (!existing || existing.content === content) return
    fileEditBuffers.value = {
      ...fileEditBuffers.value,
      [filePath]: { ...existing, content }
    }
  }

  function markFileSaved(filePath: string, content: string, revision: string) {
    fileEditBuffers.value = {
      ...fileEditBuffers.value,
      [filePath]: { content, savedContent: content, revision }
    }
  }

  function discardFileEditBuffer(filePath: string) {
    if (!fileEditBuffers.value[filePath]) return
    const next = { ...fileEditBuffers.value }
    delete next[filePath]
    fileEditBuffers.value = next
  }

  function isFileDirty(filePath?: string | null): boolean {
    if (!filePath) return false
    const buffer = fileEditBuffers.value[filePath]
    return Boolean(buffer && buffer.content !== buffer.savedContent)
  }

  function addDraftImages(images: ChatDraftImage[]) {
    if (!images.length) return
    draftImageMap.value = {
      ...draftImageMap.value,
      [draftKey.value]: [...draftImages.value, ...images].slice(0, MAX_ATTACHED_IMAGES)
    }
  }

  function removeDraftImage(id: string) {
    const nextImages = draftImages.value.filter((image) => image.id !== id)
    draftImageMap.value = { ...draftImageMap.value, [draftKey.value]: nextImages }
  }

  function ensureChatTab(sessionId: string, title: string) {
    if (sessionId === 'new' && !canChat.value) return false
    const id = `chat:${sessionId}`
    if (!tabs.value.some((t) => t.id === id)) {
      tabs.value = [
        ...tabs.value,
        { id, kind: 'chat', title, sessionId, closable: tabs.value.length > 0 }
      ]
    }
    activateTab(id)
    return true
  }

  function openFileTab(filePath: string, title: string) {
    if (!hasSessionWorkspace.value || !folderForPath(filePath)) return
    const id = `file:${filePath}`
    const folder = folderForPath(filePath)
    const tabTitle =
      isMultiRoot.value && folder && !title.includes('/') ? `${folder.name}/${title}` : title
    if (!tabs.value.some((t) => t.id === id)) {
      tabs.value = [...tabs.value, { id, kind: 'file', title: tabTitle, filePath, closable: true }]
    }
    activeFileTabId.value = id
    filePanelOpen.value = true
  }

  function openDiffTab(filePath: string, title: string) {
    const id = `diff:${filePath}`
    if (!tabs.value.some((t) => t.id === id)) {
      tabs.value = [...tabs.value, { id, kind: 'diff', title, filePath, closable: true }]
    }
    activeTabId.value = id
  }

  function ensureHarnessTab(title: string) {
    const id = 'harness'
    if (!tabs.value.some((tab) => tab.id === id)) {
      tabs.value = [...tabs.value, { id, kind: 'harness', title, closable: true }]
    }
    activeTabId.value = id
  }

  function closeTab(id: string) {
    const index = tabs.value.findIndex((t) => t.id === id)
    if (index === -1) return
    const next = tabs.value.filter((t) => t.id !== id)
    tabs.value = next
    if (activeTabId.value === id) {
      const fallbackId =
        next
          .slice(0, index)
          .filter((tab) => tab.kind !== 'file')
          .at(-1)?.id ??
        mainTabs.value[0]?.id ??
        null
      if (fallbackId) activateTab(fallbackId)
      else activeTabId.value = null
    }
  }

  function closeOtherTabs(id: string) {
    const target = tabs.value.find((tab) => tab.id === id)
    if (!target) return
    tabs.value = [target]
    activateTab(target.id)
  }

  function closeTabsToRight(id: string) {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    if (index === -1) return
    replaceTabs(tabs.value.slice(0, index + 1), id)
  }

  function closeTabsToLeft(id: string) {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    if (index === -1) return
    replaceTabs(tabs.value.slice(index), id)
  }

  function closeAllTabs() {
    tabs.value = []
    activeTabId.value = null
  }

  function replaceTabs(next: WorkspaceTab[], fallbackId: string) {
    tabs.value = next
    if (!next.some((tab) => tab.id === activeTabId.value)) {
      const nextActiveId = next.find((tab) => tab.id === fallbackId)?.id ?? next.at(-1)?.id
      if (nextActiveId) activateTab(nextActiveId)
      else activeTabId.value = null
    }
  }

  function activateTab(id: string) {
    const tab = tabs.value.find((item) => item.id === id)
    if (!tab) return
    if (tab.kind === 'file') {
      if (sessionFileTabs.value.some((item) => item.id === id)) {
        activeFileTabId.value = id
        filePanelOpen.value = true
      }
      return
    }
    if (
      tab.kind === 'chat' &&
      tab.sessionId &&
      tab.sessionId !== 'new' &&
      !sessions.items.some((session) => session.id === tab.sessionId)
    ) {
      removeTabsById(new Set([tab.id]))
      if (sessions.currentId === tab.sessionId) sessions.selectSession(null)
      return
    }
    activeTabId.value = id
    if (tab.kind === 'chat') {
      sessions.selectSession(tab.sessionId && tab.sessionId !== 'new' ? tab.sessionId : null)
    }
  }

  async function loadFiles(dir?: string) {
    const version = ++filesLoadVersion
    const scopeVersion = fileScopeVersion
    const sessionId = sessions.currentId
    const isCurrent = () =>
      version === filesLoadVersion &&
      scopeVersion === fileScopeVersion &&
      sessionId === sessions.currentId &&
      hasSessionWorkspace.value
    if (!hasSessionWorkspace.value) {
      files.value = []
      fileChildren.value = {}
      filesLoading.value = false
      return
    }
    const cwd =
      dir ?? listedPath.value ?? currentCwd.value ?? mainFolder.value?.resolvedPath ?? null
    filesLoading.value = true
    try {
      const roots = workspaceFolders.value.filter((folder) => folder.exists)
      const rootEntries = await Promise.all(
        roots.map(async (folder) => {
          try {
            const entries = await callApi(() => getApi().files.list(folder.resolvedPath))
            return [
              folder.resolvedPath,
              entries.map((entry) => ({ ...entry, workspaceFolderId: folder.id }))
            ] as const
          } catch {
            return [folder.resolvedPath, [] as FileTreeEntry[]] as const
          }
        })
      )
      if (!isCurrent()) return
      const nextChildren = { ...fileChildren.value }
      for (const [root, entries] of rootEntries) nextChildren[root] = entries
      if (cwd && folderForPath(cwd)) {
        const already = roots.some(
          (folder) => projectIdentityKey(folder.resolvedPath) === projectIdentityKey(cwd)
        )
        if (!already) {
          try {
            const listed = await callApi(() => getApi().files.list(cwd))
            const folder = folderForPath(cwd)
            nextChildren[cwd] = listed.map((entry) => ({
              ...entry,
              workspaceFolderId: folder?.id
            }))
          } catch {
            nextChildren[cwd] = []
          }
        }
        if (!isCurrent()) return
        files.value = nextChildren[cwd] ?? []
        listedPath.value = cwd
      } else {
        files.value = []
        listedPath.value = null
      }
      fileChildren.value = nextChildren
    } catch {
      if (!isCurrent()) return
      files.value = []
      listedPath.value = null
    } finally {
      if (version === filesLoadVersion) filesLoading.value = false
    }
  }

  async function loadDirectory(directory: string): Promise<FileTreeEntry[]> {
    const folder = folderForPath(directory)
    if (!hasSessionWorkspace.value || !folder) return []
    const version = fileScopeVersion
    const sessionId = sessions.currentId
    const listed = await callApi(() => getApi().files.list(directory))
    if (
      version !== fileScopeVersion ||
      sessionId !== sessions.currentId ||
      !hasSessionWorkspace.value
    )
      return []
    const entries = listed.map((entry) => ({ ...entry, workspaceFolderId: folder?.id }))
    fileChildren.value = { ...fileChildren.value, [directory]: entries }
    return entries
  }

  function persist() {
    if (!hydrated.value) return
    try {
      const snap: WorkspaceSnapshot = {
        projectKey: sessions.currentProjectKey,
        pickedCwd: activeSessionWorkspaceId.value ? null : pickedCwd.value,
        projectRoots: draftProjectRoots.value,
        draftProjectRoots: draftProjectRoots.value,
        importedProjectRoots: importedProjectRoots.value,
        projectSettings: projectSettings.value,
        pinnedProjectKeys: pinnedProjectKeys.value,
        pinnedSessionIds: pinnedSessionIds.value,
        archivedSessionIds: archivedSessionIds.value,
        removedProjectKeys: removedProjectKeys.value,
        workspaceFile: draftWorkspaceFile.value,
        draftWorkspaceFile: draftWorkspaceFile.value,
        folderMeta: draftFolderMeta.value,
        draftFolderMeta: draftFolderMeta.value,
        recentWorkspaces: recentWorkspaces.value,
        tabs: tabs.value,
        activeTabId: activeTabId.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap))
    } catch {
      /* quota / private mode */
    }
  }

  function setPickedCwd(dir: string | null) {
    pickedCwd.value = dir
    persist()
  }

  function addProjectRoot(dir: string): string {
    const projectKey = projectIdentityKey(dir)
    const existing = projectRoots.value.find((root) => projectIdentityKey(root) === projectKey)
    const projectRoot = existing ?? dir
    const isFirst = projectRoots.value.length === 0 && !existing
    if (!existing) projectRoots.value = [...projectRoots.value, dir]
    pickedCwd.value = projectRoot
    folderMeta.value = {
      ...folderMeta.value,
      [projectKey]: {
        ...folderMeta.value[projectKey],
        role: folderMeta.value[projectKey]?.role ?? (isFirst ? 'main' : 'reference')
      }
    }
    cacheActiveWorkspace()
    persist()
    void syncActiveWorkspace()
    return projectRoot
  }

  async function restore(opts: { restoreTabs: boolean; autoOpenLastProject: boolean }) {
    if (hydrated.value) {
      if (sessions.currentId) await restoreSessionWorkspace(sessions.currentId)
      else await restoreDraftWorkspace()
      return
    }
    let snap: WorkspaceSnapshot | null = null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      snap = raw ? (JSON.parse(raw) as WorkspaceSnapshot) : null
    } catch {
      snap = null
    }
    if (!snap) {
      hydrated.value = true
      try {
        sessionBindings.value = await callApi(() => getApi().workspace.listSessionBindings())
      } catch {
        sessionBindings.value = {}
      }
      await restoreDraftWorkspace()
      return
    }
    const restoredRemovedProjectKeys = stringList(snap.removedProjectKeys)
    importedProjectRoots.value = uniqueProjectRoots(stringList(snap.importedProjectRoots))
    projectSettings.value = Object.fromEntries(
      Object.entries(snap.projectSettings ?? {}).flatMap(([key, value]) => {
        if (!value || typeof value.name !== 'string') return []
        const roots = uniqueProjectRoots(stringList(value.roots))
        return roots.length ? [[key, { name: value.name.slice(0, 256), roots }]] : []
      })
    )
    // An unsent workspace is an ephemeral new-session draft. Never revive it
    // after startup as if the user had selected a project in this run.
    draftProjectRoots.value = []
    draftWorkspaceFile.value = null
    draftFolderMeta.value = {}
    draftSessionVisible.value = false
    recentWorkspaces.value = Array.isArray(snap.recentWorkspaces) ? snap.recentWorkspaces : []
    pinnedProjectKeys.value = stringList(snap.pinnedProjectKeys)
    pinnedSessionIds.value = stringList(snap.pinnedSessionIds)
    archivedSessionIds.value = stringList(snap.archivedSessionIds)
    removedProjectKeys.value = restoredRemovedProjectKeys
    try {
      sessionBindings.value = await callApi(() => getApi().workspace.listSessionBindings())
    } catch {
      sessionBindings.value = {}
    }
    if (opts.autoOpenLastProject && snap.projectKey) sessions.selectProjectKey(snap.projectKey)
    if (opts.restoreTabs && snap.tabs?.length) {
      const archived = new Set(archivedSessionIds.value)
      const availableSessionIds = new Set(sessions.items.map((session) => session.id))
      tabs.value = snap.tabs.filter(
        (tab) =>
          tab.kind !== 'chat' ||
          !tab.sessionId ||
          tab.sessionId === 'new' ||
          (availableSessionIds.has(tab.sessionId) && !archived.has(tab.sessionId))
      )
      activeTabId.value = snap.activeTabId
      pruneOrphanedProjectTabs()
      if (!tabs.value.some((tab) => tab.id === activeTabId.value)) {
        activeTabId.value = mainTabs.value.at(-1)?.id ?? null
      }
      if (activeTabId.value) activateTab(activeTabId.value)
    }
    hydrated.value = true
    if (sessions.currentId) await restoreSessionWorkspace(sessions.currentId)
    else await replaceActiveWorkspace([], null)
    persist()
  }

  watch(
    [
      tabs,
      activeTabId,
      pinnedProjectKeys,
      pinnedSessionIds,
      archivedSessionIds,
      removedProjectKeys,
      () => sessions.currentProjectKey
    ],
    persist
  )

  function isProjectPinned(projectKey: string): boolean {
    return pinnedProjectKeys.value.includes(projectKey)
  }

  function setProjectPinned(projectKey: string, pinned: boolean) {
    pinnedProjectKeys.value = pinned
      ? stringList([...pinnedProjectKeys.value, projectKey])
      : pinnedProjectKeys.value.filter((key) => key !== projectKey)
    persist()
  }

  function isSessionPinned(sessionId: string): boolean {
    return pinnedSessionIds.value.includes(sessionId)
  }

  function setSessionPinned(sessionId: string, pinned: boolean) {
    pinnedSessionIds.value = pinned
      ? stringList([...pinnedSessionIds.value, sessionId])
      : pinnedSessionIds.value.filter((id) => id !== sessionId)
    persist()
  }

  function archiveSession(sessionId: string) {
    archivedSessionIds.value = stringList([...archivedSessionIds.value, sessionId])
    pinnedSessionIds.value = pinnedSessionIds.value.filter((id) => id !== sessionId)
    closeSessionTabs(new Set([sessionId]))
    if (sessions.currentId === sessionId) sessions.selectSession(null)
    persist()
  }

  function archiveProjectSessions(projectKey: string) {
    const sessionIds = sessions.items
      .filter((session) => sessionFolders(session)[0]?.id === projectKey)
      .map((session) => session.id)
    const ids = new Set(sessionIds)
    archivedSessionIds.value = stringList([...archivedSessionIds.value, ...sessionIds])
    pinnedSessionIds.value = pinnedSessionIds.value.filter((id) => !ids.has(id))
    closeSessionTabs(ids)
    if (sessions.currentId && ids.has(sessions.currentId)) sessions.selectSession(null)
    persist()
  }

  function forgetSession(sessionId: string) {
    const nextBindings = { ...sessionBindings.value }
    delete nextBindings[sessionId]
    sessionBindings.value = nextBindings
    pinnedSessionIds.value = pinnedSessionIds.value.filter((id) => id !== sessionId)
    archivedSessionIds.value = archivedSessionIds.value.filter((id) => id !== sessionId)
    closeSessionTabs(new Set([sessionId]))
    if (sessions.currentId === sessionId) sessions.selectSession(null)
    persist()
  }

  function pruneUnavailableSessionTabs() {
    const availableSessionIds = new Set(sessions.items.map((session) => session.id))
    const removed = new Set(
      tabs.value
        .filter(
          (tab) =>
            tab.kind === 'chat' &&
            Boolean(tab.sessionId) &&
            tab.sessionId !== 'new' &&
            !availableSessionIds.has(tab.sessionId!)
        )
        .map((tab) => tab.id)
    )
    removeTabsById(removed)
    if (sessions.currentId && !availableSessionIds.has(sessions.currentId)) {
      sessions.selectSession(null)
    }
  }

  function removeProject(projectKey: string) {
    projectRoots.value = projectRoots.value.filter(
      (projectRoot) => projectIdentityKey(projectRoot) !== projectKey
    )
    pinnedProjectKeys.value = pinnedProjectKeys.value.filter((key) => key !== projectKey)
    const nextMeta = { ...folderMeta.value }
    delete nextMeta[projectKey]
    folderMeta.value = nextMeta
    if (pickedCwd.value && projectIdentityKey(pickedCwd.value) === projectKey) {
      pickedCwd.value = projectRoots.value[0] ?? null
    }
    pruneOrphanedProjectTabs()
    cacheActiveWorkspace()
    persist()
    void syncActiveWorkspace()
  }

  function dirtyFilePathsAfterProjectRemoval(projectKey: string): string[] {
    const remainingRoots = projects.value
      .filter((project) => project.projectKey !== projectKey)
      .map((project) => project.projectRoot)
    return [
      ...new Set(
        tabs.value
          .filter(
            (tab) =>
              tab.kind === 'file' &&
              tab.filePath &&
              !isPathWithinProjectRoots(tab.filePath, remainingRoots) &&
              isFileDirty(tab.filePath)
          )
          .map((tab) => tab.filePath!)
      )
    ]
  }

  function pruneOrphanedProjectTabs() {
    const availableRoots = projectRoots.value
    const removedTabIds = new Set<string>()
    const removedFilePaths = new Set<string>()

    for (const tab of tabs.value) {
      if (tab.kind === 'file' || tab.kind === 'diff') {
        if (!tab.filePath || !isPathWithinProjectRoots(tab.filePath, availableRoots)) {
          removedTabIds.add(tab.id)
          if (tab.filePath) removedFilePaths.add(tab.filePath)
        }
        continue
      }
      if (tab.kind === 'chat') {
        if (tab.sessionId === 'new' && !availableRoots.length) removedTabIds.add(tab.id)
        continue
      }
      if (tab.kind === 'harness') continue
    }

    if (!removedTabIds.size) return
    removedFilePaths.forEach(discardFileEditBuffer)
    removeTabsById(removedTabIds)
  }

  function closeSessionTabs(sessionIds: Set<string>, includeNew = false) {
    const removedTabIds = new Set(
      tabs.value
        .filter(
          (tab) =>
            tab.kind === 'chat' &&
            ((tab.sessionId && sessionIds.has(tab.sessionId)) ||
              (includeNew && tab.sessionId === 'new'))
        )
        .map((tab) => tab.id)
    )
    removeTabsById(removedTabIds)
  }

  function removeTabsById(removedTabIds: Set<string>) {
    if (!removedTabIds.size) return
    tabs.value = tabs.value.filter((tab) => !removedTabIds.has(tab.id))
    if (activeTabId.value && removedTabIds.has(activeTabId.value)) {
      const fallbackId = mainTabs.value.at(-1)?.id
      if (fallbackId) activateTab(fallbackId)
      else activeTabId.value = null
    }
  }

  async function loadGit() {
    const version = ++gitLoadVersion
    // Git is workspace-wide: every project in the navigation list is inspected,
    // not just the folders of the currently selected session.
    const roots = gitRoots.value
    const cwd = currentCwd.value
    if (!roots.length && !cwd) {
      gitStatus.value = null
      gitStatuses.value = []
      selectedGitFolderId.value = null
      gitLoading.value = false
      return
    }
    gitLoading.value = true
    try {
      const cwds = roots.length ? roots.map((root) => root.path) : cwd ? [cwd] : []
      const next = await callApi(() => getApi().git.statusMany(cwds))
      if (version !== gitLoadVersion) return
      gitStatuses.value = next.map((status, index) => ({
        ...status,
        folderId: roots[index]?.id ?? projectIdentityKey(cwds[index] ?? ''),
        folderName: roots[index]?.name ?? cwds[index] ?? '',
        branch: status.branch ?? null
      }))
      const selected = gitStatuses.value.find(
        (status) => status.folderId === selectedGitFolderId.value
      )
      const contextual = gitStatuses.value.find(
        (status) => status.folderId === folderForPath(cwd ?? '')?.id
      )
      gitStatus.value = selected ?? contextual ?? gitStatuses.value[0] ?? null
      selectedGitFolderId.value = gitStatus.value?.folderId ?? null
      gitRevision.value += 1
    } catch {
      if (version !== gitLoadVersion) return
      gitStatus.value = null
      gitStatuses.value = []
    } finally {
      if (version === gitLoadVersion) gitLoading.value = false
    }
  }

  function selectGitRepository(folderId: string): void {
    const selected = gitStatuses.value.find((status) => status.folderId === folderId)
    if (!selected) return
    selectedGitFolderId.value = folderId
    gitStatus.value = selected
    gitRevision.value += 1
  }

  async function refreshContent(directory?: string) {
    await Promise.all([loadFiles(directory ?? listedPath.value ?? undefined), loadGit()])
    contentRevision.value += 1
  }

  function clearDraft(sessionId: string) {
    const next = { ...drafts.value }
    delete next[sessionId]
    drafts.value = next
    const nextImages = { ...draftImageMap.value }
    delete nextImages[sessionId]
    draftImageMap.value = nextImages
  }

  function folderForPath(target: string | null | undefined): WorkspaceFolder | null {
    if (!target) return null
    return findContainingWorkspaceFolder(target, workspaceFolders.value)
  }

  // Workspace-wide resolution for Git surfaces: every navigation project,
  // not only the folders of the currently selected session.
  function gitFolderForPath(target: string | null | undefined): WorkspaceFolder | null {
    if (!target) return null
    const root = findContainingWorkspaceFolder(
      target,
      gitRoots.value.map((item) => ({ ...item, resolvedPath: item.path }))
    )
    return root
      ? {
          id: root.id,
          name: root.name,
          path: root.path,
          resolvedPath: root.path,
          role: 'main',
          readonly: false,
          exists: true
        }
      : null
  }

  function gitDisplayFilePath(target: string): string {
    const folder = gitFolderForPath(target)
    if (!folder) return target
    const relative = target.slice(folder.resolvedPath.length).replace(/^[\\/]+/, '')
    return relative ? `${folder.name}/${relative.replace(/\\/g, '/')}` : folder.name
  }

  function isPathReadonly(target: string | null | undefined): boolean {
    return folderForPath(target)?.readonly === true
  }

  function displayFilePath(target: string): string {
    const folder = folderForPath(target)
    if (!folder) return target
    const relative = target.slice(folder.resolvedPath.length).replace(/^[\\/]+/, '')
    return relative ? `${folder.name}/${relative.replace(/\\/g, '/')}` : folder.name
  }

  function setFolderRole(projectKey: string, role: WorkspaceFolderRole) {
    const next: Record<string, FolderMeta> = { ...folderMeta.value }
    if (role === 'main') {
      for (const [key, meta] of Object.entries(next)) {
        if (meta.role === 'main' && key !== projectKey) next[key] = { ...meta, role: 'reference' }
      }
    }
    next[projectKey] = { ...next[projectKey], role }
    folderMeta.value = next
    cacheActiveWorkspace()
    persist()
    void syncActiveWorkspace()
  }

  function setFolderReadonly(projectKey: string, readonly: boolean) {
    folderMeta.value = {
      ...folderMeta.value,
      [projectKey]: { ...folderMeta.value[projectKey], readonly }
    }
    cacheActiveWorkspace()
    persist()
    void syncActiveWorkspace()
  }

  async function syncActiveWorkspace() {
    const folders = workspaceFolders.value
    try {
      const active = await callApi(() =>
        getApi().workspace.sync({
          workspaceFile: workspaceFile.value,
          folders: folders.map((folder) => ({
            path: folder.path,
            resolvedPath: folder.resolvedPath,
            name: folder.name,
            role: folder.role,
            readonly: folder.readonly
          })),
          settings: workspaceSettings.value
        })
      )
      applyActiveWorkspace(active)
      cacheActiveWorkspace()
      if (activeSessionWorkspaceId.value) {
        await bindCurrentSession(activeSessionWorkspaceId.value)
      }
    } catch {
      /* main sync is best-effort during restore */
    }
  }

  function applyActiveWorkspace(active: {
    workspaceFile: string | null
    folders: WorkspaceFolder[]
    settings: Record<string, unknown>
    name: string
  }) {
    workspaceFile.value = active.workspaceFile
    workspaceSettings.value = active.settings ?? {}
    const nextMeta: Record<string, FolderMeta> = {}
    const nextRoots: string[] = []
    for (const folder of active.folders) {
      nextRoots.push(folder.resolvedPath)
      nextMeta[folder.id] = {
        role: folder.role,
        readonly: folder.readonly,
        name: folder.name,
        exists: folder.exists
      }
    }
    projectRoots.value = nextRoots
    folderMeta.value = nextMeta
    persist()
  }

  function cacheActiveWorkspace() {
    if (activeSessionWorkspaceId.value) {
      const sessionId = activeSessionWorkspaceId.value
      const folders = workspaceFolders.value
      sessionBindings.value = {
        ...sessionBindings.value,
        [sessionId]: {
          workspaceId: workspaceFile.value ?? `session:${sessionId}`,
          mainFolderId: folders[0]?.id,
          folders: folders.map((folder, index) => ({
            id: folder.id,
            path: folder.resolvedPath,
            role: index === 0 ? 'main' : 'reference',
            readonly: folder.readonly
          }))
        }
      }
      return
    }
    draftProjectRoots.value = [...projectRoots.value]
    draftWorkspaceFile.value = workspaceFile.value
    draftFolderMeta.value = { ...folderMeta.value }
  }

  async function replaceActiveWorkspace(
    folders: Array<{
      path: string
      name?: string
      role?: WorkspaceFolderRole
      readonly?: boolean
    }>,
    ownerId: string | null,
    nextWorkspaceFile: string | null = null
  ) {
    // The new owner must not observe the previous session's roots while sync is pending.
    activeSessionWorkspaceId.value = null
    fileScopeVersion += 1
    filesLoadVersion += 1
    files.value = []
    fileChildren.value = {}
    filesLoading.value = false
    const active = await callApi(() =>
      getApi().workspace.sync({
        workspaceFile: nextWorkspaceFile,
        folders: folders.map((folder, index) => ({
          path: folder.path,
          resolvedPath: folder.path,
          name: folder.name,
          role: folder.role ?? (index === 0 ? 'main' : 'reference'),
          readonly: folder.readonly
        })),
        settings: {}
      })
    )
    applyActiveWorkspace(active)
    activeSessionWorkspaceId.value = ownerId
    pickedCwd.value = active.folders[0]?.resolvedPath ?? null
    listedPath.value = pickedCwd.value
    files.value = []
    fileChildren.value = {}
    cacheActiveWorkspace()
    persist()
    return active
  }

  async function openWorkspaceFile(path: string) {
    const active = await callApi(() => getApi().workspace.openWorkspaceFile(path))
    applyActiveWorkspace(active)
    if (active.folders[0]?.resolvedPath) pickedCwd.value = active.folders[0].resolvedPath
    cacheActiveWorkspace()
    if (activeSessionWorkspaceId.value) await bindCurrentSession(activeSessionWorkspaceId.value)
    else draftSessionVisible.value = active.folders.length > 0
    persist()
    await Promise.all([loadFiles(), loadGit()])
    return active
  }

  async function importDraftWorkspaceFile(path: string, additionalRoots: string[] = []) {
    activeSessionWorkspaceId.value = null
    let active = await callApi(() => getApi().workspace.openWorkspaceFile(path))
    if (additionalRoots.length) {
      active = await callApi(() =>
        getApi().workspace.sync({
          workspaceFile: active.workspaceFile,
          folders: [
            ...active.folders.map((folder) => ({
              path: folder.path,
              resolvedPath: folder.resolvedPath,
              name: folder.name,
              role: folder.role,
              readonly: folder.readonly
            })),
            ...additionalRoots.map((root) => ({ path: root, role: 'reference' as const }))
          ],
          settings: active.settings
        })
      )
    }
    applyActiveWorkspace(active)
    pickedCwd.value = active.folders[0]?.resolvedPath ?? null
    listedPath.value = pickedCwd.value
    files.value = []
    fileChildren.value = {}
    cacheActiveWorkspace()
    draftSessionVisible.value = active.folders.length > 0
    persist()
    await Promise.all([loadFiles(), loadGit()])
    return active
  }

  async function saveWorkspaceAs(path: string) {
    const active = await callApi(() =>
      getApi().workspace.save({
        path,
        workspaceFile: workspaceFile.value,
        folders: workspaceFolders.value.map((folder) => ({
          path: folder.path,
          resolvedPath: folder.resolvedPath,
          name: folder.name,
          role: folder.role,
          readonly: folder.readonly
        })),
        settings: workspaceSettings.value
      })
    )
    applyActiveWorkspace(active)
    cacheActiveWorkspace()
    if (activeSessionWorkspaceId.value) await bindCurrentSession(activeSessionWorkspaceId.value)
    return active
  }

  async function searchFiles(
    query: string,
    scope: FileSearchScope = 'workspace',
    folderId?: string
  ): Promise<FileSearchHit[]> {
    if (!hasSessionWorkspace.value) return []
    const version = fileScopeVersion
    const sessionId = sessions.currentId
    const hits = await callApi(() => getApi().workspace.search(query, scope, folderId))
    return version === fileScopeVersion &&
      sessionId === sessions.currentId &&
      hasSessionWorkspace.value
      ? hits.filter((hit) => Boolean(folderForPath(hit.absolutePath)))
      : []
  }

  async function relocateFolder(folderId: string, nextPath: string) {
    const active = await callApi(() => getApi().workspace.relocateFolder(folderId, nextPath))
    applyActiveWorkspace(active)
    pickedCwd.value = nextPath
    cacheActiveWorkspace()
    if (activeSessionWorkspaceId.value) await bindCurrentSession(activeSessionWorkspaceId.value)
    persist()
    await Promise.all([loadFiles(), loadGit(), refreshRecent()])
    return active
  }

  async function openRecentWorkspace(item: RecentWorkspace) {
    if (item.workspaceFile) {
      await openWorkspaceFile(item.workspaceFile)
      await refreshRecent()
      return
    }
    for (const folderPath of item.folderPaths) {
      try {
        await callApi(() => getApi().workspace.allowRoot(folderPath))
      } catch {
        /* missing folders stay in the list as exists:false after sync */
      }
      addProjectRoot(folderPath)
    }
    await Promise.all([loadFiles(), loadGit(), refreshRecent()])
  }

  async function restoreSessionWorkspace(sessionId: string) {
    let binding: SessionWorkspaceBinding | null = sessionBindings.value[sessionId] ?? null
    try {
      if (!binding) {
        const persisted = await callApi(() => getApi().workspace.getSessionBinding(sessionId))
        binding = persisted
      }
    } catch {
      /* use the session cwd fallback below */
    }
    if (!binding?.folders.length) {
      const session = sessions.items.find((item) => item.id === sessionId)
      const root = session?.projectRoot || session?.cwd
      if (!root) {
        await replaceActiveWorkspace([], sessionId)
        return
      }
      const id = projectIdentityKey(root)
      binding = {
        workspaceId: `session:${sessionId}`,
        mainFolderId: id,
        folders: [{ id, path: root, role: 'main' }]
      }
    }
    for (const folder of binding.folders) {
      try {
        await callApi(() => getApi().workspace.allowRoot(folder.path))
      } catch {
        /* keep missing folders visible */
      }
    }
    const ordered = [...binding.folders].sort((a, b) =>
      a.id === binding?.mainFolderId ? -1 : b.id === binding?.mainFolderId ? 1 : 0
    )
    sessionBindings.value = { ...sessionBindings.value, [sessionId]: binding }
    await replaceActiveWorkspace(
      ordered.map((folder) => ({
        path: folder.path,
        role: folder.role,
        readonly: folder.readonly
      })),
      sessionId,
      binding.workspaceId.endsWith('.code-workspace') ? binding.workspaceId : null
    )
    await bindCurrentSession(sessionId)
  }

  async function restoreDraftWorkspace() {
    await replaceActiveWorkspace(
      draftProjectRoots.value.map((path) => ({
        path,
        name: draftFolderMeta.value[projectIdentityKey(path)]?.name,
        role: draftFolderMeta.value[projectIdentityKey(path)]?.role,
        readonly: draftFolderMeta.value[projectIdentityKey(path)]?.readonly
      })),
      null,
      draftWorkspaceFile.value
    )
  }

  async function resetDraftWorkspace(root: string) {
    await resetDraftWorkspaceRoots([root])
  }

  async function resetDraftWorkspaceRoots(roots: string[]) {
    const uniqueRoots = uniqueProjectRoots(roots)
    draftProjectRoots.value = uniqueRoots
    draftWorkspaceFile.value = null
    draftFolderMeta.value = Object.fromEntries(
      uniqueRoots.map((root, index) => [
        projectIdentityKey(root),
        { role: index === 0 ? 'main' : 'reference' } satisfies FolderMeta
      ])
    )
    draftSessionVisible.value = uniqueRoots.length > 0
    await restoreDraftWorkspace()
  }

  async function startDraftFromActiveWorkspace(): Promise<boolean> {
    const folders = workspaceFolders.value
    if (!folders.length) return false
    await replaceActiveWorkspace(
      folders.map((folder) => ({
        path: folder.resolvedPath,
        name: folder.name,
        role: folder.role,
        readonly: folder.readonly
      })),
      null,
      workspaceFile.value
    )
    draftSessionVisible.value = true
    return true
  }

  function markDraftSessionVisible() {
    draftSessionVisible.value = draftProjectRoots.value.length > 0
  }

  function rememberImportedProjects(roots: string[]) {
    importedProjectRoots.value = uniqueProjectRoots([...importedProjectRoots.value, ...roots])
    const keys = new Set(roots.map((root) => projectIdentityKey(root)))
    removedProjectKeys.value = removedProjectKeys.value.filter((key) => !keys.has(key))
    persist()
  }

  function rememberDraftProject() {
    const primary = draftWorkspaceFolders.value[0]
    if (!primary) return
    const savedName = projectSettings.value[primary.id]?.name
    const fileName = draftWorkspaceFile.value
      ?.split(/[\\/]/)
      .pop()
      ?.replace(/\.code-workspace$/i, '')
    // One imported workspace is one navigation project, with multiple source roots.
    saveProjectSettings(
      primary.resolvedPath,
      savedName || fileName || primary.name,
      draftProjectRoots.value
    )
  }

  function projectSourceRoots(root: string): string[] {
    const key = projectIdentityKey(root)
    const saved = projectSettings.value[key]
    if (saved) return [...saved.roots]
    if (draftWorkspaceFolders.value[0]?.id === key) return [...draftProjectRoots.value]
    const session = sessions.items.find((item) => sessionFolders(item)[0]?.id === key)
    return session ? sessionFolders(session).map((folder) => folder.resolvedPath) : [root]
  }

  function saveProjectSettings(root: string, name: string, roots: string[]) {
    const key = projectIdentityKey(root)
    projectSettings.value = {
      ...projectSettings.value,
      [key]: { name: name.trim().slice(0, 256), roots: uniqueProjectRoots([root, ...roots]) }
    }
    rememberImportedProjects([root])
  }

  async function startDraftFromProject(root: string) {
    const roots = projectSourceRoots(root)
    for (const source of roots) await callApi(() => getApi().workspace.allowRoot(source))
    await resetDraftWorkspaceRoots(roots)
  }

  async function removeProjectEntry(projectKey: string) {
    const ids = new Set(
      sessions.items
        .filter((session) => sessionFolders(session)[0]?.id === projectKey)
        .map((session) => session.id)
    )
    removedProjectKeys.value = stringList([...removedProjectKeys.value, projectKey])
    pinnedProjectKeys.value = pinnedProjectKeys.value.filter((key) => key !== projectKey)
    closeSessionTabs(ids)
    if (sessions.currentId && ids.has(sessions.currentId)) sessions.selectSession(null)
    await removeImportedProject(projectKey)
    // Removing a navigation entry also removes it from the workspace-wide Git view.
    if (!sessions.currentId) await restoreDraftWorkspace()
    await Promise.all([loadFiles(), loadGit()])
    persist()
  }

  async function removeImportedProject(projectKey: string) {
    importedProjectRoots.value = importedProjectRoots.value.filter(
      (root) => projectIdentityKey(root) !== projectKey
    )
    if (
      draftWorkspaceFolders.value[0]?.id === projectKey &&
      (projectSettings.value[projectKey]?.roots.length ?? 0) > 1
    ) {
      await discardDraftSession()
    } else if (draftProjectRoots.value.some((root) => projectIdentityKey(root) === projectKey)) {
      await removeDraftProject(projectKey)
    }
    persist()
  }

  async function discardDraftSession() {
    draftSessionVisible.value = false
    draftProjectRoots.value = []
    draftWorkspaceFile.value = null
    draftFolderMeta.value = {}
    closeTab('chat:new')
    if (activeSessionWorkspaceId.value === null) {
      await replaceActiveWorkspace([], null)
      await Promise.all([loadFiles(), loadGit()])
    } else {
      persist()
    }
  }

  async function removeDraftProject(projectKey: string) {
    draftProjectRoots.value = draftProjectRoots.value.filter(
      (root) => projectIdentityKey(root) !== projectKey
    )
    const nextMeta = { ...draftFolderMeta.value }
    delete nextMeta[projectKey]
    draftFolderMeta.value = nextMeta
    if (!draftProjectRoots.value.length) {
      await discardDraftSession()
      return
    }
    const firstKey = projectIdentityKey(draftProjectRoots.value[0])
    draftFolderMeta.value = {
      ...draftFolderMeta.value,
      [firstKey]: { ...draftFolderMeta.value[firstKey], role: 'main' }
    }
    if (activeSessionWorkspaceId.value === null) {
      await restoreDraftWorkspace()
      await Promise.all([loadFiles(), loadGit()])
    } else {
      persist()
    }
  }

  function consumeDraftSession() {
    draftSessionVisible.value = false
    draftProjectRoots.value = []
    draftWorkspaceFile.value = null
    draftFolderMeta.value = {}
    closeTab('chat:new')
    persist()
  }

  async function startDraftFromSession(sessionId: string): Promise<boolean> {
    await restoreSessionWorkspace(sessionId)
    return startDraftFromActiveWorkspace()
  }

  async function saveSessionFolders(
    sessionId: string,
    nextFolders: WorkspaceFolder[]
  ): Promise<boolean> {
    const folders = nextFolders.filter(
      (folder, index) =>
        nextFolders.findIndex(
          (candidate) =>
            projectIdentityKey(candidate.resolvedPath) === projectIdentityKey(folder.resolvedPath)
        ) === index
    )
    if (!folders.length) return false

    for (const folder of folders) {
      try {
        await callApi(() => getApi().workspace.allowRoot(folder.resolvedPath))
      } catch {
        /* existing bindings may intentionally retain a temporarily missing folder */
      }
    }

    const current = sessionBindings.value[sessionId]
    const snapshots = folders.map((folder, index) => ({
      id: projectIdentityKey(folder.resolvedPath),
      path: folder.resolvedPath,
      role: index === 0 ? ('main' as const) : ('reference' as const),
      readonly: folder.readonly
    }))
    const binding: SessionWorkspaceBinding = {
      workspaceId: current?.workspaceId ?? `session:${sessionId}`,
      mainFolderId: snapshots[0]?.id,
      folders: snapshots
    }

    await callApi(() =>
      getApi().workspace.bindSession(
        sessionId,
        binding.workspaceId,
        binding.folders,
        binding.mainFolderId
      )
    )
    sessionBindings.value = { ...sessionBindings.value, [sessionId]: binding }

    if (activeSessionWorkspaceId.value === sessionId) {
      await replaceActiveWorkspace(
        folders.map((folder, index) => ({
          path: folder.resolvedPath,
          name: folder.name,
          role: index === 0 ? 'main' : 'reference',
          readonly: folder.readonly
        })),
        sessionId,
        binding.workspaceId.endsWith('.code-workspace') ? binding.workspaceId : null
      )
      await bindCurrentSession(sessionId)
      await Promise.all([loadFiles(), loadGit()])
    }
    return true
  }

  async function bindCurrentSession(sessionId: string) {
    const folders = workspaceFolders.value
    if (!folders.length) return
    const main = mainFolder.value
    try {
      await callApi(() =>
        getApi().workspace.bindSession(
          sessionId,
          workspaceFile.value ?? `session:${sessionId}`,
          folders.map((folder, index) => ({
            id: folder.id,
            path: folder.resolvedPath,
            role: index === 0 ? 'main' : 'reference',
            readonly: folder.readonly
          })),
          main?.id
        )
      )
      sessionBindings.value = {
        ...sessionBindings.value,
        [sessionId]: {
          workspaceId: workspaceFile.value ?? `session:${sessionId}`,
          mainFolderId: main?.id,
          folders: folders.map((folder, index) => ({
            id: folder.id,
            path: folder.resolvedPath,
            role: index === 0 ? 'main' : 'reference',
            readonly: folder.readonly
          }))
        }
      }
    } catch {
      /* session binding is metadata; chatting must not fail if it is unavailable */
    }
  }

  async function refreshRecent() {
    try {
      recentWorkspaces.value = await callApi(() => getApi().workspace.listRecent())
    } catch {
      /* ignore */
    }
  }

  function sessionFolders(session: SessionInfo): WorkspaceFolder[] {
    const binding = sessionBindings.value[session.id]
    const snapshots: Array<{
      id: string
      path: string
      role: WorkspaceFolderRole
      readonly?: boolean
    }> = binding?.folders.length
      ? [...binding.folders].sort((a, b) =>
          a.id === binding.mainFolderId ? -1 : b.id === binding.mainFolderId ? 1 : 0
        )
      : [
          {
            id: projectIdentityKey(session.projectRoot || session.cwd),
            path: session.projectRoot || session.cwd,
            role: 'main' as const
          }
        ].filter((folder) => folder.path)
    return snapshots.map((folder, index) => ({
      id: folder.id || projectIdentityKey(folder.path),
      name: projectDisplayName(folder.path),
      path: folder.path,
      resolvedPath: folder.path,
      role: index === 0 ? 'main' : 'reference',
      readonly: folder.readonly === true,
      exists: true
    }))
  }

  async function refreshSessionBindings() {
    try {
      sessionBindings.value = await callApi(() => getApi().workspace.listSessionBindings())
    } catch {
      /* legacy builds fall back to each session cwd */
    }
  }

  return {
    tabs,
    mainTabs,
    activeFileTabId,
    activeFileTab,
    sessionFileTabs,
    filePanelOpen,
    hasSessionWorkspace,
    activeTabId,
    activeTab,
    drafts,
    draft,
    draftImages,
    draftKey,
    fileEditBuffers,
    dirtyFilePaths,
    hasDirtyFiles,
    files,
    fileChildren,
    gitStatus,
    gitStatuses,
    sessionProjectGroups,
    gitRoots,
    selectedGitFolderId,
    gitRevision,
    filesLoading,
    gitLoading,
    sidebarWidth,
    currentCwd,
    canChat,
    pickedCwd,
    projectRoots,
    draftProjectRoots,
    importedProjectRoots,
    draftSessionVisible,
    draftWorkspaceFolders,
    hasDraftSession,
    sessionBindings,
    activeSessionWorkspaceId,
    workspaceFile,
    workspaceFolders,
    workspaceName,
    mainFolder,
    isMultiRoot,
    recentWorkspaces,
    projects,
    pinnedProjectKeys,
    pinnedSessionIds,
    archivedSessionIds,
    removedProjectKeys,
    listedPath,
    contentRevision,
    setPickedCwd,
    addProjectRoot,
    resetDraftWorkspace,
    resetDraftWorkspaceRoots,
    startDraftFromActiveWorkspace,
    startDraftFromSession,
    markDraftSessionVisible,
    rememberImportedProjects,
    rememberDraftProject,
    projectSettings,
    projectSourceRoots,
    saveProjectSettings,
    startDraftFromProject,
    removeProjectEntry,
    removeImportedProject,
    discardDraftSession,
    removeDraftProject,
    consumeDraftSession,
    saveSessionFolders,
    isProjectPinned,
    setProjectPinned,
    isSessionPinned,
    setSessionPinned,
    archiveSession,
    archiveProjectSessions,
    forgetSession,
    pruneUnavailableSessionTabs,
    removeProject,
    dirtyFilePathsAfterProjectRemoval,
    restore,
    ensureChatTab,
    openFileTab,
    openDiffTab,
    ensureHarnessTab,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    closeTabsToLeft,
    closeAllTabs,
    activateTab,
    loadFiles,
    loadDirectory,
    loadGit,
    selectGitRepository,
    gitFolderForPath,
    gitDisplayFilePath,
    refreshContent,
    addDraftImages,
    removeDraftImage,
    clearDraft,
    ensureFileEditBuffer,
    updateFileEditBuffer,
    markFileSaved,
    discardFileEditBuffer,
    isFileDirty,
    folderForPath,
    isPathReadonly,
    displayFilePath,
    setFolderRole,
    setFolderReadonly,
    openWorkspaceFile,
    importDraftWorkspaceFile,
    saveWorkspaceAs,
    searchFiles,
    relocateFolder,
    openRecentWorkspace,
    restoreSessionWorkspace,
    restoreDraftWorkspace,
    bindCurrentSession,
    sessionFolders,
    refreshSessionBindings,
    refreshRecent,
    syncActiveWorkspace
  }
})

function uniqueProjectRoots(roots: string[]): string[] {
  const seen = new Set<string>()
  return roots.filter((root) => {
    const key = projectIdentityKey(root)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(value.filter((item): item is string => typeof item === 'string' && item !== ''))
  ]
}
