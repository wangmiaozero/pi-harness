import { describe, expect, it, vi } from 'vitest'

const internalsPresent = vi.fn(() => true)

describe('detect', () => {
  it('isTauriHost checks __TAURI_INTERNALS__ at runtime', async () => {
    const windowSpy = vi.spyOn(globalThis, 'window', 'get')
    windowSpy.mockReturnValue({ __TAURI_INTERNALS__: internalsPresent() } as unknown as Window &
      typeof globalThis)
    const { isTauriHost } = await import('./detect')
    expect(isTauriHost()).toBe(true)
    windowSpy.mockReturnValue({} as unknown as Window & typeof globalThis)
    expect(isTauriHost()).toBe(false)
    windowSpy.mockRestore()
  })

  it('pendingMethodPayload carries the namespace and method', async () => {
    const { pendingMethodPayload, SHELL_METHOD_PENDING } = await import('./detect')
    const payload = pendingMethodPayload('git', 'status')
    expect(payload.code).toBe(SHELL_METHOD_PENDING)
    expect(payload.recoverable).toBe(false)
    expect(payload.context).toEqual({ namespace: 'git', method: 'status' })
  })

  it('pendingMethod rejects with the payload', async () => {
    const { pendingMethod } = await import('./detect')
    const error = await pendingMethod('pi', 'detect').catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'SHELL_METHOD_PENDING' })
  })
})
