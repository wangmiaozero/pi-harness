import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import type { SessionInfo, SessionWorkspaceBinding, WorkspaceTab } from '@shared/types/workspace'
import { projectIdentityKey } from '@shared/workspace/project-identity'
import { useWorkspaceStore } from './workspace'
import { useSessionStore } from './sessions'

const tabs: WorkspaceTab[] = [
  { id: 'a', kind: 'diff', title: 'a.ts', filePath: '/a.ts', closable: true },
  { id: 'b', kind: 'diff', title: 'b.ts', filePath: '/b.ts', closable: true },
  { id: 'c', kind: 'diff', title: 'c.ts', filePath: '/c.ts', closable: true }
]

describe('workspace tab closing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('closes all tabs except the context target', () => {
    const store = createStore('c')
    store.closeOtherTabs('b')
    expect(store.tabs.map((tab) => tab.id)).toEqual(['b'])
    expect(store.activeTabId).toBe('b')
  })

  it('closes tabs to the right and activates the context target when needed', () => {
    const store = createStore('c')
    store.closeTabsToRight('b')
    expect(store.tabs.map((tab) => tab.id)).toEqual(['a', 'b'])
    expect(store.activeTabId).toBe('b')
  })

  it('closes tabs to the left and activates the context target when needed', () => {
    const store = createStore('a')
    store.closeTabsToLeft('b')
    expect(store.tabs.map((tab) => tab.id)).toEqual(['b', 'c'])
    expect(store.activeTabId).toBe('b')
  })

  it('closes every tab', () => {
    const store = createStore('b')
    store.closeAllTabs()
    expect(store.tabs).toEqual([])
    expect(store.activeTabId).toBeNull()
  })
})

describe('workspace tab activation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps the selected session in sync with the active chat tab', () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [
      session('session-a', '/code/a', '2026-01-01T00:00:00.000Z'),
      session('session-b', '/code/b', '2026-01-02T00:00:00.000Z')
    ]
    workspace.tabs = [
      { id: 'chat:session-a', kind: 'chat', title: 'A', sessionId: 'session-a', closable: true },
      { id: 'chat:session-b', kind: 'chat', title: 'B', sessionId: 'session-b', closable: true },
      { id: 'chat:new', kind: 'chat', title: 'New', sessionId: 'new', closable: true }
    ]

    workspace.activateTab('chat:session-b')
    expect(workspace.activeTabId).toBe('chat:session-b')
    expect(sessions.currentId).toBe('session-b')

    workspace.activateTab('chat:new')
    expect(workspace.activeTabId).toBe('chat:new')
    expect(sessions.currentId).toBeNull()
  })

  it('drops a chat tab whose session no longer exists', () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    workspace.tabs = [
      { id: 'chat:missing', kind: 'chat', title: 'Missing', sessionId: 'missing', closable: true }
    ]

    workspace.activateTab('chat:missing')

    expect(workspace.tabs).toEqual([])
    expect(workspace.activeTabId).toBeNull()
    expect(sessions.currentId).toBeNull()
  })

  it('opens Harness as a Workspace-level tab without requiring a project', () => {
    const workspace = useWorkspaceStore()

    workspace.ensureHarnessTab('Harness Console')

    expect(workspace.tabs).toEqual([
      { id: 'harness', kind: 'harness', title: 'Harness Console', closable: true }
    ])
    expect(workspace.activeTabId).toBe('harness')
  })
})

describe('workspace file edit buffers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('preserves a dirty local buffer when a refreshed preview has a new revision', () => {
    const workspace = useWorkspaceStore()
    workspace.ensureFileEditBuffer('/code/app.ts', 'initial', 'a'.repeat(64))
    workspace.updateFileEditBuffer('/code/app.ts', 'local change')

    const buffer = workspace.ensureFileEditBuffer('/code/app.ts', 'external change', 'b'.repeat(64))

    expect(buffer).toEqual({
      content: 'local change',
      savedContent: 'initial',
      revision: 'a'.repeat(64)
    })
    expect(workspace.isFileDirty('/code/app.ts')).toBe(true)
  })

  it('refreshes a clean buffer and clears dirty state after save or discard', () => {
    const workspace = useWorkspaceStore()
    workspace.ensureFileEditBuffer('/code/app.ts', 'initial', 'a'.repeat(64))
    workspace.ensureFileEditBuffer('/code/app.ts', 'external', 'b'.repeat(64))
    expect(workspace.fileEditBuffers['/code/app.ts']?.content).toBe('external')

    workspace.updateFileEditBuffer('/code/app.ts', 'edited')
    workspace.markFileSaved('/code/app.ts', 'edited', 'c'.repeat(64))
    expect(workspace.isFileDirty('/code/app.ts')).toBe(false)

    workspace.discardFileEditBuffer('/code/app.ts')
    expect(workspace.fileEditBuffers['/code/app.ts']).toBeUndefined()
  })
})

