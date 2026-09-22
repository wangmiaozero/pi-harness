// @ts-nocheck
import type {
  CapabilityActionResult,
  CapabilityDefinition,
  CapabilityDescriptor,
  CapabilityMetadata,
  CapabilityMutationAction,
  CapabilityMutationProgress
} from '../../vendor/shared/capabilities/types.js'
import type { PiPackageActionResult, PiPackageTarget } from '../../vendor/shared/ipc/api-types.js'
import { findTrustedCapability } from '../../vendor/shared/capabilities/catalog.js'
import type { AppMetadata } from '../services/metadata-store.js'
import type { JsonStore } from '../services/storage.js'
import { AppError, SkillMutationError } from '../services/errors.js'
import { log } from '../services/logger.js'
import { SkillInstallService } from './skill-installer.js'
import { SkillRegistry } from './skill-registry.js'
import type { PiPackageManager } from '../packages/package-manager.js'

type ProgressListener = (progress: CapabilityMutationProgress) => void

export class CapabilityService {
  private readonly mutations = new Set<string>()
  private readonly listeners = new Set<ProgressListener>()

  constructor(
    private readonly metadataStore: JsonStore<AppMetadata>,
    private readonly registry: SkillRegistry,
    private readonly installer: SkillInstallService = new SkillInstallService(),
    private readonly packageManager?: PiPackageManager
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
        throw new SkillMutationError('SKILL_ALREADY_INSTALLED', 'Capability is already installed')
      }
      if (definition.install?.strategy === 'pi-package') {
        const output = await this.runPackageMutation(definition.install.source, 'install', skillId)
        const installed = await this.registry.findInstalled(definition)
        await this.setMetadata(skillId, {
          enabled: true,
          installSource: definition.source,
          sourceUrl: definition.sourceUrl,
          installPath: installed?.path,
          lastCheckedAt: Date.now(),
          lastUpdatedAt: Date.now(),
          tags: definition.tags,
          lastErrorCode: null,
          lastErrorAt: null,
          lastErrorAction: null
        })
        return this.successResult(skillId, 'install', startedAt, packageProcess(output))
      }
      this.assertSkillInstaller(definition)
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
      if (!installed) throw new SkillMutationError('SKILL_NOT_FOUND', 'Capability is not installed')
      if (definition.install?.strategy === 'pi-package') {
        const output = await this.runPackageMutation(definition.install.source, 'update', skillId)
        const refreshed = await this.registry.findInstalled(definition)
        await this.setMetadata(skillId, {
          enabled: true,
          installSource: definition.source,
          sourceUrl: definition.sourceUrl,
          installPath: refreshed?.path ?? installed.path,
          lastCheckedAt: Date.now(),
          lastUpdatedAt: Date.now(),
          tags: definition.tags,
          lastErrorCode: null,
          lastErrorAt: null,
          lastErrorAction: null
        })
        return this.successResult(skillId, 'update', startedAt, packageProcess(output))
      }
      this.assertSkillInstaller(definition)
      if (installed.kind !== 'skill') {
        throw new AppError('CAPABILITY_NOT_SUPPORTED', 'Unsupported capability installer')
      }
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
      if (!installed) throw new SkillMutationError('SKILL_NOT_FOUND', 'Capability is not installed')
      if (definition.install?.strategy === 'pi-package') {
        const output = await this.runPackageMutation(
          definition.install.source,
          'uninstall',
          skillId
        )
        await this.clearMetadata(skillId)
        return this.successResult(skillId, 'uninstall', startedAt, packageProcess(output))
      }
      this.assertSkillInstaller(definition)
      if (installed.kind !== 'skill') {
        throw new AppError('CAPABILITY_NOT_SUPPORTED', 'Unsupported capability installer')
      }
      this.emit({ skillId, action: 'uninstall', phase: 'uninstalling' })
      await this.installer.uninstall(installed.path, installed.root, definition.install.selector)
      await this.clearMetadata(skillId)
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
      this.assertSkillInstaller(definition)
      if (installed.kind !== 'skill') {
        throw new AppError(
          'CAPABILITY_NOT_SUPPORTED',
          'Pi packages cannot be enabled or disabled independently'
        )
      }
      this.emit({ skillId, action, phase: 'validating' })
      const installPath = await this.installer.setEnabled(
        installed.path,
        installed.root,
        definition.install.selector,
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
    if (!definition) {
      throw new SkillMutationError('SKILL_NOT_FOUND', 'Trusted capability was not found')
    }
    if (!definition.install) {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', 'Built-in capabilities cannot be mutated')
    }
    if (this.mutations.has(skillId)) {
      throw new SkillMutationError('SKILL_CONFLICT', 'A capability mutation is already running')
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
        message: error instanceof Error ? error.message : 'Capability mutation failed',
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

  private async clearMetadata(skillId: string): Promise<void> {
    const metadata = { ...this.metadataStore.peek().capabilities }
    delete metadata[skillId]
    await this.metadataStore.update({ capabilities: metadata })
  }

  private assertSkillInstaller(
    definition: CapabilityDefinition
  ): asserts definition is CapabilityDefinition & {
    install: { strategy: 'skills-cli'; selector: string; target: 'pi-global' }
  } {
    if (definition.install?.strategy !== 'skills-cli') {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', 'Capability does not use the Skills installer')
    }
  }

  private async runPackageMutation(
    source: string,
    action: Extract<CapabilityMutationAction, 'install' | 'update' | 'uninstall'>,
    skillId: string
  ): Promise<PiPackageActionResult> {
    if (!this.packageManager) {
      throw new AppError('CAPABILITY_NOT_SUPPORTED', 'Pi Package Manager is unavailable')
    }
    this.emit({
      skillId,
      action,
      phase: action === 'install' ? 'installing' : action === 'update' ? 'updating' : 'uninstalling'
    })
    const target: PiPackageTarget = {
      source,
      scope: 'global',
      projectRoot: null
    }
    const result =
      action === 'install'
        ? await this.packageManager.install(target)
        : action === 'update'
          ? await this.packageManager.update(target)
          : await this.packageManager.uninstall(target)
    if (!result.ok) throw packageMutationError(result)
    this.emit({ skillId, action, phase: 'validating' })
    return result
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

function packageProcess(result: PiPackageActionResult): {
  stdout: string
  stderr: string
  exitCode: number
} {
  return {
    stdout: result.stdout || result.logs.map((entry) => entry.message).join('\n'),
    stderr: result.stderr,
    exitCode: result.ok ? 0 : 1
  }
}

function packageMutationError(result: PiPackageActionResult): SkillMutationError {
  const code =
    result.errorCode === 'EACCES'
      ? 'SKILL_PERMISSION_DENIED'
      : result.errorCode === 'VERIFY_FAILED'
        ? 'SKILL_INVALID'
        : 'PROCESS_FAILED'
  return new SkillMutationError(code, result.message, {
    stderr: result.stderr || result.stdout || result.logs.map((entry) => entry.message).join('\n'),
    stdout: result.stdout,
    exitCode: 1,
    command: `pi ${result.action === 'uninstall' ? 'remove' : result.action} ${result.source}`
  })
}
