// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RuntimeManager } from './runtime-manager'
import { buildRuntimeEnvironment } from './environment'
import { validateExecutable, binaryIdentity } from './validator'
import { runtimeSwitchSchema } from '@shared/runtime/schema'
import { assertArchivePath, catalog, inventory, verifyDistribution } from './distribution.mjs'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi runtime 空格 '))
  directories.push(root)
  const manager = new RuntimeManager({
    bundledRoot: path.join(root, 'missing'),
    userRoot: path.join(root, 'managed'),
    stateFile: path.join(root, 'state.json'),
    cache: path.join(root, 'cache')
  })
  return { root, manager }
}

describe('runtime isolation and configuration', () => {
  it('defaults Pi and Node independently to bundled and never silently resolves a system fallback', async () => {
    const { manager } = await setup()
    expect(await manager.configuration()).toEqual({
      pi: { source: 'bundled' },
      node: { source: 'bundled' }
    })
    expect(await manager.resolve('pi')).toMatchObject({
      source: 'bundled',
      valid: false,
      integrity: 'failed'
    })
    expect(await manager.resolve('node')).toMatchObject({ source: 'bundled', valid: false })
  })
  it('preserves a legacy explicit Pi path without changing Node selection', async () => {
    const { root } = await setup()
    const manager = new RuntimeManager({
      bundledRoot: root,
      userRoot: root,
      stateFile: path.join(root, 'legacy.json'),
      cache: root,
      legacyPiPath: '/custom/pi'
    })
    expect(await manager.configuration()).toEqual({
      pi: { source: 'custom', customPath: '/custom/pi' },
      node: { source: 'bundled' }
    })
  })
  it('rejects an invalid selection without writing configuration or deleting user files', async () => {
    const { root, manager } = await setup()
    await fs.writeFile(path.join(root, 'history.jsonl'), 'history')
    await expect(
      manager.switchNodeRuntime({ source: 'custom', customPath: path.join(root, 'missing') })
    ).rejects.toThrow()
    expect((await manager.configuration()).node.source).toBe('bundled')
    expect(await fs.readFile(path.join(root, 'history.jsonl'), 'utf8')).toBe('history')
    await expect(fs.stat(path.join(root, 'state.json'))).rejects.toThrow()
  })
  it('atomically saves a native custom Node in a path with spaces and Chinese without inventing npm support', async () => {
    const { root, manager } = await setup()
    const executable = path.join(root, process.platform === 'win32' ? 'node.exe' : 'node')
    await fs.copyFile(process.execPath, executable)
    await fs.chmod(executable, 0o755)
    const result = await manager.switchNodeRuntime({ source: 'custom', customPath: executable })
    expect(result.node.valid).toBe(true)
    expect(result.node.npm).toBeUndefined()
    expect(result.node.npx).toBeUndefined()
    expect(result.configuration.pi.source).toBe('bundled')
    const saved = JSON.parse(await fs.readFile(path.join(root, 'state.json'), 'utf8'))
    expect(saved.configuration.node.customPath).toBe(executable)
  })
  it('does not modify PATH, credentials, terminal environments or version-manager configuration', () => {
    const base = {
      PATH: '/system/bin:/selected/bin',
      API_KEY: 'test-fixture',
      NVM_DIR: '/user/nvm',
      NODE_OPTIONS: '--inspect',
      ELECTRON_RUN_AS_NODE: '1'
    }
    expect(buildRuntimeEnvironment(base, '/selected/bin/node', 'mcp').PATH).toBe(
      '/selected/bin:/system/bin'
    )
    expect(buildRuntimeEnvironment(base, '/selected/bin/node', 'extension')).toMatchObject({
      API_KEY: 'test-fixture',
      NVM_DIR: '/user/nvm'
    })
    expect(
      buildRuntimeEnvironment(base, '/selected/bin/node', 'pi').ELECTRON_RUN_AS_NODE
    ).toBeUndefined()
    expect(buildRuntimeEnvironment(base, '/selected/bin/node', 'terminal')).toEqual(base)
    expect(base.PATH).toBe('/system/bin:/selected/bin')
  })
  it('normalizes Windows Path/PATH and PATHEXT with selected Node precedence', () => {
    const env = buildRuntimeEnvironment(
      { Path: 'C:\\System;C:\\NODE', PATH: 'C:\\Other', PathExt: '.EXE;.CMD;.BAT' },
      'C:\\Node\\node.exe',
      'mcp',
      'win32'
    )
    expect(env.Path).toBeUndefined()
    expect(env.PATH).toBe('C:\\Node;C:\\System;C:\\Other')
    expect(env.PATHEXT).toBe('.EXE;.CMD;.BAT')
  })
  it('validates IPC selections and rejects command payloads and unknown fields', () => {
    expect(
      runtimeSwitchSchema.safeParse({ kind: 'pi', selection: { source: 'custom' } }).success
    ).toBe(false)
    expect(
      runtimeSwitchSchema.safeParse({
        kind: 'node',
        selection: { source: 'system', command: 'curl evil' }
      }).success
    ).toBe(false)
    expect(
      runtimeSwitchSchema.safeParse({
        kind: 'node',
        selection: { source: 'custom', customPath: '/tmp/node\n--eval' }
      }).success
    ).toBe(false)
  })
  it('rejects foreign binary architecture before execution', async () => {
    const { root } = await setup()
    const file = path.join(root, 'foreign')
    const header = Buffer.alloc(64)
    header.writeUInt32BE(0x7f454c46)
    header[5] = 1
    header.writeUInt16LE(process.arch === 'arm64' ? 62 : 183, 18)
    await fs.writeFile(file, header, { mode: 0o755 })
    expect(await binaryIdentity(file)).toMatchObject({ platform: 'linux' })
    expect((await validateExecutable('node', 'custom', file)).valid).toBe(false)
  })
  it('rejects directories and non-executable files', async () => {
    const { root } = await setup()
    expect((await validateExecutable('pi', 'custom', root)).valid).toBe(false)
    if (process.platform === 'win32') return
    const file = path.join(root, 'pi')
    await fs.writeFile(file, '#!/bin/sh\necho 1.2.0', { mode: 0o600 })
    expect((await validateExecutable('pi', 'custom', file)).diagnosticMessages.join()).toContain(
      'EACCES'
    )
  })
  it('rejects archive traversal, absolute paths and escaping links', () => {
    for (const name of ['../escape', '/etc/profile', 'C:\\Windows\\x', 'pi/../../x', 'pi\\..\\x'])
      expect(() => assertArchivePath(name)).toThrow()
    expect(() => assertArchivePath('pi/link', '../../escape', 'SymbolicLink')).toThrow()
    expect(() =>
      assertArchivePath('node/bin/npm', '../lib/node_modules/npm/bin/npm-cli.js', 'SymbolicLink')
    ).not.toThrow()
  })
  it('refuses changes while tasks are active and leaves both selections intact', async () => {
    const { root } = await setup()
    const manager = new RuntimeManager({
      bundledRoot: root,
      userRoot: root,
      stateFile: path.join(root, 'busy.json'),
      cache: root,
      busy: () => true
    })
    await expect(
      manager.switchNodeRuntime({ source: 'custom', customPath: process.execPath })
    ).rejects.toThrow('active sessions')
    expect((await manager.configuration()).node.source).toBe('bundled')
  })
  it('does not change live configuration when persistence fails', async () => {
    const { root } = await setup()
    const stateFile = path.join(root, 'directory-as-file')
    await fs.mkdir(stateFile)
    const manager = new RuntimeManager({
      bundledRoot: root,
      userRoot: root,
      stateFile: path.join(stateFile, 'state.json'),
      cache: root
    })
    await manager.initialize()
    await fs.rm(stateFile, { recursive: true })
    await fs.writeFile(stateFile, 'preserved')
    await expect(
      manager.switchNodeRuntime({ source: 'custom', customPath: process.execPath })
    ).rejects.toThrow()
    expect((await manager.configuration()).node.source).toBe('bundled')
    expect(await fs.readFile(stateFile, 'utf8')).toBe('preserved')
  })
  it('rejects a forged file receipt even when its declared archive digest is official', async () => {
    const { root } = await setup()
    await fs.writeFile(
      path.join(root, process.platform === 'win32' ? 'pi.exe' : 'pi'),
      'forged executable'
    )
    const files = await inventory(root)
    const asset = catalog.pi.assets[`${process.platform}-${process.arch}`]
    await fs.writeFile(
      path.join(root, 'runtime-receipt.json'),
      JSON.stringify({
        kind: 'pi',
        platform: process.platform,
        arch: process.arch,
        version: '1.2.0',
        archiveSha256: asset.sha256,
        files
      })
    )
    await expect(verifyDistribution(root, 'pi', process.platform, process.arch)).rejects.toThrow(
      'Runtime integrity check failed'
    )
  })
})
