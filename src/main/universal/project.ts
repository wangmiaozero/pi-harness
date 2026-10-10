import fs from 'node:fs/promises'
import path from 'node:path'
import { workspacePathSchema } from '@shared/schemas/workspace'
import type { UniversalProjectResolution, UniversalSession } from '@shared/universal/schema'
import { projectIdentityKey } from '@shared/workspace/project-identity'
import type { FileAccessService } from '../files/file-access-service'
import { PathDeniedError, ValidationError } from '../services/errors'
import type { UniversalSessionService } from './service'

/** Resolving a history cwd is read-only; only preparing a task grants its selected directory. */
export class UniversalProjectService {
  constructor(
    private readonly history: UniversalSessionService,
    private readonly access: FileAccessService
  ) {}

  async resolve(id: string): Promise<UniversalProjectResolution> {
    const session = await this.history.get(id)
    const recorded = session.workspacePath ?? session.projectPath
    if (!recorded) return { status: 'unrecorded' }
    const directory = await existingDirectory(recorded)
    return directory ? { status: 'available', path: directory } : { status: 'missing' }
  }

  async map(
    id: string,
    workspacePath: string,
    workspaceRoots?: string[]
  ): Promise<UniversalSession> {
    const session = await this.history.get(id)
    const roots =
      workspaceRoots ??
      (session.workspacePath &&
      projectIdentityKey(session.workspacePath) === projectIdentityKey(workspacePath)
        ? session.workspaceRoots
        : undefined) ??
      []
    // Validate every secondary folder before granting anything. History cannot authorize attachments.
    const secondary: string[] = []
    for (const root of roots) {
      if (projectIdentityKey(root) !== projectIdentityKey(workspacePath)) {
        const allowed = await this.access.assertAllowed(root, { mustExist: true })
        if (!(await fs.stat(allowed)).isDirectory())
          throw new ValidationError('Choose a project directory.')
        secondary.push(allowed)
      }
    }
    if (new Set(secondary).size >= 32) throw new ValidationError('Too many linked project folders.')
    let primary: string
    try {
      primary = await this.access.assertAllowed(workspacePath, { mustExist: true })
    } catch (error) {
      if (!(error instanceof PathDeniedError)) throw error
      const recorded = await existingDirectory(session.projectPath)
      const requested = await existingDirectory(workspacePath)
      if (!recorded || recorded !== requested) throw error
      // The explicit Prepare action selects this Main-indexed cwd, never a renderer-supplied root.
      primary = await this.access.authorizeRoot(recorded)
    }
    return this.history.map(id, primary, [primary, ...secondary])
  }
}

async function existingDirectory(value?: string): Promise<string | null> {
  if (!value || !workspacePathSchema.safeParse(value).success || !path.isAbsolute(value))
    return null
  try {
    const directory = await fs.realpath(value)
    return (await fs.stat(directory)).isDirectory() ? directory : null
  } catch {
    return null
  }
}
