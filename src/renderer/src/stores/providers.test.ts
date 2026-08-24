import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PiSwitchAPI, ProviderProfile } from '@shared/ipc/api-types'
import { useProvidersStore } from './providers'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function provider(key: string): ProviderProfile {
  return {
    id: key,
    key,
    name: key,
    displayName: key,
    enabled: true,
    protocol: 'openai-completions',
    baseUrl: '',
    apiKeyRef: null,
    apiKey: null,
    headers: {},
    authHeader: true,
    timeout: null,
    defaultModelId: null,
    modelCount: 0,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('providers store refresh ordering', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    delete window.piSwitch
  })

  it('does not let an older list response overwrite the latest provider state', async () => {
    const first = deferred<ProviderProfile[]>()
    const second = deferred<ProviderProfile[]>()
    const list = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    window.piSwitch = { providers: { list } } as unknown as PiSwitchAPI
    const store = useProvidersStore()

    const firstFetch = store.fetchList()
    const secondFetch = store.fetchList()
    second.resolve([provider('stepfun')])
    await secondFetch
    first.resolve([provider('nvidia')])
    await firstFetch

    expect(store.items.map((item) => item.key)).toEqual(['stepfun'])
    expect(store.loading).toBe(false)
  })
})
