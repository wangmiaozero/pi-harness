import { describe, expect, it, vi } from 'vitest'
import type { CapabilityDescriptor } from '@shared/capabilities/types'
import { SkillMutationError } from '../services/errors'
import { CapabilityService } from './capability-service'
import { SkillRegistry } from './skill-registry'

const descriptor: CapabilityDescriptor = {
  id: 'odai',
  type: 'skill',
  name: 'Odai',
  source: 'github',
  sourceUrl: 'https://github.com/orziz/odai',
  install: { strategy: 'skills-cli', selector: 'odai', target: 'pi-global' },
  installed: true,
  enabled: true,
  health: 'healthy',
  installPath: '/fixture/skills/odai',
  installedVersion: null,
  lastModified: 1,
  updateAvailable: false,
  status: 'installed'
}

const superpowersDescriptor: CapabilityDescriptor = {
  id: 'superpowers',
  type: 'package',
  name: 'Superpowers',
  source: 'github',
  sourceUrl: 'https://github.com/obra/superpowers',
  version: '6.3.0',
  install: {
    strategy: 'pi-package',
    source: 'git:github.com/obra/superpowers',
    target: 'pi-global'
  },
  installed: true,
  enabled: true,
  health: 'healthy',
  installPath: '/fixture/git/github.com/obra/superpowers',
  installedVersion: '6.3.0',
  lastModified: null,
  updateAvailable: false,
  status: 'installed'
}

const installedSuperpowers = {
  kind: 'package',
  path: '/fixture/git/github.com/obra/superpowers',
  root: null,
  enabled: true,
  package: { version: '6.3.0', health: 'healthy' }
}

const successfulPackageResult = {
  source: 'git:github.com/obra/superpowers',
  scope: 'global',
  action: 'install',
  ok: true,
  skipped: false,
  message: 'Package is healthy',
  stdout: 'installed',
  stderr: '',
  errorCode: null,
  logs: [{ phase: 'verify', ok: true, message: 'Registry and files are healthy' }]
}

describe('CapabilityService mutation lock and metadata', () => {
  it('allows at most one concurrent mutation for the same trusted skill', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const metadata = {
      peek: vi.fn(() => ({ providers: {}, models: {}, capabilities: {} })),
      update: vi.fn(async () => ({ providers: {}, models: {}, capabilities: {} }))
    }
    const registry = {
      findInstalled: vi.fn(async () => null),
      globalRoot: vi.fn(async () => '/fixture/skills'),
      list: vi.fn(async () => [descriptor]),
      isDiscoverable: vi.fn(async () => true)
    }
    const installer = {
      install: vi.fn(async () => {
        await gate
        return {
          installPath: '/fixture/skills/odai',
          parsed: {},
          stdout: '',
          stderr: '',
          exitCode: 0,
          backupPath: null
        }
      })
    }
    const service = new CapabilityService(metadata as never, registry as never, installer as never)

    const first = service.install('odai')
    await vi.waitFor(() => expect(installer.install).toHaveBeenCalledOnce())
    await expect(service.install('odai')).rejects.toMatchObject({ code: 'SKILL_CONFLICT' })
    release()
    await expect(first).resolves.toMatchObject({ action: 'install', phase: 'success' })
    expect(metadata.update).toHaveBeenCalledWith({
      capabilities: {
        odai: expect.objectContaining({
          enabled: true,
          installSource: 'github',
          sourceUrl: 'https://github.com/orziz/odai',
          installPath: '/fixture/skills/odai',
          lastErrorCode: null,
          lastErrorAt: null,
          lastErrorAction: null
        })
      }
    })
  })

  it('persists a sanitised failure state for the next application launch', async () => {
    const metadata = {
      peek: vi.fn(() => ({ providers: {}, models: {}, capabilities: {} })),
      update: vi.fn(async () => ({ providers: {}, models: {}, capabilities: {} }))
    }
    const registry = {
      findInstalled: vi.fn(async () => null),
      globalRoot: vi.fn(async () => '/fixture/skills')
    }
    const installer = {
      install: vi.fn(async () => {
        throw new SkillMutationError('NETWORK_ERROR', 'Install failed', {
          stderr: 'sanitised stderr',
          exitCode: 1
        })
      })
    }
    const service = new CapabilityService(metadata as never, registry as never, installer as never)

    await expect(service.install('odai')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(metadata.update).toHaveBeenCalledWith({
      capabilities: {
        odai: expect.objectContaining({
          lastErrorCode: 'NETWORK_ERROR',
          lastErrorAction: 'install',
          lastErrorAt: expect.any(Number)
        })
      }
    })
    expect(JSON.stringify(metadata.update.mock.calls)).not.toContain('sanitised stderr')
  })
})