describe('conversation file panel', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    delete window.piSwitch
  })

  it('opens and closes files without replacing the active conversation', () => {
    const workspace = useWorkspaceStore()
    selectFileSession(workspace, '/code/a', 'a')
    workspace.openFileTab('/code/a/index.ts', 'index.ts')
    workspace.openFileTab('/code/a/other.ts', 'other.ts')
    expect(workspace.activeTabId).toBe('chat:a')
    expect(workspace.mainTabs.map((tab) => tab.id)).toEqual(['chat:a'])
    expect(workspace.activeFileTab?.filePath).toBe('/code/a/other.ts')
    workspace.closeTab(workspace.activeFileTab!.id)
    expect(workspace.activeFileTab?.filePath).toBe('/code/a/index.ts')
    expect(useSessionStore().currentId).toBe('a')
    expect(workspace.activeTabId).toBe('chat:a')
  })

  it('preserves unsaved buffers on collapse and scopes previews to the selected session', () => {
    const workspace = useWorkspaceStore()
    selectFileSession(workspace, '/code/a', 'a')
    workspace.openFileTab('/code/a/index.ts', 'index.ts')
    workspace.ensureFileEditBuffer('/code/a/index.ts', 'initial', 'revision')
    workspace.updateFileEditBuffer('/code/a/index.ts', 'unsaved')
    workspace.filePanelOpen = false
    workspace.filePanelOpen = true
    expect(workspace.fileEditBuffers['/code/a/index.ts'].content).toBe('unsaved')
    selectFileSession(workspace, '/code/b', 'b')
    expect(workspace.sessionFileTabs).toEqual([])
    expect(workspace.activeFileTab).toBeNull()
    workspace.openFileTab('/code/a/index.ts', 'index.ts')
    expect(workspace.activeFileTab).toBeNull()
    selectFileSession(workspace, '/code/a', 'a')
    expect(workspace.activeFileTab?.filePath).toBe('/code/a/index.ts')
    expect(workspace.isFileDirty('/code/a/index.ts')).toBe(true)
    useSessionStore().selectSession(null)
    expect(workspace.activeFileTab).toBeNull()
  })

  it('never lists or searches draft/global folders without a selected session', async () => {
    const workspace = useWorkspaceStore()
    const list = vi.fn()
    const search = vi.fn()
    window.piSwitch = { files: { list }, workspace: { search } } as unknown as PiSwitchAPI
    workspace.addProjectRoot('/code/draft')
    await workspace.loadFiles()
    expect(await workspace.loadDirectory('/code/draft')).toEqual([])
    expect(await workspace.searchFiles('index')).toEqual([])
    workspace.openFileTab('/code/draft/index.ts', 'index.ts')
    expect(list).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
    expect(workspace.sessionFileTabs).toEqual([])
    expect(workspace.tabs).toEqual([])
  })

  it('ignores stale directory results after switching sessions', async () => {
    const workspace = useWorkspaceStore()
    let finish!: (entries: []) => void
    const list = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve
        })
    )
    window.piSwitch = { files: { list } } as unknown as PiSwitchAPI
    selectFileSession(workspace, '/code/a', 'a')
    const loading = workspace.loadDirectory('/code/a')
    selectFileSession(workspace, '/code/b', 'b')
    finish([])
    expect(await loading).toEqual([])
    expect(workspace.fileChildren['/code/a']).toBeUndefined()
  })

  it('does not expose old roots while the next session workspace is synchronizing', async () => {
    const workspace = useWorkspaceStore()
    selectFileSession(workspace, '/code/a', 'a')
    const sessions = useSessionStore()
    sessions.items.push(session('b', '/code/b', '2026-08-30T00:00:00.000Z'))
    const api = workspaceApi({ b: binding('b', ['/code/b']) })
    const synced = await api.workspace.sync({ folders: [{ path: '/code/b' }] })
    let finish!: (value: typeof synced) => void
    api.workspace.sync = vi.fn(
      () =>
        new Promise<typeof synced>((resolve) => {
          finish = resolve
        })
    )
    window.piSwitch = api
    sessions.selectSession('b')
    const loading = workspace.restoreSessionWorkspace('b')
    await vi.waitFor(() => expect(api.workspace.sync).toHaveBeenCalled())
    expect(workspace.activeSessionWorkspaceId).toBeNull()
    expect(workspace.hasSessionWorkspace).toBe(false)
    finish(synced)
    await loading
    expect(workspace.hasSessionWorkspace).toBe(true)
    expect(workspace.projectRoots).toEqual(['/code/b'])
  })
})

