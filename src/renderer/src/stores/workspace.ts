import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type {
  AgentImageAttachment,
  FileTreeEntry,
  GitStatusResponse,
  WorkspaceTab
} from '@shared/types/workspace'
import { isPathWithinProjectRoots, projectIdentityKey } from '@shared/workspace/project-identity'
import { mergeWorkspaceProjects } from '@shared/workspace/session-tree'
import { MAX_ATTACHED_IMAGES } from '@shared/workspace/image-attachments'
import { callApi, getApi } from '@renderer/composables/useApi'
import { useSessionStore } from './sessions'

const STORAGE_KEY = 'pi-harness.workspace.v1'

interface WorkspaceSnapshot {
  projectKey: string | null
  pickedCwd: string | null
  projectRoots?: string[]
  pinnedProjectKeys?: string[]
  pinnedSessionIds?: string[]
  archivedSessionIds?: string[]
  removedProjectKeys?: string[]
  tabs: WorkspaceTab[]
  activeTabId: string | null
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
  const drafts = ref<Record<string, string>>({})
  const draftImageMap = ref<Record<string, ChatDraftImage[]>>({})
  const fileEditBuffers = ref<Record<string, FileEditBuffer>>({})
  const files = shallowRef<FileTreeEntry[]>([])
  const gitStatus = shallowRef<GitStatusResponse | null>(null)
  const filesLoading = ref(false)
  const gitLoading = ref(false)
  const sidebarWidth = ref(260)
  const pickedCwd = ref<string | null>(null)
  const projectRoots = ref<string[]>([])
  const pinnedProjectKeys = ref<string[]>([])
  const pinnedSessionIds = ref<string[]>([])
  const archivedSessionIds = ref<string[]>([])
  const removedProjectKeys = ref<string[]>([])
  const listedPath = ref<string | null>(null)
  const contentRevision = ref(0)
  const hydrated = ref(false)
  let filesLoadVersion = 0
  let gitLoadVersion = 0

  const sessions = useSessionStore()

  const projects = computed(() => {
    const pinnedProjects = new Set(pinnedProjectKeys.value)
    const pinnedSessions = new Set(pinnedSessionIds.value)
    const archivedSessions = new Set(archivedSessionIds.value)
    const removedProjects = new Set(removedProjectKeys.value)
    return mergeWorkspaceProjects(projectRoots.value, sessions.projects)
      .filter((project) => !removedProjects.has(project.projectKey))
      .map((project) => ({
        ...project,
        sessions: project.sessions
          .filter((session) => !archivedSessions.has(session.id))
          .map((session, index) => ({ session, index }))
          .sort(
            (a, b) =>
              Number(pinnedSessions.has(b.session.id)) - Number(pinnedSessions.has(a.session.id)) ||
              a.index - b.index
          )
          .map(({ session }) => session)
      }))
      .map((project, index) => ({ project, index }))
      .sort(
        (a, b) =>
          Number(pinnedProjects.has(b.project.projectKey)) -
            Number(pinnedProjects.has(a.project.projectKey)) || a.index - b.index
      )
      .map(({ project }) => project)
  })

