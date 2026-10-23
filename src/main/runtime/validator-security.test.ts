// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const state = vi.hoisted(() => ({ version: '24.22.0', compatible: true }))
vi.mock('./binary-identity.mjs', () => ({
  binaryIdentity: async () => ({ platform: process.platform, arch: process.arch })
}))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  const execFile = Object.assign(() => undefined, {
    [promisify.custom]: () =>
      Object.assign(
        Promise.resolve({
          stdout: JSON.stringify({
            version: state.version,
            platform: process.platform,
            arch: process.arch,
            compatible: state.compatible
          })
        }),
        { child: { stdin: { end() {} } } }
      )
  })
  return { execFile }
})
import { validateExecutable } from './validator'
const roots: string[] = []
afterEach(async () => {
  state.compatible = true
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
it('rejects a patched Node 26 executable that lacks required tool APIs', async () => {
  state.version = '26.12.1'
  state.compatible = false
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node26-compatibility-'))
  roots.push(root)
  const file = path.join(root, 'node')
  await fs.writeFile(file, 'fixture', { mode: 0o755 })
  const result = await validateExecutable('node', 'custom', file)
  expect(result.valid).toBe(false)
  expect(result.security?.patchStatus).toBe('FIXED')
  expect(result.diagnosticMessages.join(' ')).toContain('compatible tool APIs')
})
it.each([
  ['24.22.0', false],
  ['24.22.1', true],
  ['22.23.3', false],
  ['22.23.4', true],
  ['26.12.0', false],
  ['26.12.1', true],
  ['20.20.2', false],
  ['28.0.0', false]
])(
  'validates real process metadata for %s without hiding a rejected version',
  async (version, allowed) => {
    state.version = version
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node-security-validator-'))
    roots.push(root)
    const file = path.join(root, 'node')
    await fs.writeFile(file, 'fixture', { mode: 0o755 })
    const result = await validateExecutable('node', 'custom', file)
    expect(result.version).toBe(version)
    expect(result.valid).toBe(allowed)
    expect(result.security?.executionAllowed).toBe(allowed)
    if (!allowed) expect(result.diagnosticMessages.join(' ')).toContain('Node.js 24.22.1')
  }
)
