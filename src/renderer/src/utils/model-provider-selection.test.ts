import { describe, expect, it } from 'vitest'
import { chooseModelCreateProvider } from './model-provider-selection'

const providers = [{ id: 'step-plan' }, { id: 'volcengine' }]

describe('chooseModelCreateProvider', () => {
  it('uses the first provider while the all filter is selected', () => {
    expect(chooseModelCreateProvider(providers, 'all')).toEqual({ id: 'step-plan' })
  })

  it('uses the currently filtered provider', () => {
    expect(chooseModelCreateProvider(providers, 'volcengine')).toEqual({ id: 'volcengine' })
  })

  it('falls back to the first provider when the current filter is stale', () => {
    expect(chooseModelCreateProvider(providers, 'removed-provider')).toEqual({ id: 'step-plan' })
  })

  it('returns undefined when no providers exist', () => {
    expect(chooseModelCreateProvider([], 'all')).toBeUndefined()
  })
})
