import { describe, expect, it } from 'vitest'
import { CAPABILITY_CATALOG, findTrustedCapability, normalizeCapabilityDefinition } from './catalog'

describe('capability catalog', () => {
  it('normalizes tags and exposes trusted capabilities in product order', () => {
    const normalized = normalizeCapabilityDefinition({
      id: 'example',
      type: 'skill',
      name: 'Example',
      source: 'local',
      tags: ['Review', 'review', ' Git ']
    })

    expect(normalized.tags).toEqual(['git', 'review'])
    expect(CAPABILITY_CATALOG.map((entry) => entry.id)).toEqual([
      'native-pi',
      'superpowers',
      'odai'
    ])
    expect(findTrustedCapability('native-pi')).toMatchObject({
      type: 'preset',
      builtin: true,
      optional: false,
      integration: 'native-pi'
    })
    expect(findTrustedCapability('superpowers')).toMatchObject({
      type: 'package',
      recommended: true,
      optional: true,
      sourceUrl: 'https://github.com/obra/superpowers',
      install: {
        strategy: 'pi-package',
        source: 'git:github.com/obra/superpowers',
        target: 'pi-global'
      }
    })
    expect(findTrustedCapability('odai')).toMatchObject({
      type: 'skill',
      recommended: false,
      optional: true,
      category: 'governance-methodology',
      source: 'github',
      sourceUrl: 'https://github.com/orziz/odai',
      install: { strategy: 'skills-cli', selector: 'odai', target: 'pi-global' }
    })
  })

  it('contains only schema-valid trusted sources', () => {
    expect(CAPABILITY_CATALOG).toHaveLength(3)
    expect(() =>
      normalizeCapabilityDefinition({
        id: 'unsafe',
        type: 'skill',
        name: 'Unsafe',
        source: 'github',
        sourceUrl: 'https://example.com/unsafe'
      })
    ).toThrow()
    expect(() =>
      normalizeCapabilityDefinition({
        id: 'unsafe-package',
        type: 'package',
        name: 'Unsafe package',
        source: 'github',
        sourceUrl: 'https://github.com/example/unsafe',
        install: {
          strategy: 'pi-package',
          source: 'https://example.com/unsafe',
          target: 'pi-global'
        }
      })
    ).toThrow()
  })
})
