// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RuntimeManager } from './runtime-manager'
import { verifyDistribution } from './distribution.mjs'
import { validateExecutable } from './validator'

vi.mock('./distribution.mjs', async (original) => ({
  ...(await original<typeof import('./distribution.mjs')>()),
  verifyDistribution: vi.fn()
}))
vi.mock('./validator', () => ({ validateExecutable: vi.fn(), probe: vi.fn() }))

describe('runtime verification cache', () => {
  let root: string
  let manager: RuntimeManager

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-runtime-cache-'))
    manager = new RuntimeManager({
      bundledRoot: root,
      userRoot: root,
      stateFile: path.join(root, 'state.json'),
      cache: root
    })
    await manager.initialize()
    vi.mocked(verifyDistribution).mockResolvedValue(undefined)
    vi.mocked(validateExecutable).mockResolvedValue({
      source: 'bundled',
      executablePath: path.join(root, 'pi'),
      version: '1.2.0',
      platform: process.platform,
      arch: process.arch,
      valid: true,
      integrity: 'verified',
      diagnosticMessages: []
    })
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.resetAllMocks()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('shares a slow in-flight verification and starts its expiry after completion', async () => {
    let finish!: () => void
    vi.mocked(verifyDistribution).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const first = manager.resolve('pi')
    await vi.advanceTimersByTimeAsync(20_000)
    const second = manager.resolve('pi')
    await vi.advanceTimersByTimeAsync(0)
    expect(verifyDistribution).toHaveBeenCalledTimes(1)
    finish()
    expect((await first).valid).toBe(true)
    expect((await second).valid).toBe(true)
    await manager.resolve('pi')
    expect(verifyDistribution).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_001)
    await manager.resolve('pi')
    expect(verifyDistribution).toHaveBeenCalledTimes(2)
  })

  it('does not let an old expiry remove a newer verification after invalidation', async () => {
    await manager.resolve('pi')
    await vi.advanceTimersByTimeAsync(5_000)
    manager.invalidate()
    await manager.resolve('pi')
    await vi.advanceTimersByTimeAsync(5_001)
    await manager.resolve('pi')
    expect(verifyDistribution).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    await manager.resolve('pi')
    expect(verifyDistribution).toHaveBeenCalledTimes(3)
  })
})
