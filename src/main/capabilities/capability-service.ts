import type {
  CapabilityActionResult,
  CapabilityDescriptor,
  CapabilityMetadata,
  CapabilityMutationAction,
  CapabilityMutationProgress
} from '@shared/capabilities/types'
import { findTrustedCapability } from '@shared/capabilities/catalog'
import type { AppMetadata } from '../services/metadata-store'
import type { JsonStore } from '../services/storage'
import { AppError, SkillMutationError } from '../services/errors'
import { log } from '../services/logger'
import { SkillInstallService } from './skill-installer'
import { SkillRegistry } from './skill-registry'

type ProgressListener = (progress: CapabilityMutationProgress) => void

export class CapabilityService {
  private readonly mutations = new Set<string>()
  private readonly listeners = new Set<ProgressListener>()

  constructor(
    private readonly metadataStore: JsonStore<AppMetadata>,
    private readonly registry: SkillRegistry,
    private readonly installer: SkillInstallService = new SkillInstallService()
  ) {}

  list(): Promise<CapabilityDescriptor[]> {
    return this.registry.list()
  }

  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  install(skillId: string): Promise<CapabilityActionResult> {
    return this.mutate(skillId, 'install', async (definition, startedAt) => {
      if (await this.registry.findInstalled(definition)) {
        throw new SkillMutationError('SKILL_ALREADY_INSTALLED', 'Skill is already installed')
      }
      const targetRoot = await this.registry.globalRoot()
      const output = await this.installer.install(definition, targetRoot, {
        replace: false,
        onPhase: (phase) => this.emit({ skillId, action: 'install', phase })
      })
      await this.setMetadata(skillId, {
        enabled: true,
        installSource: definition.source,
        sourceUrl: definition.sourceUrl,
        installPath: output.installPath,
        lastCheckedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        tags: definition.tags,
        lastErrorCode: null,
        lastErrorAt: null,
        lastErrorAction: null
      })
      return this.successResult(skillId, 'install', startedAt, output)
    })
  }

  update(skillId: string): Promise<CapabilityActionResult> {
    return this.mutate(skillId, 'update', async (definition, startedAt) => {
      const installed = await this.registry.findInstalled(definition)
      if (!installed) throw new SkillMutationError('SKILL_NOT_FOUND', 'Skill is not installed')
      const output = await this.installer.install(definition, installed.root, {
        replace: true,
        existingPath: installed.path,
        onPhase: (phase) => this.emit({ skillId, action: 'update', phase })
      })
      await this.setMetadata(skillId, {
        enabled: installed.enabled,
        installSource: definition.source,
        sourceUrl: definition.sourceUrl,
        installPath: output.installPath,
        lastCheckedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        tags: definition.tags,
        lastErrorCode: null,
        lastErrorAt: null,
        lastErrorAction: null
      })
      return this.successResult(skillId, 'update', startedAt, output)
    })
  }

  uninstall(skillId: string): Promise<CapabilityActionResult> {
    return this.mutate(skillId, 'uninstall', async (definition, startedAt) => {
      const installed = await this.registry.findInstalled(definition)
      if (!installed) throw new SkillMutationError('SKILL_NOT_FOUND', 'Skill is not installed')
      this.emit({ skillId, action: 'uninstall', phase: 'installing' })
      await this.installer.uninstall(
        installed.path,
        installed.root,
        definition.install?.selector ?? definition.id
      )
      const metadata = { ...this.metadataStore.peek().capabilities }
      delete metadata[skillId]
      await this.metadataStore.update({ capabilities: metadata })
      return this.successResult(skillId, 'uninstall', startedAt, {
        stdout: '',
        stderr: '',
        exitCode: 0
      })
    })
  }

  setEnabled(skillId: string, enabled: boolean): Promise<CapabilityActionResult> {
    const action: CapabilityMutationAction = enabled ? 'enable' : 'disable'
    return this.mutate(skillId, action, async (definition, startedAt) => {
      const installed = await this.registry.findInstalled(definition)
      if (!installed) throw new SkillMutationError('SKILL_NOT_FOUND', 'Skill is not installed')
      this.emit({ skillId, action, phase: 'validating' })
      const installPath = await this.installer.setEnabled(
        installed.path,
        installed.root,
        definition.install?.selector ?? definition.id,
        enabled
      )
      await this.setMetadata(skillId, {
        enabled,
        installSource: definition.source,
        sourceUrl: definition.sourceUrl,
        installPath,
        lastUpdatedAt: Date.now(),
        tags: definition.tags,
        lastErrorCode: null,
        lastErrorAt: null,
        lastErrorAction: null
      })
      return this.successResult(skillId, action, startedAt, {
        stdout: '',
        stderr: '',
        exitCode: 0
      })
    })
  }

