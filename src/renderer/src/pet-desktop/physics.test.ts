import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReleasePhysics } from './physics'

describe('release movement', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps ordinary drag releases stationary, including zero velocity', async () => {
    const move = vi.fn().mockResolvedValue({ x: 100, y: 100 })
    const physics = new ReleasePhysics(move)
    for (const velocity of [
      { x: 0, y: 0 },
      { x: 200, y: 100 }
    ]) {
      physics.launch(velocity)
      await vi.advanceTimersByTimeAsync(3000)
      expect(physics.active).toBe(false)
    }
    expect(move).not.toHaveBeenCalled()
  })

  it('a horizontal throw never gains downward velocity and eventually saves its position', async () => {
    let x = 100
    const move = vi.fn(async (dx: number, dy: number) => ({ x: (x += dx), y: 100 + dy }))
    const settled = vi.fn()
    const physics = new ReleasePhysics(move, settled)
    physics.launch({ x: 1000, y: 0 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(move).toHaveBeenCalled()
    expect(move.mock.calls.every(([, dy]) => dy === 0)).toBe(true)
    expect(physics.active).toBe(false)
    expect(settled).toHaveBeenCalledOnce()
  })

  it('does not queue moves while IPC is pending or resume after re-grabbing', async () => {
    let finish!: (position: { x: number; y: number }) => void
    const move = vi.fn(
      () =>
        new Promise<{ x: number; y: number }>((resolve) => {
          finish = resolve
        })
    )
    const physics = new ReleasePhysics(move)
    physics.launch({ x: 1000, y: 0 })
    await vi.advanceTimersByTimeAsync(500)
    expect(move).toHaveBeenCalledOnce()
    physics.cancel()
    finish({ x: 100, y: 100 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(move).toHaveBeenCalledOnce()
    expect(physics.active).toBe(false)
  })
})
