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

describe('SkillRegistry persisted capability state', () => {
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
      { list: async () => [] } as never
    )

    await expect(registry.list()).resolves.toEqual([
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
  })
})