describe('workspace projects', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('persists project roots once per normalized project identity', () => {
    const store = useWorkspaceStore()

    store.addProjectRoot('/code/pi-harness/')
    store.addProjectRoot('/code/pi-harness')
    store.addProjectRoot('/code/other')

    expect(store.projectRoots).toEqual(['/code/pi-harness/', '/code/other'])
    expect(store.pickedCwd).toBe('/code/other')
  })

  it('requires an active project before creating a chat tab', () => {
    const workspace = useWorkspaceStore()

    expect(workspace.canChat).toBe(false)
    expect(workspace.ensureChatTab('new', 'New session')).toBe(false)
    expect(workspace.tabs).toEqual([])

    workspace.addProjectRoot('/code/app')

    expect(workspace.canChat).toBe(true)
    expect(workspace.ensureChatTab('new', 'New session')).toBe(true)
    expect(workspace.tabs.map((tab) => tab.id)).toEqual(['chat:new'])
  })

  it('prefixes file tabs with the folder name in a multi-root workspace', () => {
    const workspace = useWorkspaceStore()
    selectFileSession(workspace, '/code/AgentDesk')
    workspace.addProjectRoot('/code/AgentDesk')
    workspace.addProjectRoot('/code/opencode')
    workspace.openFileTab('/code/AgentDesk/src/index.ts', 'index.ts')
    expect(workspace.activeFileTab).toMatchObject({
      id: 'file:/code/AgentDesk/src/index.ts',
      title: 'AgentDesk/index.ts'
    })
  })

  it('keeps pin state on sessions instead of project roots', () => {
    const workspace = useWorkspaceStore()
    workspace.setSessionPinned('older', true)

    expect(workspace.isSessionPinned('older')).toBe(true)
    expect(workspace.isSessionPinned('newer')).toBe(false)
  })

  it('archives sessions without deleting them from the Pi session store', () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [session('session-a', '/code/a', '2026-01-01T00:00:00.000Z')]
    workspace.setSessionPinned('session-a', true)
    workspace.ensureChatTab('session-a', 'Session A')
    sessions.selectSession('session-a')

    workspace.archiveSession('session-a')

    expect(sessions.items).toHaveLength(1)
    expect(workspace.archivedSessionIds).toEqual(['session-a'])
    expect(workspace.tabs).toEqual([])
    expect(sessions.currentId).toBeNull()
    expect(workspace.pinnedSessionIds).toEqual([])
  })

  it('removes only the project from the active session and keeps its chat tab', () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    const root = '/code/a'
    const projectKey = projectIdentityKey(root)
    sessions.items = [session('session-a', root, '2026-01-01T00:00:00.000Z')]
    workspace.addProjectRoot(root)
    sessions.selectSession('session-a')
    workspace.ensureChatTab('session-a', 'Session A')

    workspace.removeProject(projectKey)

    expect(workspace.projects).toEqual([])
    expect(workspace.tabs.map((tab) => tab.id)).toEqual(['chat:session-a'])

    workspace.addProjectRoot(root)
    expect(workspace.projects).toHaveLength(1)
  })

  it('replaces project roots when switching sessions instead of merging them globally', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [
      session('session-a', '/code/a', '2026-01-01T00:00:00.000Z'),
      session('session-b', '/code/b', '2026-01-02T00:00:00.000Z')
    ]
    const bindings = {
      'session-a': binding('session-a', ['/code/a']),
      'session-b': binding('session-b', ['/code/b', '/code/shared'])
    }
    window.piSwitch = workspaceApi(bindings)

    await workspace.restoreSessionWorkspace('session-a')
    expect(workspace.projectRoots).toEqual(['/code/a'])

    await workspace.restoreSessionWorkspace('session-b')
    expect(workspace.projectRoots).toEqual(['/code/b', '/code/shared'])
    expect(workspace.projectRoots).not.toContain('/code/a')
    delete window.piSwitch
  })

  it('creates one draft workspace from multiple imported project folders', async () => {
    const workspace = useWorkspaceStore()
    window.piSwitch = workspaceApi({})

    try {
      await workspace.resetDraftWorkspaceRoots(['/code/a', '/code/b', '/code/a/'])

      expect(workspace.projectRoots).toEqual(['/code/a', '/code/b'])
      expect(workspace.activeSessionWorkspaceId).toBeNull()
      expect(
        workspace.workspaceFolders.map((folder) => [folder.resolvedPath, folder.role])
      ).toEqual([
        ['/code/a', 'main'],
        ['/code/b', 'reference']
      ])
      expect(workspace.hasDraftSession).toBe(true)
      expect(workspace.draftWorkspaceFolders.map((folder) => folder.resolvedPath)).toEqual([
        '/code/a',
        '/code/b'
      ])
    } finally {
      delete window.piSwitch
    }
  })

  it('copies the selected session workspace into a new-session draft', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [session('session-a', '/code/a', '2026-01-01T00:00:00.000Z')]
    window.piSwitch = workspaceApi({
      'session-a': binding('session-a', ['/code/a', '/code/shared'])
    })

    try {
      await workspace.restoreSessionWorkspace('session-a')
      expect(workspace.activeSessionWorkspaceId).toBe('session-a')

      await expect(workspace.startDraftFromActiveWorkspace()).resolves.toBe(true)

      expect(workspace.activeSessionWorkspaceId).toBeNull()
      expect(workspace.projectRoots).toEqual(['/code/a', '/code/shared'])
      expect(workspace.hasDraftSession).toBe(true)
    } finally {
      delete window.piSwitch
    }
  })

  it('copies a target session workspace into a new-session draft', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [session('session-a', '/code/a', '2026-01-01T00:00:00.000Z')]
    window.piSwitch = workspaceApi({
      'session-a': binding('session-a', ['/code/a', '/code/shared'])
    })

    try {
      await expect(workspace.startDraftFromSession('session-a')).resolves.toBe(true)

      expect(workspace.activeSessionWorkspaceId).toBeNull()
      expect(workspace.projectRoots).toEqual(['/code/a', '/code/shared'])
      expect(workspace.hasDraftSession).toBe(true)
    } finally {
      delete window.piSwitch
    }
  })

  it('updates only the target session project binding', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    const target = session('session-a', '/code/a', '2026-01-01T00:00:00.000Z')
    sessions.items = [target, session('session-b', '/code/b', '2026-01-02T00:00:00.000Z')]
    const bindings = {
      'session-a': binding('session-a', ['/code/a']),
      'session-b': binding('session-b', ['/code/b'])
    }
    window.piSwitch = workspaceApi(bindings)

    try {
      await workspace.refreshSessionBindings()
      const folders = workspace.sessionFolders(target)
      folders.push({
        id: projectIdentityKey('/code/shared'),
        name: 'shared',
        path: '/code/shared',
        resolvedPath: '/code/shared',
        role: 'reference',
        readonly: false,
        exists: true
      })

      await expect(workspace.saveSessionFolders(target.id, folders)).resolves.toBe(true)

      expect(bindings['session-a'].folders.map((folder) => folder.path)).toEqual([
        '/code/a',
        '/code/shared'
      ])
      expect(bindings['session-b'].folders.map((folder) => folder.path)).toEqual(['/code/b'])
    } finally {
      delete window.piSwitch
    }
  })

  it('promotes the first added folder to Main and later folders to Reference', () => {
    const workspace = useWorkspaceStore()
    workspace.addProjectRoot('/code/a')
    workspace.addProjectRoot('/code/b')
    expect(workspace.workspaceFolders.map((folder) => [folder.name, folder.role])).toEqual([
      ['a', 'main'],
      ['b', 'reference']
    ])
    workspace.setFolderRole(projectIdentityKey('/code/b'), 'main')
    expect(workspace.mainFolder?.resolvedPath).toBe('/code/b')
    expect(
      workspace.workspaceFolders.find((folder) => folder.id === projectIdentityKey('/code/a'))?.role
    ).toBe('reference')
  })

  it('closes file and diff tabs that belong to a removed project', () => {
    const workspace = useWorkspaceStore()
    const rootA = '/code/a'
    const rootB = '/code/b'
    workspace.addProjectRoot(rootA)
    workspace.addProjectRoot(rootB)
    workspace.tabs = [
      { id: 'file-a', kind: 'file', title: 'a.ts', filePath: '/code/a/src/a.ts', closable: true },
      { id: 'diff-a', kind: 'diff', title: 'a.ts', filePath: '/code/a/src/a.ts', closable: true },
      { id: 'file-b', kind: 'file', title: 'b.ts', filePath: '/code/b/src/b.ts', closable: true }
    ]
    workspace.activeTabId = 'file-a'
    workspace.ensureFileEditBuffer('/code/a/src/a.ts', 'a', 'a'.repeat(64))

    workspace.removeProject(projectIdentityKey(rootA))

    expect(workspace.tabs.map((tab) => tab.id)).toEqual(['file-b'])
    expect(workspace.activeTabId).toBeNull()
    expect(workspace.fileEditBuffers['/code/a/src/a.ts']).toBeUndefined()
  })

  it('does not restore stale project tabs when no project remains', async () => {
    const workspace = useWorkspaceStore()
    const removedRoot = '/code/removed'
    const projectKey = projectIdentityKey(removedRoot)
    const snapshot = JSON.stringify({
      projectKey,
      pickedCwd: removedRoot,
      projectRoots: [],
      removedProjectKeys: [projectKey],
      tabs: [
        {
          id: 'file:/code/removed/package.json',
          kind: 'file',
          title: 'package.json',
          filePath: '/code/removed/package.json',
          closable: true
        },
        {
          id: 'chat:new',
          kind: 'chat',
          title: 'New session',
          sessionId: 'new',
          closable: true
        }
      ],
      activeTabId: 'file:/code/removed/package.json'
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => snapshot),
      setItem: vi.fn(),
      removeItem: vi.fn()
    })
    window.piSwitch = workspaceApi({})

    try {
      await workspace.restore({ restoreTabs: true, autoOpenLastProject: true })

      expect(workspace.projects).toEqual([])
      expect(workspace.currentCwd).toBeNull()
      expect(workspace.tabs).toEqual([])
      expect(workspace.activeTabId).toBeNull()
    } finally {
      delete window.piSwitch
      vi.unstubAllGlobals()
    }
  })

  it('does not restore an unsent draft workspace or its Git source after restart', async () => {
    const workspace = useWorkspaceStore()
    const staleRoot = '/code/stale-draft'
    const snapshot = JSON.stringify({
      projectKey: null,
      pickedCwd: staleRoot,
      projectRoots: [staleRoot],
      draftProjectRoots: [staleRoot],
      workspaceFile: null,
      draftWorkspaceFile: null,
      folderMeta: {
        [projectIdentityKey(staleRoot)]: { role: 'main' }
      },
      draftFolderMeta: {
        [projectIdentityKey(staleRoot)]: { role: 'main' }
      },
      tabs: [
        {
          id: 'chat:new',
          kind: 'chat',
          title: 'New session',
          sessionId: 'new',
          closable: true
        }
      ],
      activeTabId: 'chat:new'
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => snapshot),
      setItem: vi.fn(),
      removeItem: vi.fn()
    })
    const api = workspaceApi({})
    const sync = vi.spyOn(api.workspace, 'sync')
    window.piSwitch = api

    try {
      await workspace.restore({ restoreTabs: true, autoOpenLastProject: true })

      expect(workspace.projectRoots).toEqual([])
      expect(workspace.currentCwd).toBeNull()
      expect(workspace.hasDraftSession).toBe(false)
      expect(workspace.tabs).toEqual([])
      expect(workspace.gitStatuses).toEqual([])
      expect(sync).toHaveBeenLastCalledWith(
        expect.objectContaining({ workspaceFile: null, folders: [] })
      )
    } finally {
      delete window.piSwitch
      vi.unstubAllGlobals()
    }
  })

  it('discards a draft and clears its active workspace', async () => {
    const workspace = useWorkspaceStore()
    window.piSwitch = workspaceApi({})

    try {
      await workspace.resetDraftWorkspaceRoots(['/code/a', '/code/b'])
      workspace.ensureChatTab('new', 'New session')
      expect(workspace.hasDraftSession).toBe(true)

      await workspace.discardDraftSession()

      expect(workspace.hasDraftSession).toBe(false)
      expect(workspace.draftWorkspaceFolders).toEqual([])
      expect(workspace.projectRoots).toEqual([])
      expect(workspace.tabs.map((tab) => tab.id)).not.toContain('chat:new')
      expect(workspace.gitStatuses).toEqual([])
    } finally {
      delete window.piSwitch
    }
  })

  it('keeps explicitly selected projects when the Workspace view remounts in the same run', async () => {
    const workspace = useWorkspaceStore()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    })
    window.piSwitch = workspaceApi({})

    try {
      await workspace.restore({ restoreTabs: true, autoOpenLastProject: true })
      await workspace.resetDraftWorkspace('/code/current-run')
      workspace.ensureChatTab('new', 'New session')

      await workspace.restore({ restoreTabs: true, autoOpenLastProject: true })

      expect(workspace.hasDraftSession).toBe(true)
      expect(workspace.projectRoots).toEqual(['/code/current-run'])
      expect(workspace.tabs.map((tab) => tab.id)).toContain('chat:new')
    } finally {
      delete window.piSwitch
      vi.unstubAllGlobals()
    }
  })

  it('keeps imported project entries separate from the active draft and session roots', async () => {
    const workspace = useWorkspaceStore()
    window.piSwitch = workspaceApi({})
    try {
      await workspace.resetDraftWorkspace('/code/a')
      workspace.rememberImportedProjects(['/code/a/', '/code/a'])
      await workspace.resetDraftWorkspace('/code/b')
      workspace.rememberImportedProjects(['/code/b'])

      expect(workspace.importedProjectRoots).toEqual(['/code/a/', '/code/b'])
      expect(workspace.projectRoots).toEqual(['/code/b'])
      await workspace.discardDraftSession()
      expect(workspace.importedProjectRoots).toEqual(['/code/a/', '/code/b'])
      expect(workspace.projectRoots).toEqual([])
    } finally {
      delete window.piSwitch
    }
  })

  it('restores only explicit project entries without activating their files or Git', async () => {
    const workspace = useWorkspaceStore()
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => JSON.stringify({ importedProjectRoots: ['/code/saved'], tabs: [] })),
      setItem
    })
    const api = workspaceApi({})
    const sync = vi.spyOn(api.workspace, 'sync')
    window.piSwitch = api
    try {
      await workspace.restore({ restoreTabs: true, autoOpenLastProject: true })
      expect(workspace.importedProjectRoots).toEqual(['/code/saved'])
      expect(workspace.projectRoots).toEqual([])
      expect(workspace.canChat).toBe(false)
      expect(workspace.tabs).toEqual([])
      expect(sync).toHaveBeenLastCalledWith(expect.objectContaining({ folders: [] }))
      expect(JSON.parse(setItem.mock.lastCall![1]).importedProjectRoots).toEqual(['/code/saved'])
    } finally {
      delete window.piSwitch
      vi.unstubAllGlobals()
    }
  })

  it('imports multiple source folders as one project, using the first folder as primary', async () => {
    const workspace = useWorkspaceStore()
    window.piSwitch = workspaceApi({})
    try {
      await workspace.resetDraftWorkspaceRoots(['/code/server', '/code/blog', '/code/blog/'])
      workspace.rememberDraftProject()
      workspace.rememberDraftProject()

      expect(workspace.importedProjectRoots).toEqual(['/code/server'])
      expect(workspace.projectSettings[projectIdentityKey('/code/server')]).toEqual({
        name: 'server',
        roots: ['/code/server', '/code/blog']
      })
      await workspace.discardDraftSession()
      await workspace.startDraftFromProject('/code/server')
      expect(workspace.draftProjectRoots).toEqual(['/code/server', '/code/blog'])
      expect(workspace.mainFolder?.resolvedPath).toBe('/code/server')
      expect(workspace.importedProjectRoots).toEqual(['/code/server'])

      await workspace.removeProjectEntry(projectIdentityKey('/code/server'))
      expect(workspace.importedProjectRoots).toEqual([])
      expect(workspace.draftProjectRoots).toEqual([])
      expect(workspace.canChat).toBe(false)
    } finally {
      delete window.piSwitch
    }
  })

  it('persists workspace project sources and name without restoring a draft, files or Git', async () => {
    const workspace = useWorkspaceStore()
    let snapshot: string | null = null
    vi.stubGlobal('localStorage', {
      getItem: () => snapshot,
      setItem: (_key: string, value: string) => {
        snapshot = value
      }
    })
    const api = workspaceApi({})
    api.workspace.openWorkspaceFile = async (path) =>
      api.workspace.sync({
        workspaceFile: path,
        folders: [{ path: '/code/server' }, { path: '/code/blog' }]
      })
    window.piSwitch = api
    try {
      await workspace.restore({ restoreTabs: true, autoOpenLastProject: true })
      await workspace.importDraftWorkspaceFile('/code/Combined.CODE-WORKSPACE')
      workspace.rememberDraftProject()
      expect(workspace.projectSettings[projectIdentityKey('/code/server')].name).toBe('Combined')
      workspace.saveProjectSettings('/code/server', 'My workspace', workspace.draftProjectRoots)
      workspace.rememberDraftProject()
      expect(workspace.projectSettings[projectIdentityKey('/code/server')].name).toBe(
        'My workspace'
      )

      setActivePinia(createPinia())
      const restored = useWorkspaceStore()
      await restored.restore({ restoreTabs: true, autoOpenLastProject: true })
      expect(restored.importedProjectRoots).toEqual(['/code/server'])
      expect(restored.projectSettings[projectIdentityKey('/code/server')]).toEqual({
        name: 'My workspace',
        roots: ['/code/server', '/code/blog']
      })
      expect(restored.draftProjectRoots).toEqual([])
      expect(restored.projectRoots).toEqual([])
      expect(restored.files).toEqual([])
      expect(restored.gitStatuses).toEqual([])
      await restored.startDraftFromProject('/code/server')
      expect(restored.draftProjectRoots).toEqual(['/code/server', '/code/blog'])
    } finally {
      delete window.piSwitch
      vi.unstubAllGlobals()
    }
  })

  it('does not merge standalone projects or existing sessions when importing workspace sources', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [session('blog', '/code/blog', '2026-01-01')]
    const bindings = { blog: binding('blog', ['/code/blog']) }
    window.piSwitch = workspaceApi(bindings)
    try {
      workspace.rememberImportedProjects(['/code/blog'])
      workspace.rememberDraftProject()
      expect(workspace.importedProjectRoots).toEqual(['/code/blog'])
      const before = structuredClone(bindings)
      await workspace.resetDraftWorkspaceRoots(['/code/server', '/code/blog'])
      workspace.rememberDraftProject()
      expect(workspace.importedProjectRoots).toEqual(['/code/blog', '/code/server'])
      expect(workspace.projectSourceRoots('/code/server')).toEqual(['/code/server', '/code/blog'])
      expect(workspace.projectSourceRoots('/code/blog')).toEqual(['/code/blog'])
      expect(bindings).toEqual(before)
      expect(sessions.items.map((item) => item.id)).toEqual(['blog'])
    } finally {
      delete window.piSwitch
    }
  })

  it('removes imported draft projects without changing a selected real session', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [session('selected', '/code/selected', '2026-01-01T00:00:00.000Z')]
    window.piSwitch = workspaceApi({})
    try {
      await workspace.resetDraftWorkspaceRoots(['/code/a', '/code/b'])
      workspace.rememberImportedProjects(['/code/a', '/code/b'])
      sessions.selectSession('selected')
      await workspace.restoreSessionWorkspace('selected')

      await workspace.removeImportedProject(projectIdentityKey('/code/a'))
      expect(workspace.importedProjectRoots).toEqual(['/code/b'])
      expect(workspace.draftWorkspaceFolders).toEqual([
        expect.objectContaining({ resolvedPath: '/code/b', role: 'main' })
      ])
      await workspace.removeImportedProject(projectIdentityKey('/code/b'))
      expect(workspace.importedProjectRoots).toEqual([])
      expect(workspace.hasDraftSession).toBe(false)
      expect(sessions.currentId).toBe('selected')
      expect(workspace.projectRoots).toEqual(['/code/selected'])
      expect(workspace.activeSessionWorkspaceId).toBe('selected')
    } finally {
      delete window.piSwitch
    }
  })

  it('saves project names and source folders without rebinding existing sessions', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [session('a', '/code/a', '2026-01-01'), session('b', '/code/b', '2026-01-01')]
    const bindings = { a: binding('a', ['/code/a', '/code/old']), b: binding('b', ['/code/b']) }
    window.piSwitch = workspaceApi(bindings)
    try {
      await workspace.restoreSessionWorkspace('a')
      const before = structuredClone(bindings)
      workspace.saveProjectSettings('/code/a', 'A renamed', ['/code/a', '/code/new', '/code/new'])
      expect(workspace.projectSettings[projectIdentityKey('/code/a')]).toEqual({
        name: 'A renamed',
        roots: ['/code/a', '/code/new']
      })
      await workspace.startDraftFromProject('/code/a')
      expect(workspace.draftProjectRoots).toEqual(['/code/a', '/code/new'])
      expect(bindings).toEqual(before)
      expect(workspace.importedProjectRoots).toEqual(['/code/a'])
    } finally {
      delete window.piSwitch
    }
  })

  it('removes only the project navigation entry and allows explicitly reimporting it', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [session('a', '/code/a', '2026-01-01'), session('b', '/code/b', '2026-01-01')]
    window.piSwitch = workspaceApi({})
    try {
      workspace.rememberImportedProjects(['/code/a', '/code/b'])
      sessions.selectSession('b')
      await workspace.restoreSessionWorkspace('b')
      await workspace.removeProjectEntry(projectIdentityKey('/code/a'))
      expect(sessions.items.map((item) => item.id)).toEqual(['a', 'b'])
      expect(sessions.currentId).toBe('b')
      expect(workspace.projectRoots).toEqual(['/code/b'])
      expect(workspace.removedProjectKeys).toContain(projectIdentityKey('/code/a'))
      workspace.rememberImportedProjects(['/code/a'])
      expect(workspace.removedProjectKeys).not.toContain(projectIdentityKey('/code/a'))
    } finally {
      delete window.piSwitch
    }
  })

  it('archives by the bound primary project, never by an attachment or stale cwd', () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [
      session('a', '/code/old', '2026-01-01'),
      session('b', '/code/b', '2026-01-01')
    ]
    workspace.sessionBindings = {
      a: binding('a', ['/code/a']),
      b: binding('b', ['/code/b', '/code/a'])
    }
    workspace.archiveProjectSessions(projectIdentityKey('/code/a'))
    expect(workspace.archivedSessionIds).toEqual(['a'])
    expect(sessions.items).toHaveLength(2)
  })

  it('does not restore chat tabs for sessions missing from the latest session list', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [session('session-a', '/code/a', '2026-01-01T00:00:00.000Z')]
    const snapshot = JSON.stringify({
      projectKey: null,
      pickedCwd: null,
      projectRoots: [],
      tabs: [
        {
          id: 'chat:missing',
          kind: 'chat',
          title: 'Missing',
          sessionId: 'missing',
          closable: true
        },
        {
          id: 'chat:session-a',
          kind: 'chat',
          title: 'Session A',
          sessionId: 'session-a',
          closable: true
        }
      ],
      activeTabId: 'chat:missing'
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => snapshot),
      setItem: vi.fn(),
      removeItem: vi.fn()
    })
    window.piSwitch = workspaceApi({
      'session-a': binding('session-a', ['/code/a'])
    })

    try {
      await workspace.restore({ restoreTabs: true, autoOpenLastProject: true })

      expect(workspace.tabs.map((tab) => tab.id)).toEqual(['chat:session-a'])
      expect(workspace.activeTabId).toBe('chat:session-a')
      expect(sessions.currentId).toBe('session-a')
      expect(workspace.projectRoots).toEqual(['/code/a'])
    } finally {
      delete window.piSwitch
      vi.unstubAllGlobals()
    }
  })

  it('forgets deleted session tabs and workspace bindings', () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    const current = session('session-a', '/code/a', '2026-01-01T00:00:00.000Z')
    sessions.items = [current]
    sessions.selectSession(current.id)
    workspace.sessionBindings = { 'session-a': binding('session-a', ['/code/a']) }
    workspace.ensureChatTab(current.id, 'Session A')

    workspace.forgetSession(current.id)

    expect(workspace.sessionBindings).toEqual({})
    expect(workspace.tabs).toEqual([])
    expect(sessions.currentId).toBeNull()
  })
})

