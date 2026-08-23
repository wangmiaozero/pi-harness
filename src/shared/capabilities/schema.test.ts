import { describe, expect, it } from 'vitest'
import { capabilityMutationSchema, capabilityToggleSchema } from './schema'

describe('capability IPC schemas', () => {
  it('accepts only a constrained registry skill id', () => {
    expect(capabilityMutationSchema.parse({ skillId: 'odai' })).toEqual({ skillId: 'odai' })
    for (const skillId of ['../odai', '/tmp/odai', 'https://example.com/odai', 'odai;whoami']) {
      expect(capabilityMutationSchema.safeParse({ skillId }).success).toBe(false)
    }
  })

  it('rejects renderer-supplied source, URL, path, and install target fields', () => {
    for (const field of ['source', 'sourceUrl', 'path', 'installTarget']) {
      expect(
        capabilityMutationSchema.safeParse({ skillId: 'odai', [field]: 'untrusted' }).success
      ).toBe(false)
    }
    expect(capabilityToggleSchema.safeParse({ skillId: 'odai', enabled: true }).success).toBe(true)
  })
})