describe('CapabilityService Pi package capabilities', () => {
  it('installs Superpowers only through the existing Pi Package Manager', async () => {
    const metadata = {
      peek: vi.fn(() => ({ providers: {}, models: {}, capabilities: {} })),
      update: vi.fn(async () => ({ providers: {}, models: {}, capabilities: {} }))
    }
    const registry = {
      findInstalled: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(installedSuperpowers),
      list: vi.fn(async () => [superpowersDescriptor]),
      isDiscoverable: vi.fn(async () => true)
    }
    const packageManager = {
      install: vi.fn(async () => successfulPackageResult)
    }
    const service = new CapabilityService(
      metadata as never,
      registry as never,
      undefined,
      packageManager as never
    )

    await expect(service.install('superpowers')).resolves.toMatchObject({
      action: 'install',
      phase: 'success',
      capability: { id: 'superpowers', installed: true }
    })
    expect(packageManager.install).toHaveBeenCalledExactlyOnceWith({
      source: 'git:github.com/obra/superpowers',
      scope: 'global',
      projectRoot: null
    })
  })

  it('preserves command diagnostics when a package install fails', async () => {
    const metadata = {
      peek: vi.fn(() => ({ providers: {}, models: {}, capabilities: {} })),
      update: vi.fn(async () => ({ providers: {}, models: {}, capabilities: {} }))
    }
    const registry = { findInstalled: vi.fn(async () => null) }
    const packageManager = {
      install: vi.fn(async () => ({
        ...successfulPackageResult,
        ok: false,
        message: 'Package command failed',
        stdout: '',
        stderr: 'fatal: repository unavailable',
        errorCode: 'PROCESS_FAILED'
      }))
    }
    const progress = vi.fn()
    const service = new CapabilityService(
      metadata as never,
      registry as never,
      undefined,
      packageManager as never
    )
    service.onProgress(progress)

    await expect(service.install('superpowers')).rejects.toMatchObject({
      code: 'PROCESS_FAILED',
      details: {
        stderr: 'fatal: repository unavailable',
        command: 'pi install git:github.com/obra/superpowers'
      }
    })
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skillId: 'superpowers',
        action: 'install',
        phase: 'failed',
        stderr: 'fatal: repository unavailable'
      })
    )
  })

  it('routes Superpowers update and uninstall through Pi package operations', async () => {
    const metadataState = {
      providers: {},
      models: {},
      capabilities: { superpowers: { installPath: installedSuperpowers.path } }
    }
    const metadata = {
      peek: vi.fn(() => metadataState),
      update: vi.fn(async () => metadataState)
    }
    const registry = {
      findInstalled: vi.fn(async () => installedSuperpowers),
      list: vi
        .fn()
        .mockResolvedValueOnce([superpowersDescriptor])
        .mockResolvedValueOnce([
          { ...superpowersDescriptor, installed: false, status: 'not-installed' }
        ]),
      isDiscoverable: vi.fn(async () => true)
    }
    const packageManager = {
      update: vi.fn(async () => ({ ...successfulPackageResult, action: 'update' })),
      uninstall: vi.fn(async () => ({ ...successfulPackageResult, action: 'uninstall' }))
    }
    const service = new CapabilityService(
      metadata as never,
      registry as never,
      undefined,
      packageManager as never
    )
    const progress = vi.fn()
    service.onProgress(progress)

    await expect(service.update('superpowers')).resolves.toMatchObject({ action: 'update' })
    await expect(service.uninstall('superpowers')).resolves.toMatchObject({ action: 'uninstall' })
    expect(packageManager.update).toHaveBeenCalledOnce()
    expect(packageManager.uninstall).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', phase: 'updating' })
    )
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'uninstall', phase: 'uninstalling' })
    )
  })
})

describe('SkillRegistry persisted capability state', () => {
  it('reports Native Pi and the installed Superpowers package in catalog order', async () => {
    const registry = new SkillRegistry(
      {} as never,
      {
        peek: () => ({ providers: {}, models: {}, capabilities: {} })
      } as never,
      {
        list: async () => [],
        listPackages: async () => [
          {
            source: 'git:github.com/obra/superpowers',
            scope: 'global',
            registered: true,
            installed: true,
            path: '/fixture/git/github.com/obra/superpowers',
            version: '6.2.0',
            health: 'healthy'
          }
        ]
      } as never
    )

    const capabilities = await registry.list()

    expect(capabilities.slice(0, 3).map((entry) => entry.id)).toEqual([
      'native-pi',
      'superpowers',
      'odai'
    ])
    expect(capabilities[0]).toMatchObject({
      installed: true,
      builtin: true,
      readOnly: true,
      status: 'installed'
    })
    expect(capabilities[1]).toMatchObject({
      installed: true,
      installedVersion: '6.2.0',
      updateAvailable: true,
      status: 'update-available'
    })
  })

  it('restores a failed catalog status from Harness metadata', async () => {
    const registry = new SkillRegistry(
      {} as never,
      {
        peek: () => ({
          providers: {},
          models: {},
          capabilities: {
            odai: {
              lastErrorCode: 'NETWORK_ERROR',
              lastErrorAction: 'install',
              lastErrorAt: 123
            }
          }
        })
      } as never,
      { list: async () => [], listPackages: async () => [] } as never
    )

    await expect(registry.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'odai',
          installed: false,
          status: 'failed',
          health: 'error',
          lastErrorCode: 'NETWORK_ERROR',
          lastErrorAction: 'install',
          lastErrorAt: 123
        })
      ])
    )
  })
})
