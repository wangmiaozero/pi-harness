/** Authorization policy for renderer-requested shell.openPath/showItemInFolder operations. */

import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings } from '@shared/ipc/api-types'
import { isPathWithinRoots } from '@shared/workspace/path-security'
import { samePath } from '@shared/workspace/paths'
import type { JsonStore } from '../services/storage'
import type { SkillsService } from '../services/skills-service'
import type { FileAccessService } from '../files/file-access-service'
import { PathDeniedError } from '../services/errors'
import { piEnvironment } from '../pi/environment'

interface OpenPathDependencies {
  settingsStore: JsonStore<AppSettings>
  skills: SkillsService
  access: FileAccessService
}

export class OpenPathPolicy {
  constructor(private readonly dependencies: OpenPathDependencies) {}

  async authorize(input: string): Promise<string> {
    const target = path.resolve(input)
    if (!path.isAbsolute(input)) {
      throw new PathDeniedError('Only absolute paths can be opened', { target: input })
    }

    try {
      return await this.dependencies.access.assertAllowed(target, { mustExist: true })
    } catch (error) {
      if (!(error instanceof PathDeniedError)) throw error
    }

    const settings = this.dependencies.settingsStore.peek()
    const environment = await piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
    const packages = await this.dependencies.skills.listPackages().catch(() => [])
    const exact = [
      environment.configDir,
      environment.modelsConfigPath,
      environment.settingsPath,
      ...packages.flatMap((pkg) => [pkg.path, pkg.registryPath])
    ].filter((entry): entry is string => Boolean(entry))
    const roots = [
      ...environment.skillsDirs,
      ...(environment.configDir ? [path.join(environment.configDir, 'sessions')] : []),
      ...packages.flatMap((pkg) => (pkg.path ? [pkg.path] : []))
    ]

    return authorizeTrustedPath(target, { exact, roots })
  }
}

export async function authorizeTrustedPath(
  target: string,
  allowed: { exact: Iterable<string>; roots: Iterable<string> }
): Promise<string> {
  let realTarget: string
  try {
    realTarget = await realpath(target)
  } catch {
    throw new PathDeniedError('Path does not exist or cannot be resolved', { target })
  }

  const exact = await resolveExistingPaths(allowed.exact)
  if (exact.some((candidate) => samePath(realTarget, candidate))) return realTarget

  const roots = await resolveExistingPaths(allowed.roots)
  if (isPathWithinRoots(realTarget, roots)) return realTarget

  throw new PathDeniedError('Path is outside the trusted system-open roots', { target })
}

async function resolveExistingPaths(paths: Iterable<string>): Promise<string[]> {
  const resolved = await Promise.all(
    [...new Set(paths)].map((candidate) => realpath(candidate).catch(() => null))
  )
  return resolved.filter((candidate): candidate is string => candidate !== null)
}
