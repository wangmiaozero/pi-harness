import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WorkspaceSearchService } from './workspace-search-service'
import type { FileAccessService } from '../files/file-access-service'
import type { WorkspaceFolder } from '@shared/types/workspace'

describe('WorkspaceSearchService', () => {
  let directory = ''

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('searches every folder and prefixes hits with the project name', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-harness-search-'))
    const agentDesk = path.join(directory, 'AgentDesk')
    const opencode = path.join(directory, 'opencode')
    await mkdir(path.join(agentDesk, 'src'), { recursive: true })
    await mkdir(path.join(opencode, 'src'), { recursive: true })
    await writeFile(path.join(agentDesk, 'src', 'provider.ts'), 'export function createAgent() {}\n')
    await writeFile(path.join(opencode, 'src', 'provider.ts'), 'export function createAgent() {}\n')
    await mkdir(path.join(opencode, 'node_modules'), { recursive: true })
    await writeFile(path.join(opencode, 'node_modules', 'provider.ts'), 'ignored\n')

    const access = {
      assertAllowed: vi.fn(async (target: string) => target)
    } as unknown as FileAccessService
    const hits = await new WorkspaceSearchService(access).search({
      query: 'createAgent',
      scope: 'workspace',
      folders: [folder('AgentDesk', agentDesk, 'main'), folder('opencode', opencode, 'reference')]
    })

    expect(hits.map((hit) => `${hit.workspaceFolderName}/${hit.relativePath}`).sort()).toEqual([
      'AgentDesk/src/provider.ts',
      'opencode/src/provider.ts'
    ])
  })
})

function folder(
  name: string,
  resolvedPath: string,
  role: WorkspaceFolder['role']
): WorkspaceFolder {
  return {
    id: resolvedPath,
    name,
    path: name,
    resolvedPath,
    role,
    readonly: false,
    exists: true
  }
}
