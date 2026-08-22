import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const piProcessMock = vi.hoisted(() => ({ exec: vi.fn() }))

vi.mock('../process/pi-process', () => ({ piProcess: piProcessMock }))

import {
  SKILL_MARKET_CATALOG,
  SkillsService,
  packageNameFromSource,
  resolveInstalledPackagePath
} from './skills-service'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Skills marketplace catalog', () => {
  it('uses stable product entries instead of reference-document titles', () => {
    expect(SKILL_MARKET_CATALOG.map((entry) => entry.id)).toEqual([
      'core-development',
      'agent-architecture',
      'curated-extensions'
    ])
  })

  it('contains unique install sources and no duplicate Git alternative', () => {
    for (const entry of SKILL_MARKET_CATALOG) {
      expect(new Set(entry.sources).size).toBe(entry.sources.length)
      expect(entry.sources.every((source) => source.startsWith('npm:'))).toBe(true)
    }
    expect(SKILL_MARKET_CATALOG[0].sources).toHaveLength(7)
    expect(SKILL_MARKET_CATALOG[1].sources).toHaveLength(13)
    expect(SKILL_MARKET_CATALOG[2].sources).toHaveLength(21)
    expect(SKILL_MARKET_CATALOG[2].sources).toEqual(
      expect.arrayContaining([
        'npm:pi-agent-mode',
        'npm:pi-crew',
        'npm:@baochunli/pi-collaborating-agents',
        'npm:pi-sub-agent',
        'npm:pi-mcp-extension',
        'npm:pi-lmstudio',
        'npm:@langchain/langsmith-pi-extension'
      ])
    )
  })
})

describe('Pi package source paths', () => {
  it('handles scoped and versioned npm package sources', () => {
    expect(packageNameFromSource('npm:@scope/pi-tool@1.2.3')).toBe('@scope/pi-tool')
    expect(packageNameFromSource('npm:pi-tool@1.2.3')).toBe('pi-tool')
    expect(resolveInstalledPackagePath('/agent', 'npm:@scope/pi-tool@1.2.3')).toBe(
      path.join('/agent', 'npm', 'node_modules', '@scope/pi-tool')
    )
  })
})

describe('Pi package removal', () => {
  it('deduplicates sources and continues after skipped or failed removals', async () => {
    const service = new SkillsService({} as never)
    vi.spyOn(service, 'listPackages').mockResolvedValue([
      {
        source: 'npm:pi-one',
        name: 'pi-one',
        version: '1.0.0',
        description: '',
        path: null,
        installed: true,
        available: false,
        resources: { skills: [], prompts: [], extensions: [], themes: [] }
      },
      {
        source: 'npm:pi-two',
        name: 'pi-two',
        version: '2.0.0',
        description: '',
        path: null,
        installed: true,
        available: false,
        resources: { skills: [], prompts: [], extensions: [], themes: [] }
      }
    ])
    piProcessMock.exec
      .mockResolvedValueOnce({ stdout: 'removed one', stderr: '', exitCode: 0, signal: null })
      .mockRejectedValueOnce(new Error('remove two failed'))

    const results = await service.removePackages([
      'npm:pi-one',
      'npm:pi-missing',
      'npm:pi-one',
      'npm:pi-two'
    ])

    expect(piProcessMock.exec).toHaveBeenCalledTimes(2)
    expect(piProcessMock.exec).toHaveBeenNthCalledWith(1, {
      args: ['remove', 'npm:pi-one', '--no-approve'],
      timeoutMs: 5 * 60_000
    })
    expect(piProcessMock.exec).toHaveBeenNthCalledWith(2, {
      args: ['remove', 'npm:pi-two', '--no-approve'],
      timeoutMs: 5 * 60_000
    })
    expect(results).toMatchObject([
      { source: 'npm:pi-one', ok: true, skipped: false },
      { source: 'npm:pi-missing', ok: true, skipped: true },
      { source: 'npm:pi-two', ok: false, skipped: false, message: 'remove two failed' }
    ])
  })
})
