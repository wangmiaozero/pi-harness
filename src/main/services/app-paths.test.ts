import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { appDefaultWorkspaceAliases, initAppPaths } from './app-paths'

describe('managed scratch workspace profile identities', () => {
  it.each(['Pi-Harness', 'Pi-Harness-dev'])(
    'recognizes sibling production and development identities from %s',
    (profile) => {
      const base = path.resolve('test-profiles')
      initAppPaths({ getPath: () => path.join(base, profile) } as unknown as import('electron').App)
      expect(appDefaultWorkspaceAliases()).toEqual([
        path.join(base, 'Pi-Harness', 'workspaces', 'default'),
        path.join(base, 'Pi-Harness-dev', 'workspaces', 'default')
      ])
    }
  )
  it('does not invent profile identities for arbitrary user-data overrides', () => {
    initAppPaths({
      getPath: () => path.resolve('test-profiles', 'custom')
    } as unknown as import('electron').App)
    expect(appDefaultWorkspaceAliases()).toEqual([])
  })
})
