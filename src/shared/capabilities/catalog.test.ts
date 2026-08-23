import { describe, expect, it } from 'vitest'
import { CAPABILITY_CATALOG, findTrustedCapability, normalizeCapabilityDefinition } from './catalog'

describe('capability catalog', () => {
  it('normalizes tags and exposes Odai as an ordinary trusted skill', () => {
    const normalized = normalizeCapabilityDefinition({
      id: 'example',
      type: 'skill',
      name: 'Example',
      source: 'local',
      tags: ['Review', 'review', ' Git ']
    })

    expect(normalized.tags).toEqual(['git', 'review'])
    expect(findTrustedCapability('odai')).toMatchObject({
      type: 'skill',
      source: 'github',
      sourceUrl: 'https://github.com/orziz/odai',
      install: { strategy: 'skills-cli', selector: 'odai', target: 'pi-global' }
    })
  })

  it('contains only schema-valid trusted sources', () => {
    expect(CAPABILITY_CATALOG).toHaveLength(1)
    expect(() =>
      normalizeCapabilityDefinition({
        id: 'unsafe',
        type: 'skill',
        name: 'Unsafe',
        source: 'github',
        sourceUrl: 'https://example.com/unsafe'
      })
    ).toThrow()
  })
})
