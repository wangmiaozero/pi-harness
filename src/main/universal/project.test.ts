import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { UniversalSession } from '@shared/universal/schema'
import { FileAccessService } from '../files/file-access-service'
import { JsonStore } from '../services/storage'
import type { UniversalSessionService } from './service'
import { UniversalProjectService } from './project'

describe('history working directory selection', () => {
  let root: string
  let project: string
  let other: string
  let session: UniversalSession
  let access: FileAccessService
  let projects: UniversalProjectService
  let grants: JsonStore<{ roots: string[] }>
  const id = 'a'.repeat(64)
  const map = vi.fn(async (_id: string, workspacePath: string, workspaceRoots: string[]) => ({
    ...session,
    workspacePath,
    workspaceRoots
  }))
  beforeEach(async () => {
    map.mockClear()
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'history-project-')))
    project = path.join(root, 'project')
    other = path.join(root, 'other')
    await Promise.all([fs.mkdir(project), fs.mkdir(other)])
    session = { id, projectPath: project } as UniversalSession
    grants = new JsonStore(path.join(root, 'grants.json'), { roots: [] as string[] })
    access = new FileAccessService(grants)
    projects = new UniversalProjectService(
      { get: async () => session, map } as unknown as UniversalSessionService,
      access
    )
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })
  it('resolves an unimported directory without saving a mapping or granting file access', async () => {
    await expect(projects.resolve(id)).resolves.toEqual({ status: 'available', path: project })
    await expect(access.assertAllowed(project, { mustExist: true })).rejects.toMatchObject({
      code: 'PATH_DENIED'
    })
    expect((await grants.read()).roots).toEqual([])
    expect(map).not.toHaveBeenCalled()
  })
  it('uses the selected recorded cwd on Prepare, persists its narrow grant, and permits non-Git directories', async () => {
    await expect(projects.map(id, project, [project])).resolves.toMatchObject({
      workspacePath: project,
      workspaceRoots: [project]
    })
    const restarted = new FileAccessService(grants)
    await expect(restarted.assertAllowed(project, { mustExist: true })).resolves.toBe(project)
    await expect(restarted.assertAllowed(other, { mustExist: true })).rejects.toMatchObject({
      code: 'PATH_DENIED'
    })
    expect((await grants.read()).roots).toEqual([project])
  })
  it('reports missing, non-directory, relative and absent recorded paths without creating them', async () => {
    await fs.writeFile(path.join(root, 'file'), 'fixture')
    for (const projectPath of [
      path.join(root, 'missing'),
      path.join(root, 'file'),
      'relative/project',
      '/bad\0path'
    ]) {
      session.projectPath = projectPath
      await expect(projects.resolve(id)).resolves.toEqual({ status: 'missing' })
    }
    delete session.projectPath
    await expect(projects.resolve(id)).resolves.toEqual({ status: 'unrecorded' })
    expect((await grants.read()).roots).toEqual([])
    expect(await fs.readdir(root)).not.toContain('missing')
  })
  it('preserves a saved project choice and all authorized secondary folders', async () => {
    await access.authorizeRoot(project)
    await access.authorizeRoot(other)
    session.workspacePath = other
    session.workspaceRoots = [other, project]
    await expect(projects.resolve(id)).resolves.toEqual({ status: 'available', path: other })
    await projects.map(id, other)
    expect(map).toHaveBeenCalledWith(id, other, [other, project])
    session.workspacePath = path.join(root, 'moved')
    await expect(projects.resolve(id)).resolves.toEqual({ status: 'missing' })
  })
  it('does not authorize arbitrary renderer paths, parents, children or secondary folders', async () => {
    const child = path.join(project, 'child')
    await fs.mkdir(child)
    for (const requested of [root, child, other])
      await expect(projects.map(id, requested)).rejects.toMatchObject({ code: 'PATH_DENIED' })
    await expect(projects.map(id, project, [project, other])).rejects.toMatchObject({
      code: 'PATH_DENIED'
    })
    expect(map).not.toHaveBeenCalled()
    expect((await grants.read()).roots).toEqual([])
  })
  it.skipIf(process.platform === 'win32')(
    'shows the canonical path and never follows a changed symlink into a different project',
    async () => {
      const alias = path.join(root, 'alias')
      await fs.symlink(project, alias, 'dir')
      session.projectPath = alias
      await expect(projects.resolve(id)).resolves.toEqual({ status: 'available', path: project })
      await fs.unlink(alias)
      await fs.symlink(other, alias, 'dir')
      await expect(projects.map(id, project)).rejects.toMatchObject({ code: 'PATH_DENIED' })
      expect((await grants.read()).roots).toEqual([])
      expect(map).not.toHaveBeenCalled()
    }
  )
})
