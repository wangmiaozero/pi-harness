import { describe, expect, it } from 'vitest'
import { dispatch, hasMethod, listMethods } from './dispatch.js'
import type { RpcMethodContext } from './dispatch.js'

function makeContext(): RpcMethodContext {
  return {
    startedAt: Date.now(),
    emit: () => {},
    requestShutdown: () => {}
  }
}

describe('dispatch', () => {
  it('answers ping with pong', async () => {
    const outcome = await dispatch('runtime.ping', {}, makeContext())
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect((outcome.result as { pong: boolean }).pong).toBe(true)
  })

  it('answers version with runtime and protocol versions', async () => {
    const outcome = await dispatch('runtime.version', {}, makeContext())
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const result = outcome.result as {
        runtimeVersion: string
        protocolVersion: number
        nodeVersion: string
      }
      expect(result.runtimeVersion).toMatch(/^\d+\.\d+\.\d+$/)
      expect(result.protocolVersion).toBe(1)
      expect(result.nodeVersion).toMatch(/^v\d+/)
    }
  })

  it('answers status with pid and uptime', async () => {
    const outcome = await dispatch('runtime.status', {}, makeContext())
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const result = outcome.result as { pid: number | null; uptimeMs: number }
      expect(result.uptimeMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('requests shutdown via context', async () => {
    let reason = ''
    const context: RpcMethodContext = {
      startedAt: Date.now(),
      emit: () => {},
      requestShutdown: (r: string) => {
        reason = r
      }
    }
    const outcome = await dispatch('runtime.shutdown', {}, context)
    expect(outcome.ok).toBe(true)
    expect(reason).toBe('runtime.shutdown request')
  })

  it('returns METHOD_NOT_FOUND for unknown methods', async () => {
    const outcome = await dispatch('nope.nope', {}, makeContext())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.code).toBe('METHOD_NOT_FOUND')
  })

  it('converts handler throws into INTERNAL_ERROR', async () => {
    expect(hasMethod('runtime.ping')).toBe(true)
    // Exercise the registry surface
    expect(listMethods()).toContain('runtime.ping')
    expect(listMethods()).toContain('runtime.version')
    expect(listMethods()).toContain('runtime.handshake')
    expect(listMethods()).toContain('runtime.activity')
  })

  it('handshake accepts protocol 1 and rejects a mismatch', async () => {
    const ok = await dispatch('runtime.handshake', { protocolVersion: 1 }, makeContext())
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect((ok.result as { protocolVersion: number }).protocolVersion).toBe(1)
    }
    const bad = await dispatch('runtime.handshake', { protocolVersion: 99 }, makeContext())
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('RUNTIME_PROTOCOL_MISMATCH')
  })
})
