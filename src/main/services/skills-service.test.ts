import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  SKILL_MARKET_CATALOG,
  packageNameFromSource,
  resolveInstalledPackagePath
} from './skills-service'

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
