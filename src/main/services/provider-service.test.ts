import { describe, expect, it, vi } from 'vitest'
import { ProviderService, resolveEnabledProviderKey } from './provider-service'

const piProvider = {
  api: 'openai-completions' as const,
  models: []
}

describe('ProviderService enabled-state invariant', () => {
  it('selects at most one provider when metadata has multiple enabled entries', async () => {
    const config = {
      read: vi.fn(async () => ({
        models: { providers: { nvidia: piProvider, stepfun: piProvider } },
        settings: { defaultProvider: 'stepfun' },
        modelsMtime: null,
        settingsMtime: null
      }))
    }
    const metadata = {
      read: vi.fn(async () => ({
        providers: {
          nvidia: { enabled: true },
          stepfun: { enabled: true }
        },
        models: {},
        capabilities: {},
        builtinSkills: { schemaVersion: 1, installed: {} }
      }))
    }
    const service = new ProviderService(config as never, metadata as never)

    const providers = await service.list()

    expect(
      providers.filter((provider) => provider.enabled).map((provider) => provider.key)
    ).toEqual(['stepfun'])
  })

  it('uses the active provider while metadata is temporarily missing', () => {
    expect(resolveEnabledProviderKey(['nvidia', 'stepfun'], {}, 'stepfun')).toBe('stepfun')
  })

  it('keeps a known enabled provider selected while a new provider has no metadata', () => {
    expect(
      resolveEnabledProviderKey(['nvidia', 'stepfun'], { nvidia: { enabled: true } }, 'stepfun')
    ).toBe('nvidia')
  })

  it('allows all providers to remain disabled when metadata explicitly disables them', () => {
    expect(
      resolveEnabledProviderKey(
        ['nvidia', 'stepfun'],
        { nvidia: { enabled: false }, stepfun: { enabled: false } },
        'stepfun'
      )
    ).toBeNull()
  })
})