describe('workspace content refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete window.piSwitch
  })

  it('refreshes the visible directory and invalidates open previews', async () => {
    const list = vi.fn().mockResolvedValue([])
    const statusMany = vi.fn().mockResolvedValue([
      {
        isGitRepository: true,
        repositoryRoot: '/code/project',
        files: [],
        additions: 0,
        deletions: 0,
        branch: 'main'
      }
    ])
    window.piSwitch = { files: { list }, git: { statusMany } } as unknown as PiSwitchAPI
    const workspace = useWorkspaceStore()
    workspace.setPickedCwd('/code/project')
    selectFileSession(workspace, '/code/project')
    await workspace.loadFiles('/code/project/src')

    await workspace.refreshContent()

    expect(list).toHaveBeenCalledWith('/code/project/src')
    expect(statusMany).toHaveBeenCalled()
    expect(workspace.contentRevision).toBe(1)
  })
})

describe('workspace image drafts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps image attachments scoped to the current session draft', () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.selectSession('session-a')
    workspace.addDraftImages([
      {
        id: 'image-1',
        name: 'one.png',
        size: 1,
        type: 'image',
        data: 'TQ==',
        mimeType: 'image/png'
      }
    ])

    sessions.selectSession('session-b')
    expect(workspace.draftImages).toEqual([])

    sessions.selectSession('session-a')
    expect(workspace.draftImages).toHaveLength(1)
    workspace.clearDraft('session-a')
    expect(workspace.draftImages).toEqual([])
  })
})

