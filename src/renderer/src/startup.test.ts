import { describe, expect, it } from 'vitest'
import type { NodeRuntimeInfo } from '@shared/ipc/api-types'
import {
  runtimeStartupChecks,
  shouldPlayStartupAnimation,
  STARTUP_MINIMUM_VISIBLE_MS
} from './startup'

describe('startup runtime checks', () => {
  it('keeps the startup animation visible for at least five seconds', () => {
    expect(STARTUP_MINIMUM_VISIBLE_MS).toBe(5000)
  })

  it('plays only for a cold launch, not a window reopened in the same process', () => {
    expect(shouldPlayStartupAnimation('')).toBe(true)
    expect(shouldPlayStartupAnimation('?startup=1')).toBe(true)
    expect(shouldPlayStartupAnimation('?startup=0')).toBe(false)
    expect(shouldPlayStartupAnimation('?foo=1&startup=0')).toBe(false)
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
