import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WorkspaceService } from './workspace-service'
import { JsonStore } from '../services/storage'
import type { FileAccessService } from '../files/file-access-service'
import type { WorkspaceStateRecord } from './workspace-service'

describe('WorkspaceService', () => {
  let directory = ''

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('parses a .code-workspace file, preserves unknown settings, and round-trips extras', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-workspace-'))
    const agentDesk = path.join(directory, 'AgentDesk')
    const opencode = path.join(directory, 'opencode')
    await Promise.all([mkdir(agentDesk), mkdir(opencode)])
    const workspaceFile = path.join(directory, 'AgentDesk.code-workspace')
    await writeFile(
      workspaceFile,
      JSON.stringify(
        {
          folders: [{ path: 'AgentDesk' }, { path: 'opencode' }],
          settings: { 'editor.fontSize': 14, files: { exclude: {} } },
          extensions: { recommendations: ['vue.volar'] }
        },
        null,
        2
      )
    )
    const { service, access } = createService(directory)
    const opened = await service.openWorkspaceFile(workspaceFile)

    expect(opened.folders.map((folder) => folder.resolvedPath)).toEqual(
      await Promise.all([realpath(agentDesk), realpath(opencode)])
    )
    expect(opened.folders[0]?.role).toBe('main')
    expect(opened.folders[1]?.role).toBe('reference')
    expect(opened.settings['editor.fontSize']).toBe(14)
    expect(access.authorizeRoot).toHaveBeenCalled()

    const savedPath = path.join(directory, 'saved.code-workspace')
    await service.saveWorkspaceFile(savedPath, {
      folders: opened.folders.map((folder, index) => ({
        path: folder.path,
        resolvedPath: folder.resolvedPath,
        name: folder.name,
        role: folder.role,
        readonly: index === 1
      })),
      settings: opened.settings,
      workspaceFile: opened.workspaceFile
    })
    const saved = JSON.parse(await readFile(savedPath, 'utf8')) as {
      folders: { path: string }[]
      settings: { piHarness?: { mainFolder?: string; folderMeta?: Record<string, unknown> } }
      extensions?: unknown
    }
    expect(saved.folders.map((folder) => folder.path)).toEqual(['AgentDesk', 'opencode'])
    expect(saved.settings['editor.fontSize' as never]).toBe(14)
    expect(saved.extensions).toEqual({ recommendations: ['vue.volar'] })
    expect(saved.settings.piHarness?.mainFolder).toBe('AgentDesk')
    expect(saved.settings.piHarness?.folderMeta?.opencode).toEqual({ readonly: true })
  })

  it('marks missing folders without failing the workspace', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-workspace-missing-'))
    const present = path.join(directory, 'present')
    await mkdir(present)
    const { service } = createService(directory)
    const workspace = await service.sync({
      folders: [
        { path: present, resolvedPath: present, role: 'main' },
        { path: path.join(directory, 'gone'), resolvedPath: path.join(directory, 'gone') }
      ]
    })
    expect(workspace.folders[0]?.exists).toBe(true)
    expect(workspace.folders[1]?.exists).toBe(false)
    expect(service.getPrompt()).toContain('missing')
  })

  it('round-trips session workspace bindings', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-workspace-bind-'))
    const { service } = createService(directory)
    await service.bindSession('sess-1', {
      workspaceId: '/code/AgentDesk.code-workspace',
      mainFolderId: 'main',
      folders: [
        { id: 'main', path: '/code/AgentDesk', role: 'main' },
        { id: 'ref', path: '/code/opencode', role: 'reference', readonly: true }
      ]
    })
    await expect(service.getSessionBinding('sess-1')).resolves.toEqual({
      workspaceId: '/code/AgentDesk.code-workspace',
      mainFolderId: 'main',
      folders: [
        { id: 'main', path: '/code/AgentDesk', role: 'main' },
        { id: 'ref', path: '/code/opencode', role: 'reference', readonly: true }
      ]
    })
    await expect(service.getSessionBinding('missing')).resolves.toBeNull()
    await expect(service.listSessionBindings()).resolves.toHaveProperty('sess-1')
    expect(service.getFoldersForSession('sess-1').map((folder) => folder.resolvedPath)).toEqual([
      '/code/AgentDesk',
      '/code/opencode'
    ])
    expect(service.getPromptForSession('sess-1')).toContain('current session')
    expect(service.getPromptForSession('missing')).toBeNull()

    await service.unbindSession('sess-1')
    await expect(service.getSessionBinding('sess-1')).resolves.toBeNull()
    await expect(service.listSessionBindings()).resolves.not.toHaveProperty('sess-1')
  })

  it('activates only the projects bound to the selected session', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-workspace-session-'))
    const a = path.join(directory, 'a')
    const b = path.join(directory, 'b')
    const shared = path.join(directory, 'shared')
    await Promise.all([mkdir(a), mkdir(b), mkdir(shared)])
    const { service } = createService(directory)
    await service.bindSession('a', {
      workspaceId: 'session:a',
      mainFolderId: 'a',
      folders: [{ id: 'a', path: a, role: 'main' }]
    })
    await service.bindSession('b', {
      workspaceId: 'session:b',
      mainFolderId: 'b',
      folders: [
        { id: 'b', path: b, role: 'main' },
        { id: 'shared', path: shared, role: 'reference' }
      ]
    })

    await service.activateSession('a')
    expect(service.getActive()?.folders.map((folder) => folder.resolvedPath)).toEqual([
      await realpath(a)
    ])

    await service.activateSession('b')
    expect(service.getActive()?.folders.map((folder) => folder.resolvedPath)).toEqual(
      await Promise.all([realpath(b), realpath(shared)])
    )

    await service.bindActiveToSession('new-session')
    await expect(service.getSessionBinding('new-session')).resolves.toMatchObject({
      workspaceId: 'session:new-session',
      folders: [{ role: 'main' }, { role: 'reference' }]
    })
  })
})

function createService(directory: string) {
  const access = {
    authorizeRoot: vi.fn(async (root: string) => root),
    assertAllowed: vi.fn(async (target: string) => target),
    setWorkspaceFolders: vi.fn()
  } as unknown as FileAccessService
  const store = new JsonStore<WorkspaceStateRecord>(path.join(directory, 'state.json'), {
    active: null,
    recent: [],
    sessionBindings: {}
  })
  return { service: new WorkspaceService(access, store), access }
}
