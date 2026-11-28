// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const binary = path.resolve(
  `resources/runtimes/${process.platform}-${process.arch}/pi/${process.platform === 'win32' ? 'pi.exe' : 'pi'}`
)

describe('bundled native Pi desktop extension', () => {
  let root: string | undefined

  afterEach(async () => {
    if (!root) return
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    root = undefined
  })

  it.skipIf(!existsSync(binary))(
    'loads the desktop extension and rejects startup without an authenticated host',
    async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-chatgpt-binary-'))
      const child = spawn(
        binary,
        [
          '--mode',
          'rpc',
          '--offline',
          '--no-session',
          '--no-extensions', // Pi still loads explicit extension paths.
          '--no-skills',
          '--no-context-files',
          '--extension',
          path.resolve('resources/desktop-extension/index.mjs')
        ],
        {
          cwd: root,
          env: {
            PATH: root,
            HOME: root,
            USERPROFILE: root,
            TEMP: root,
            TMP: root,
            TMPDIR: root,
            SystemRoot: process.env.SystemRoot,
            PI_CODING_AGENT_DIR: root
          },
          // Keep RPC input open until Pi exits on its own with the extension diagnostic.
          stdio: ['pipe', 'ignore', 'pipe'],
          timeout: 15_000,
          killSignal: 'SIGKILL'
        }
      )
      let stderr = ''
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk
      })
      const [code, signal] = await once(child, 'close')
      expect(signal, stderr).toBeNull()
      expect(code, stderr).toBe(1)
      expect(stderr).toContain('Desktop extension requires an authenticated host')
      expect(stderr).not.toContain('Cannot find module')
    },
    20_000
  )
})
