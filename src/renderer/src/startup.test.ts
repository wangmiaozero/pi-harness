import { describe, expect, it } from 'vitest'
import type { NodeRuntimeInfo } from '@shared/ipc/api-types'
import { runtimeStartupChecks } from './startup'

describe('startup runtime checks', () => {
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
