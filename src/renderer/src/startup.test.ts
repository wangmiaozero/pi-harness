import { describe, expect, it } from 'vitest'
import type { NodeRuntimeInfo } from '@shared/ipc/api-types'
import { runtimeStartupChecks, STARTUP_MINIMUM_VISIBLE_MS } from './startup'

describe('startup runtime checks', () => {
  it('keeps the startup animation visible for at least five seconds', () => {
    expect(STARTUP_MINIMUM_VISIBLE_MS).toBe(5000)
  })

  it('keeps a supported Node healthy when npm is missing', () => {
    const runtime = {
      nodeInstalled: true,
      nodeSupported: true,
      nodeVersion: 'v24.15.0',
      npmInstalled: false,
      npmVersion: null,
      ready: false
    } as NodeRuntimeInfo

    expect(runtimeStartupChecks(runtime)).toEqual({
      node: { state: 'healthy', detail: '已就绪 · v24.15.0' },
      npm: { state: 'warning', detail: '未检测到' }
    })
  })

  it('reports failed checks when environment detection fails', () => {
    expect(runtimeStartupChecks(null)).toEqual({
      node: { state: 'error', detail: '检测失败' },
      npm: { state: 'error', detail: '检测失败' }
    })
  })
})
