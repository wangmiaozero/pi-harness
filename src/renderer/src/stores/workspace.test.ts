import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import type { SessionInfo, SessionWorkspaceBinding, WorkspaceTab } from '@shared/types/workspace'
import { projectIdentityKey } from '@shared/workspace/project-identity'
import { useWorkspaceStore } from './workspace'
import { useSessionStore } from './sessions'

const tabs: WorkspaceTab[] = [
  { id: 'a', kind: 'file', title: 'a.ts', filePath: '/a.ts', closable: true },
  { id: 'b', kind: 'file', title: 'b.ts', filePath: '/b.ts', closable: true },
  { id: 'c', kind: 'file', title: 'c.ts', filePath: '/c.ts', closable: true }
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
    workspace.addProjectRoot('/code/AgentDesk')
    workspace.addProjectRoot('/code/opencode')
    workspace.openFileTab('/code/AgentDesk/src/index.ts', 'index.ts')
    expect(workspace.tabs[0]).toMatchObject({
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
      expect(workspace.workspaceFolders.map((folder) => [folder.resolvedPath, folder.role])).toEqual([
        ['/code/a', 'main'],
        ['/code/b', 'reference']
      ])
    } finally {
      delete window.piSwitch
    }
  })

  it('scopes sessions to the active workspace while keeping them all without one', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    sessions.items = [
      session('session-a', '/code/a', '2026-01-01T00:00:00.000Z'),
      session('session-b', '/code/b', '2026-01-02T00:00:00.000Z'),
      session('session-shared', '/code/shared', '2026-01-03T00:00:00.000Z')
    ]
    window.piSwitch = workspaceApi({})

    try {
      expect(sessions.items.every((item) => workspace.isSessionInActiveWorkspace(item))).toBe(true)

      await workspace.resetDraftWorkspaceRoots(['/code/a'])

      expect(workspace.isSessionInActiveWorkspace(sessions.items[0])).toBe(true)
      expect(workspace.isSessionInActiveWorkspace(sessions.items[1])).toBe(false)
      expect(workspace.isSessionInActiveWorkspace(sessions.items[2])).toBe(false)

      await workspace.resetDraftWorkspaceRoots(['/code/b', '/code/shared'])

      expect(workspace.isSessionInActiveWorkspace(sessions.items[0])).toBe(false)
      expect(workspace.isSessionInActiveWorkspace(sessions.items[1])).toBe(true)
      expect(workspace.isSessionInActiveWorkspace(sessions.items[2])).toBe(true)
    } finally {
      delete window.piSwitch
    }
  })

  it('matches sessions bound to a workspace folder even when their cwd moved', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    const relocated = session('session-moved', '/code/old-location', '2026-01-01T00:00:00.000Z')
    sessions.items = [relocated]
    window.piSwitch = workspaceApi({
      'session-moved': binding('session-moved', ['/code/current'])
    })

    try {
      await workspace.refreshSessionBindings()
      await workspace.resetDraftWorkspaceRoots(['/code/current'])

      expect(workspace.isSessionInActiveWorkspace(relocated)).toBe(true)
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
    expect(workspace.activeTabId).toBe('file-b')
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
      allowRoot: async () => undefined,
      sync
    }
  } as unknown as PiSwitchAPI
}