function createStore(activeTabId: string) {
  const store = useWorkspaceStore()
  store.tabs = tabs.map((tab) => ({ ...tab }))
  store.activeTabId = activeTabId
  return store
}

function session(id: string, cwd: string, modified: string): SessionInfo {
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd,
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
    projectRoot: cwd,
    projectKey: projectIdentityKey(cwd)
  }
}

function selectFileSession(
  workspace: ReturnType<typeof useWorkspaceStore>,
  root: string,
  id = 'file-session'
) {
  const sessions = useSessionStore()
  sessions.items = [
    ...sessions.items.filter((item) => item.id !== id),
    session(id, root, '2026-08-30T00:00:00.000Z')
  ]
  sessions.selectSession(id)
  workspace.projectRoots = [root]
  workspace.activeSessionWorkspaceId = id
  workspace.ensureChatTab(id, id)
}

function binding(sessionId: string, paths: string[]): SessionWorkspaceBinding {
  const folders = paths.map((path, index) => ({
    id: projectIdentityKey(path),
    path,
    role: index === 0 ? ('main' as const) : ('reference' as const)
  }))
  return {
    workspaceId: `session:${sessionId}`,
    mainFolderId: folders[0]?.id,
    folders
  }
}

function workspaceApi(bindings: Record<string, SessionWorkspaceBinding>): PiSwitchAPI {
  const sync: PiSwitchAPI['workspace']['sync'] = async (input) => ({
    id: 'active',
    name: 'Session projects',
    workspaceFile: input.workspaceFile ?? null,
    folders: input.folders.map((folder, index) => ({
      id: projectIdentityKey(folder.resolvedPath ?? folder.path),
      name: (folder.resolvedPath ?? folder.path).split('/').at(-1) ?? folder.path,
      path: folder.path,
      resolvedPath: folder.resolvedPath ?? folder.path,
      role: index === 0 ? 'main' : 'reference',
      readonly: folder.readonly === true,
      exists: true
    })),
    settings: input.settings ?? {},
    createdAt: 1,
    updatedAt: 1
  })
  return {
    workspace: {
      listSessionBindings: async () => bindings,
      getSessionBinding: async (sessionId: string) => bindings[sessionId] ?? null,
      bindSession: async (
        sessionId: string,
        workspaceId: string,
        folders: SessionWorkspaceBinding['folders'],
        mainFolderId?: string
      ) => {
        bindings[sessionId] = { workspaceId, folders, mainFolderId }
      },
      allowRoot: async () => undefined,
      sync
    }
  } as unknown as PiSwitchAPI
}
