import path from 'node:path'
import type {
  CapabilityDefinition,
  CapabilityDescriptor,
  CapabilityMetadata
} from '@shared/capabilities/types'
import { CAPABILITY_CATALOG } from '@shared/capabilities/catalog'
import type { AppSettings, PiPackageInfo, SkillInfo } from '@shared/ipc/api-types'
import type { AppMetadata } from '../services/metadata-store'
import type { JsonStore } from '../services/storage'
import type { SkillsService } from '../services/skills-service'
import { piEnvironment } from '../pi/environment'
import { packageIdentity } from '../packages/package-source'
import { parseSkillDirectory, type ParsedSkill } from './skill-parser'
import { SkillMutationError } from '../services/errors'
import semver from 'semver'

export interface InstalledSkillCapability {
  kind: 'skill'
  path: string
  root: string
  enabled: boolean
  parsed: ParsedSkill
}

export interface InstalledPackageCapability {
  kind: 'package'
  path: string
  root: null
  enabled: true
  package: PiPackageInfo
}

export type InstalledCapability = InstalledSkillCapability | InstalledPackageCapability

export class SkillRegistry {
  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly metadataStore: JsonStore<AppMetadata>,
    private readonly skillsService: SkillsService
  ) {}

  async list(): Promise<CapabilityDescriptor[]> {
    const installedSkills = await this.skillsService.list()
    const installedPackages = CAPABILITY_CATALOG.some(
      (definition) => definition.install?.strategy === 'pi-package'
    )
      ? await this.skillsService.listPackages()
      : []
    const descriptors: CapabilityDescriptor[] = []
    const consumedPaths = new Set<string>()
    const consumedPackageSources = new Set<string>()

    for (const definition of CAPABILITY_CATALOG) {
      const installed = await this.findInstalled(definition, installedSkills, installedPackages)
      if (installed) consumedPaths.add(path.resolve(installed.path))
      if (installed?.kind === 'package') {
        consumedPackageSources.add(packageIdentity(installed.package.source))
      }
      descriptors.push(this.toCatalogDescriptor(definition, installed))
    }

    for (const skill of installedSkills) {
      if (consumedPaths.has(path.resolve(skill.path))) continue
      if (skill.packageSource && consumedPackageSources.has(packageIdentity(skill.packageSource))) {
        continue
      }
      const parsed = await parseSkillDirectory(skill.path)
      descriptors.push(this.toLocalDescriptor(skill, parsed))
    }

    return descriptors.sort(
      (left, right) =>
        (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
        Number(Boolean(right.featured)) - Number(Boolean(left.featured)) ||
        left.name.localeCompare(right.name) ||
        (left.installPath ?? '').localeCompare(right.installPath ?? '')
    )
  }

  async findInstalled(
    definition: CapabilityDefinition,
    knownSkills?: SkillInfo[],
    knownPackages?: PiPackageInfo[]
  ): Promise<InstalledCapability | null> {
    if (definition.builtin) return null
    if (definition.install?.strategy === 'pi-package') {
      const packages = knownPackages ?? (await this.skillsService.listPackages())
      const identity = packageIdentity(definition.install.source)
      const match = packages.find(
        (pkg) =>
          pkg.scope === 'global' &&
          pkg.registered &&
          pkg.installed &&
          packageIdentity(pkg.source) === identity
      )
      if (!match?.path) return null
      return {
        kind: 'package',
        path: match.path,
        root: null,
        enabled: true,
        package: match
      }
    }

    const selector =
      definition.install?.strategy === 'skills-cli' ? definition.install.selector : definition.id
    const metadata = this.capabilityMetadata(definition.id)
    if (metadata.installPath) {
      const parsed = await parseSkillDirectory(metadata.installPath)
      if (parsed) {
        return {
          kind: 'skill',
          path: parsed.path,
          root: await this.rootForPath(parsed.path),
          enabled: metadata.enabled !== false,
          parsed
        }
      }
    }

    const skills = knownSkills ?? (await this.skillsService.list())
    const match = skills.find(
      (skill) =>
        !skill.readOnly &&
        (skill.name.toLowerCase() === selector.toLowerCase() ||
          path.basename(skill.path).toLowerCase() === selector.toLowerCase())
    )
    if (!match) return null
    const parsed = await parseSkillDirectory(match.path)
    if (!parsed) return null
    return {
      kind: 'skill',
      path: parsed.path,
      root: await this.rootForPath(parsed.path),
      enabled: metadata.enabled !== false,
      parsed
    }
  }

  async isDiscoverable(definition: CapabilityDefinition): Promise<boolean> {
    if (definition.builtin) return true
    if (definition.install?.strategy === 'pi-package') {
      const installed = await this.findInstalled(definition)
      return installed?.kind === 'package' && installed.package.health === 'healthy'
    }
    const selector =
      definition.install?.strategy === 'skills-cli' ? definition.install.selector : definition.id
    const skills = await this.skillsService.list()
    return skills.some(
      (skill) =>
        !skill.readOnly &&
        skill.isValid &&
        (skill.name.toLowerCase() === selector.toLowerCase() ||
          path.basename(skill.path).toLowerCase() === selector.toLowerCase())
    )
  }

  async globalRoot(): Promise<string> {
    const environment = await this.environment()
    if (!environment.configDir) {
      throw new SkillMutationError('SKILL_PATH_INVALID', 'Pi configuration directory is unknown')
    }
    const preferred = path.resolve(environment.configDir, 'skills')
    const roots = environment.skillsDirs.map((root) => path.resolve(root))
    if (roots.includes(preferred)) return preferred
    const piRoot = roots.find((root) => !root.endsWith(path.join('.agents', 'skills')))
    if (piRoot) return piRoot
    if (roots[0]) return roots[0]
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Pi has no configured skill directory')
  }

  async rootForPath(skillPath: string): Promise<string> {
    const resolved = path.resolve(skillPath)
    const environment = await this.environment()
    const root = environment.skillsDirs
      .map((candidate) => path.resolve(candidate))
      .find((candidate) => resolved.startsWith(candidate + path.sep))
    if (!root) {
      throw new SkillMutationError('SKILL_PATH_INVALID', 'Skill path is outside Pi skill roots')
    }
    return root
  }

  private async environment() {
    const settings = this.settingsStore.peek()
    return piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
  }

  private capabilityMetadata(id: string): CapabilityMetadata {
    return this.metadataStore.peek().capabilities[id] ?? {}
  }

  private toCatalogDescriptor(
    definition: CapabilityDefinition,
    installed: InstalledCapability | null
  ): CapabilityDescriptor {
    const metadata = this.capabilityMetadata(definition.id)
    const isBuiltin = Boolean(definition.builtin)
    const isPackage = installed?.kind === 'package'
    const installedVersion = isPackage
      ? installed.package.version
      : installed?.kind === 'skill'
        ? installed.parsed.version
        : null
    const updateAvailable = this.hasUpdate(definition.version, installedVersion)
    const enabled = installed?.enabled ?? isBuiltin
    const isInstalled = isBuiltin || Boolean(installed)
    const packageHealthy = !isPackage || installed.package.health === 'healthy'
    const managed = Boolean(metadata.installPath)
    return {
      ...definition,
      installed: isInstalled,
      enabled,
      health: metadata.lastErrorCode
        ? 'error'
        : !isInstalled
          ? 'not-installed'
          : !packageHealthy
            ? 'error'
            : !enabled || updateAvailable
              ? 'warning'
              : 'healthy',
      ownership: isInstalled
        ? {
            managedBy: isBuiltin
              ? 'external'
              : managed
                ? 'pi-harness'
                : isPackage
                  ? 'pi-package'
                  : 'external',
            scope: 'global',
            readOnly: isBuiltin
          }
        : undefined,
      installPath: installed?.path ?? null,
      installedVersion,
      lastModified: installed?.kind === 'skill' ? installed.parsed.lastModified : null,
      updateAvailable,
      lastErrorCode:
        metadata.lastErrorCode ?? (isPackage && !packageHealthy ? 'PACKAGE_HEALTH_ERROR' : null),
      lastErrorAt: metadata.lastErrorAt ?? null,
      lastErrorAction: metadata.lastErrorAction ?? null,
      status:
        metadata.lastErrorCode || (isPackage && !packageHealthy)
          ? 'failed'
          : !isInstalled
            ? 'not-installed'
            : !enabled
              ? 'disabled'
              : updateAvailable
                ? 'update-available'
                : 'installed',
      readOnly: isBuiltin
    }
  }

  private hasUpdate(
    availableVersion: string | undefined,
    installedVersion: string | null
  ): boolean {
    if (!availableVersion || !installedVersion) return false
    return semver.valid(availableVersion) && semver.valid(installedVersion)
      ? semver.gt(availableVersion, installedVersion)
      : availableVersion !== installedVersion
  }

  private toLocalDescriptor(skill: SkillInfo, parsed: ParsedSkill | null): CapabilityDescriptor {
    return {
      id: skill.name,
      type: 'skill',
      name: parsed?.name || skill.name,
      description: parsed?.description || skill.description,
      source: skill.origin === 'package' ? 'npm' : 'local',
      sourceUrl: skill.packageSource,
      featured: false,
      tags: parsed?.tags ?? [],
      installed: true,
      enabled: true,
      health: skill.isValid ? 'healthy' : 'error',
      ownership: {
        managedBy: skill.origin === 'package' ? 'pi-package' : 'external',
        scope:
          skill.scope === 'project' ? 'project' : skill.scope === 'global' ? 'global' : 'unknown',
        readOnly: Boolean(skill.readOnly)
      },
      installPath: skill.path,
      installedVersion: parsed?.version ?? null,
      lastModified: parsed?.lastModified ?? skill.lastModified,
      updateAvailable: false,
      status: 'installed',
      readOnly: Boolean(skill.readOnly)
    }
  }
}
