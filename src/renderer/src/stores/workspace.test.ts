import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import type { WorkspaceTab } from '@shared/types/workspace'
import type { SessionInfo } from '@shared/types/workspace'
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

  it('sorts pinned projects and sessions before unpinned entries', () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    const projectA = '/code/a'
    const projectB = '/code/b'
    workspace.addProjectRoot(projectA)
    workspace.addProjectRoot(projectB)
    sessions.items = [
      session('newer', projectA, '2026-01-02T00:00:00.000Z'),
      session('older', projectA, '2026-01-01T00:00:00.000Z')
    ]

    workspace.setProjectPinned(projectIdentityKey(projectB), true)
    workspace.setSessionPinned('older', true)

    expect(workspace.projects.map((project) => project.projectKey)).toEqual([
      projectIdentityKey(projectB),
      projectIdentityKey(projectA)
    ])
    expect(workspace.projects[1]?.sessions.map((item) => item.id)).toEqual(['older', 'newer'])
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
    expect(workspace.projects[0]?.sessions).toEqual([])
    expect(workspace.tabs).toEqual([])
    expect(sessions.currentId).toBeNull()
    expect(workspace.pinnedSessionIds).toEqual([])
  })

  it('removes a project from the sidebar and restores it when explicitly re-added', () => {
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
    expect(workspace.tabs).toEqual([])
    expect(workspace.removedProjectKeys).toEqual([projectKey])

    workspace.addProjectRoot(root)
    expect(workspace.projects).toHaveLength(1)
    expect(workspace.removedProjectKeys).toEqual([])
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

    try {
      await workspace.restore({ restoreTabs: true, autoOpenLastProject: true })

      expect(workspace.projects).toEqual([])
      expect(workspace.currentCwd).toBeNull()
      expect(workspace.tabs).toEqual([])
      expect(workspace.activeTabId).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
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
    const status = vi.fn().mockResolvedValue({
      isGitRepository: true,
      repositoryRoot: '/code/project',
      files: [],
      additions: 0,
      deletions: 0
    })
    window.piSwitch = { files: { list }, git: { status } } as unknown as PiSwitchAPI
    const workspace = useWorkspaceStore()
    workspace.setPickedCwd('/code/project')
    await workspace.loadFiles('/code/project/src')

    await workspace.refreshContent()

    expect(list).toHaveBeenLastCalledWith('/code/project/src')
    expect(status).toHaveBeenLastCalledWith('/code/project')
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
