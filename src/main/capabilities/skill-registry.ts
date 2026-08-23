import path from 'node:path'
import type {
  CapabilityDefinition,
  CapabilityDescriptor,
  CapabilityMetadata
} from '@shared/capabilities/types'
import { CAPABILITY_CATALOG } from '@shared/capabilities/catalog'
import type { AppSettings, SkillInfo } from '@shared/ipc/api-types'
import type { AppMetadata } from '../services/metadata-store'
import type { JsonStore } from '../services/storage'
import type { SkillsService } from '../services/skills-service'
import { piEnvironment } from '../pi/environment'
import { parseSkillDirectory, type ParsedSkill } from './skill-parser'
import { SkillMutationError } from '../services/errors'

export interface InstalledCapability {
  path: string
  root: string
  enabled: boolean
  parsed: ParsedSkill
}

export class SkillRegistry {
  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly metadataStore: JsonStore<AppMetadata>,
    private readonly skillsService: SkillsService
  ) {}

  async list(): Promise<CapabilityDescriptor[]> {
    const installedSkills = await this.skillsService.list()
    const descriptors: CapabilityDescriptor[] = []
    const consumedPaths = new Set<string>()

    for (const definition of CAPABILITY_CATALOG) {
      const installed = await this.findInstalled(definition, installedSkills)
      if (installed) consumedPaths.add(path.resolve(installed.path))
      descriptors.push(this.toCatalogDescriptor(definition, installed))
    }

    for (const skill of installedSkills) {
      if (consumedPaths.has(path.resolve(skill.path))) continue
      const parsed = await parseSkillDirectory(skill.path)
      descriptors.push(this.toLocalDescriptor(skill, parsed))
    }

    return descriptors.sort(
      (left, right) =>
        Number(Boolean(right.featured)) - Number(Boolean(left.featured)) ||
        left.name.localeCompare(right.name) ||
        (left.installPath ?? '').localeCompare(right.installPath ?? '')
    )
  }

  async findInstalled(
    definition: CapabilityDefinition,
    knownSkills?: SkillInfo[]
  ): Promise<InstalledCapability | null> {
    const selector = definition.install?.selector ?? definition.id
    const metadata = this.capabilityMetadata(definition.id)
    if (metadata.installPath) {
      const parsed = await parseSkillDirectory(metadata.installPath)
      if (parsed) {
        return {
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
      path: parsed.path,
      root: await this.rootForPath(parsed.path),
      enabled: metadata.enabled !== false,
      parsed
    }
  }

  async isDiscoverable(definition: CapabilityDefinition): Promise<boolean> {
    const selector = definition.install?.selector ?? definition.id
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
    const installedVersion = installed?.parsed.version ?? null
    const updateAvailable = Boolean(
      definition.version && installedVersion && definition.version !== installedVersion
    )
    const enabled = installed?.enabled ?? true
    return {
      ...definition,
      installed: Boolean(installed),
      enabled,
      installPath: installed?.path ?? null,
      installedVersion,
      lastModified: installed?.parsed.lastModified ?? null,
      updateAvailable,
      lastErrorCode: metadata.lastErrorCode ?? null,
      lastErrorAt: metadata.lastErrorAt ?? null,
      lastErrorAction: metadata.lastErrorAction ?? null,
      status: metadata.lastErrorCode
        ? 'failed'
        : !installed
          ? 'not-installed'
          : !enabled
            ? 'disabled'
            : updateAvailable
              ? 'update-available'
              : 'installed'
    }
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
      installPath: skill.path,
      installedVersion: parsed?.version ?? null,
      lastModified: parsed?.lastModified ?? skill.lastModified,
      updateAvailable: false,
      status: 'installed',
      readOnly: Boolean(skill.readOnly)
    }
  }
}
