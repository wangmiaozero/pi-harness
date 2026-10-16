// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { communityManualUpdates } from './policy'
const mocks = vi.hoisted(() => ({ exists: vi.fn(), read: vi.fn() }))
vi.mock('node:fs', () => ({ default: { existsSync: mocks.exists, readFileSync: mocks.read } }))
afterEach(() => vi.unstubAllGlobals())
it('honors Community manual updates, keeps legacy behavior, and fails closed for damaged policy', () => {
  vi.stubGlobal('process', { ...process, resourcesPath: '/bundle' })
  mocks.exists.mockReturnValue(false)
  expect(communityManualUpdates()).toBe(false)
  mocks.exists.mockReturnValue(true)
  mocks.read.mockReturnValue('{"channel":"community","updateMode":"automatic"}')
  expect(communityManualUpdates()).toBe(true)
  mocks.read.mockReturnValue('{"channel":"verified","updateMode":"automatic"}')
  expect(communityManualUpdates()).toBe(false)
  mocks.read.mockReturnValue('{invalid')
  expect(communityManualUpdates()).toBe(true)
})
