import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { detectNodeRuntime, nodeToolDirectories } from './node-environment'
import { resolveExecutable, resolveLoginShellPath } from '../environment/command-resolver'
import { inspectNpmPrefix } from '../environment/npm-environment'

vi.mock('../environment/command-resolver', () => ({
  resolveExecutable: vi.fn(),
  resolveLoginShellPath: vi.fn()
}))
vi.mock('../environment/npm-environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../environment/npm-environment')>()),
  inspectNpmPrefix: vi.fn().mockResolvedValue({ prefix: null, binDir: null, writable: null })
}))

beforeEach(() => {
  vi.mocked(resolveExecutable).mockImplementation(async (command) => ({
    found: true,
    command,
    path: path.join(os.tmpdir(), 'tools', command),
    version: command === 'node' ? 'v26.0.0' : '10.0.0',
    source: 'candidate'
  }))
})
afterEach(() => vi.clearAllMocks())

describe('terminal Node selection', () => {
  it.each(['n', 'nvm', 'fnm', 'Volta', 'mise', 'NVM Desktop'])(
    'uses the runtime selected by %s, independently of its shim location',
    async (manager) => {
      const nodeBin = path.join(os.tmpdir(), manager, 'versions', '22', 'bin')
      const shellBin = path.join(os.tmpdir(), manager, 'shims')
      vi.mocked(resolveLoginShellPath).mockResolvedValue({
        shell: 'user-shell',
        path: shellBin,
        node: { path: path.join(nodeBin, 'node'), version: 'v22.0.0' }
      })

      const runtime = await detectNodeRuntime()

      expect(runtime).toMatchObject({
        nodePath: path.join(nodeBin, 'node'),
        nodeVersion: 'v22.0.0',
        nodeSupported: true,
        nodeSource: 'login-shell',
        ready: true
      })
      expect(runtime.resolvedPath?.split(path.delimiter).slice(0, 2)).toEqual([nodeBin, shellBin])
      expect(resolveExecutable).not.toHaveBeenCalledWith('node', expect.anything())
      expect(resolveExecutable).toHaveBeenCalledWith(
        'npm',
        expect.objectContaining({
          env: expect.objectContaining({ PATH: runtime.resolvedPath }),
          cwd: os.homedir(),
          requireVersion: true
        })
      )
      expect(inspectNpmPrefix).toHaveBeenCalledWith(
        runtime.npmPath,
        expect.objectContaining({
          nodePath: runtime.nodePath,
          env: expect.objectContaining({ PATH: runtime.resolvedPath })
        })
      )
    }
  )

  it('reports an active outdated version instead of substituting a newer cached installation', async () => {
    vi.mocked(resolveLoginShellPath).mockResolvedValue({
      shell: 'user-shell',
      path: path.join(os.tmpdir(), 'bin'),
      node: { path: process.execPath, version: 'v20.19.0' }
    })
    expect(await detectNodeRuntime()).toMatchObject({
      nodeVersion: 'v20.19.0',
      nodeInstalled: true,
      nodeStatus: 'outdated',
      ready: false
    })
    expect(resolveExecutable).not.toHaveBeenCalledWith('node', expect.anything())
  })

  it('falls back to runnable candidates when the terminal cannot launch Node', async () => {
    vi.mocked(resolveLoginShellPath).mockResolvedValue({ shell: null, path: null })
    expect(await detectNodeRuntime()).toMatchObject({ nodeVersion: 'v26.0.0', ready: true })
    expect(resolveExecutable).toHaveBeenCalledWith(
      'node',
      expect.objectContaining({ requireVersion: true })
    )
  })

  it('includes custom manager roots, NVM Desktop, and n-install without overriding PATH', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-manager roots-'))
    const env = {
      PATH: path.join(root, 'terminal bin'),
      N_PREFIX: path.join(root, 'n'),
      NVM_DIR: path.join(root, 'nvm'),
      VOLTA_HOME: path.join(root, 'volta'),
      FNM_DIR: path.join(root, 'fnm'),
      FNM_MULTISHELL_PATH: path.join(root, 'fnm session'),
      MISE_DATA_DIR: path.join(root, 'mise'),
      ASDF_DATA_DIR: path.join(root, 'asdf'),
      NVM_SYMLINK: path.join(root, 'windows nvm link')
    }
    const nvmBin = path.join(env.NVM_DIR, 'versions', 'node', 'v24.0.0', 'bin')
    const fnmBin = path.join(
      env.FNM_DIR,
      'node-versions',
      'v22.0.0',
      process.platform === 'win32' ? 'installation' : path.join('installation', 'bin')
    )
    try {
      await fs.mkdir(nvmBin, { recursive: true })
      await fs.mkdir(fnmBin, { recursive: true })
      const dirs = await nodeToolDirectories(null, env)
      expect(dirs[0]).toBe(env.PATH)
      expect(dirs).toEqual(
        expect.arrayContaining([
          path.join(env.N_PREFIX, 'bin'),
          path.join(os.homedir(), 'n', 'bin'),
          path.join(env.VOLTA_HOME, 'bin'),
          path.join(env.FNM_MULTISHELL_PATH, 'bin'),
          path.join(env.MISE_DATA_DIR, 'shims'),
          path.join(env.ASDF_DATA_DIR, 'shims'),
          path.join(os.homedir(), '.nvmd', 'bin'),
          env.NVM_SYMLINK,
          nvmBin,
          fnmBin
        ])
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
