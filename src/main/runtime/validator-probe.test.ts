// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ failures: 0, code: 'EBADF', calls: 0 }))
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      state.calls++
      if (state.failures-- > 0)
        throw Object.assign(new Error('fixture descriptor failure'), { code: state.code })
      return actual.spawn(...args)
    }
  }
})
import { probe } from './validator'
afterEach(() => {
  state.failures = state.calls = 0
  state.code = 'EBADF'
})

it('closes standard input for noninteractive runtime probes', async () => {
  const program = "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('1.2.0'))"
  await expect(probe(process.execPath, ['-e', program], process.env)).resolves.toBe('1.2.0')
}, 20_000)

it('retries a descriptor failure once and still obtains a real version', async () => {
  state.failures = 1
  await expect(probe(process.execPath, ['--version'], process.env)).resolves.toMatch(
    /^v\d+\.\d+\.\d+$/
  )
  expect(state.calls).toBe(2)
})
it.each(['EBADF', 'EACCES'])('fails closed without unbounded retries for %s', async (code) => {
  state.failures = 3
  state.code = code
  await expect(probe(process.execPath, ['--version'], process.env)).rejects.toThrow(code)
  expect(state.calls).toBe(code === 'EBADF' ? 2 : 1)
})
it('bounds probe output and does not disclose its contents in an error', async () => {
  await expect(
    probe(
      process.execPath,
      ['-e', "process.stdout.write('private-fixture-data'.repeat(100000))"],
      process.env
    )
  ).rejects.toThrow('ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
})