  private async mutate(
    skillId: string,
    action: CapabilityMutationAction,
    operation: (
      definition: NonNullable<ReturnType<typeof findTrustedCapability>>,
      startedAt: number
    ) => Promise<CapabilityActionResult>
  ): Promise<CapabilityActionResult> {
    const definition = findTrustedCapability(skillId)
    if (!definition || definition.type !== 'skill') {
      throw new SkillMutationError('SKILL_NOT_FOUND', 'Trusted skill was not found')
    }
    if (this.mutations.has(skillId)) {
      throw new SkillMutationError('SKILL_CONFLICT', 'A skill mutation is already running')
    }

    const startedAt = Date.now()
    this.mutations.add(skillId)
    this.emit({ skillId, action, phase: 'resolving' })
    try {
      const result = await operation(definition, startedAt)
      this.emit({ skillId, action, phase: 'success', exitCode: result.exitCode })
      log.skills.info('capability mutation finished', {
        skill: skillId,
        action,
        duration: result.durationMs,
        exitCode: result.exitCode,
        result: 'success'
      })
      return result
    } catch (error) {
      await this.recordFailure(skillId, action, error).catch((metadataError) => {
        log.skills.warn('failed to persist capability mutation error', {
          skill: skillId,
          action,
          error: metadataError
        })
      })
      const details = (error as { details?: unknown }).details as
        { stderr?: string; exitCode?: number | null } | undefined
      this.emit({
        skillId,
        action,
        phase: 'failed',
        message: error instanceof Error ? error.message : 'Skill mutation failed',
        stderr: details?.stderr,
        exitCode: details?.exitCode
      })
      log.skills.error('capability mutation finished', {
        skill: skillId,
        action,
        duration: Date.now() - startedAt,
        exitCode: details?.exitCode ?? null,
        result: 'failed',
        error
      })
      throw error
    } finally {
      this.mutations.delete(skillId)
    }
  }

  private emit(progress: CapabilityMutationProgress): void {
    this.listeners.forEach((listener) => listener(progress))
  }

  private async setMetadata(skillId: string, patch: CapabilityMetadata): Promise<void> {
    const current = this.metadataStore.peek()
    await this.metadataStore.update({
      capabilities: {
        ...current.capabilities,
        [skillId]: {
          ...current.capabilities[skillId],
          ...patch
        }
      }
    })
  }

  private async recordFailure(
    skillId: string,
    action: CapabilityMutationAction,
    error: unknown
  ): Promise<void> {
    await this.setMetadata(skillId, {
      lastErrorCode: error instanceof AppError ? error.code : 'APP_ERROR',
      lastErrorAt: Date.now(),
      lastErrorAction: action
    })
  }

  private async successResult(
    skillId: string,
    action: CapabilityMutationAction,
    startedAt: number,
    process: { stdout: string; stderr: string; exitCode: number }
  ): Promise<CapabilityActionResult> {
    const capability = (await this.registry.list()).find((entry) => entry.id === skillId)
    if (!capability) {
      throw new SkillMutationError('SKILL_INVALID', 'Skill registry did not refresh after mutation')
    }
    if (action !== 'uninstall' && !capability.installed) {
      throw new SkillMutationError('SKILL_INVALID', 'Pi could not discover the installed skill')
    }
    if (
      capability.enabled &&
      ['install', 'update', 'enable'].includes(action) &&
      !(await this.registry.isDiscoverable(findTrustedCapability(skillId)!))
    ) {
      throw new SkillMutationError('SKILL_INVALID', 'Pi could not discover the installed skill')
    }
    return {
      capability,
      action,
      phase: 'success',
      durationMs: Date.now() - startedAt,
      exitCode: process.exitCode,
      stdout: process.stdout,
      stderr: process.stderr
    }
  }
}