  const currentCwd = computed(
    () => sessions.current?.cwd ?? pickedCwd.value ?? sessions.currentProject?.projectRoot ?? null
  )
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
  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null)
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
    if (!canChat.value) return false
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
    const id = `file:${filePath}`
    if (!tabs.value.some((t) => t.id === id)) {
      tabs.value = [...tabs.value, { id, kind: 'file', title, filePath, closable: true }]
    }
    activeTabId.value = id
  }

  function openDiffTab(filePath: string, title: string) {
    const id = `diff:${filePath}`
    if (!tabs.value.some((t) => t.id === id)) {
      tabs.value = [...tabs.value, { id, kind: 'diff', title, filePath, closable: true }]
    }
    activeTabId.value = id
  }

  function closeTab(id: string) {
    const index = tabs.value.findIndex((t) => t.id === id)
    if (index === -1) return
    const next = tabs.value.filter((t) => t.id !== id)
    tabs.value = next
    if (activeTabId.value === id) {
      const fallbackId = next[Math.max(0, index - 1)]?.id ?? null
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
    activeTabId.value = id
    if (tab.kind === 'chat') {
      sessions.selectSession(tab.sessionId && tab.sessionId !== 'new' ? tab.sessionId : null)
    }
  }

  async function loadFiles(dir?: string) {
    const version = ++filesLoadVersion
    const cwd = dir ?? currentCwd.value
    if (!cwd) {
      files.value = []
      listedPath.value = null
      filesLoading.value = false
      return
    }
    filesLoading.value = true
    try {
      const next = await callApi(() => getApi().files.list(cwd))
      if (version !== filesLoadVersion) return
      files.value = next
      listedPath.value = cwd
    } catch {
      if (version !== filesLoadVersion) return
      files.value = []
      listedPath.value = null
    } finally {
      if (version === filesLoadVersion) filesLoading.value = false
    }
  }

  function persist() {
    if (!hydrated.value) return
    try {
      const snap: WorkspaceSnapshot = {
        projectKey: sessions.currentProjectKey,
        pickedCwd: pickedCwd.value,
        projectRoots: projectRoots.value,
        pinnedProjectKeys: pinnedProjectKeys.value,
        pinnedSessionIds: pinnedSessionIds.value,
        archivedSessionIds: archivedSessionIds.value,
        removedProjectKeys: removedProjectKeys.value,
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
    if (!existing) projectRoots.value = [...projectRoots.value, dir]
    removedProjectKeys.value = removedProjectKeys.value.filter((key) => key !== projectKey)
    pickedCwd.value = projectRoot
    persist()
    return projectRoot
  }

  async function restore(opts: { restoreTabs: boolean; autoOpenLastProject: boolean }) {
    let snap: WorkspaceSnapshot | null = null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      snap = raw ? (JSON.parse(raw) as WorkspaceSnapshot) : null
    } catch {
      snap = null
    }
    if (!snap) {
      hydrated.value = true
      return
    }
    const restoredRemovedProjectKeys = stringList(snap.removedProjectKeys)
    const removedProjects = new Set(restoredRemovedProjectKeys)
    const restoredRoots = [...(Array.isArray(snap.projectRoots) ? snap.projectRoots : [])].filter(
      (root) => !removedProjects.has(projectIdentityKey(root))
    )
    if (
      snap.pickedCwd &&
      !removedProjects.has(projectIdentityKey(snap.pickedCwd)) &&
      !restoredRoots.some(
        (root) => projectIdentityKey(root) === projectIdentityKey(snap.pickedCwd!)
      )
    ) {
      restoredRoots.push(snap.pickedCwd)
    }
    projectRoots.value = restoredRoots
    pinnedProjectKeys.value = stringList(snap.pinnedProjectKeys)
    pinnedSessionIds.value = stringList(snap.pinnedSessionIds)
    archivedSessionIds.value = stringList(snap.archivedSessionIds)
    removedProjectKeys.value = restoredRemovedProjectKeys
    await Promise.allSettled(
      restoredRoots.map((root) => callApi(() => getApi().workspace.allowRoot(root)))
    )
    if (opts.autoOpenLastProject) {
      if (snap.pickedCwd && !removedProjects.has(projectIdentityKey(snap.pickedCwd))) {
        pickedCwd.value = snap.pickedCwd
      }
      /* 上次未选中项目时也显式清空，避免 sessions.refresh 的自动选中残留。 */
      const projectKey =
        snap.projectKey && !removedProjects.has(snap.projectKey) ? snap.projectKey : null
      sessions.selectProjectKey(projectKey)
    }
    if (opts.restoreTabs && snap.tabs?.length) {
      const archived = new Set(archivedSessionIds.value)
      tabs.value = snap.tabs.filter(
        (tab) => tab.kind !== 'chat' || !tab.sessionId || !archived.has(tab.sessionId)
      )
      activeTabId.value = snap.activeTabId
      pruneOrphanedProjectTabs()
      if (!tabs.value.some((tab) => tab.id === activeTabId.value)) {
        activeTabId.value = tabs.value.at(-1)?.id ?? null
      }
      if (activeTabId.value) activateTab(activeTabId.value)
    }
    hydrated.value = true
    persist()
  }

  watch(
    [
      tabs,
      activeTabId,
      pickedCwd,
      projectRoots,
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
      .filter((session) => sessionProjectKey(session) === projectKey)
      .map((session) => session.id)
    const ids = new Set(sessionIds)
    archivedSessionIds.value = stringList([...archivedSessionIds.value, ...sessionIds])
    pinnedSessionIds.value = pinnedSessionIds.value.filter((id) => !ids.has(id))
    closeSessionTabs(ids)
    if (sessions.currentId && ids.has(sessions.currentId)) sessions.selectSession(null)
    persist()
  }

  function removeProject(projectKey: string) {
    const sessionIds = new Set(
      sessions.items
        .filter((session) => sessionProjectKey(session) === projectKey)
        .map((session) => session.id)
    )
    const removingCurrentProject = sessions.currentProjectKey === projectKey
    projectRoots.value = projectRoots.value.filter(
      (projectRoot) => projectIdentityKey(projectRoot) !== projectKey
    )
    pinnedProjectKeys.value = pinnedProjectKeys.value.filter((key) => key !== projectKey)
    removedProjectKeys.value = stringList([...removedProjectKeys.value, projectKey])
    closeSessionTabs(sessionIds, removingCurrentProject)
    if (removingCurrentProject) {
      sessions.selectSession(null)
      sessions.selectProjectKey(null)
    }
    if (pickedCwd.value && projectIdentityKey(pickedCwd.value) === projectKey) {
      pickedCwd.value = null
    }
    pruneOrphanedProjectTabs()
    persist()
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
    const availableProjects = projects.value
    const availableProjectKeys = new Set(availableProjects.map((project) => project.projectKey))
    const availableRoots = availableProjects.map((project) => project.projectRoot)
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
      if (tab.kind !== 'chat') continue
      if (tab.sessionId === 'new') {
        if (!currentCwd.value || !isPathWithinProjectRoots(currentCwd.value, availableRoots)) {
          removedTabIds.add(tab.id)
        }
        continue
      }
      if (tab.sessionId) {
        const session = sessions.items.find((item) => item.id === tab.sessionId)
        if (session && !availableProjectKeys.has(sessionProjectKey(session))) {
          removedTabIds.add(tab.id)
        }
      }
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
      const fallbackId = tabs.value.at(-1)?.id
      if (fallbackId) activateTab(fallbackId)
      else activeTabId.value = null
    }
  }

  function sessionProjectKey(session: { projectKey?: string; projectRoot?: string; cwd: string }) {
    return session.projectKey || projectIdentityKey(session.projectRoot || session.cwd)
  }

  async function loadGit() {
    const version = ++gitLoadVersion
    const cwd = currentCwd.value
    if (!cwd) {
      gitStatus.value = null
      gitLoading.value = false
      return
    }
    gitLoading.value = true
    try {
      const next = await callApi(() => getApi().git.status(cwd))
      if (version !== gitLoadVersion) return
      gitStatus.value = next
    } catch {
      if (version !== gitLoadVersion) return
      gitStatus.value = null
    } finally {
      if (version === gitLoadVersion) gitLoading.value = false
    }
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

  return {
    tabs,
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
    gitStatus,
    filesLoading,
    gitLoading,
    sidebarWidth,
    currentCwd,
    canChat,
    pickedCwd,
    projectRoots,
    projects,
    pinnedProjectKeys,
    pinnedSessionIds,
    archivedSessionIds,
    removedProjectKeys,
    listedPath,
    contentRevision,
    setPickedCwd,
    addProjectRoot,
    isProjectPinned,
    setProjectPinned,
    isSessionPinned,
    setSessionPinned,
    archiveSession,
    archiveProjectSessions,
    removeProject,
    dirtyFilePathsAfterProjectRemoval,
    restore,
    ensureChatTab,
    openFileTab,
    openDiffTab,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    closeTabsToLeft,
    closeAllTabs,
    activateTab,
    loadFiles,
    loadGit,
    refreshContent,
    addDraftImages,
    removeDraftImage,
    clearDraft,
    ensureFileEditBuffer,
    updateFileEditBuffer,
    markFileSaved,
    discardFileEditBuffer,
    isFileDirty
  }
})

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(value.filter((item): item is string => typeof item === 'string' && item !== ''))
  ]
}
