// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const binary = path.resolve(
  `resources/runtimes/${process.platform}-${process.arch}/pi/${process.platform === 'win32' ? 'pi.exe' : 'pi'}`
)

describe('bundled native Pi desktop extension', () => {
  it.skipIf(!existsSync(binary))(
    'loads ChatGPT support from the standalone Pi binary',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-chatgpt-binary-'))
      const child = spawn(
        binary,
        [
          '--mode',
          'rpc',
          '--extension',
          path.resolve('resources/desktop-extension/index.mjs'),
          '--session-id',
          '11111111-1111-4111-8111-111111111111'
        ],
        {
          cwd: root,
          env: { ...process.env, PI_CODING_AGENT_DIR: root },
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
      child.stdin.end()
      let stderr = ''
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString('utf8')
      })
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          const timer = setTimeout(() => {
            child.kill()
            reject(new Error(`Native Pi timeout: ${stderr}`))
          }, 15_000)
          child.once('error', (error) => {
            clearTimeout(timer)
            reject(error)
          })
          child.once('close', (exit) => {
            clearTimeout(timer)
            resolve(exit)
          })
        })
        expect(stderr).toContain('Desktop extension requires an authenticated host')
        expect(stderr).not.toContain('Cannot find module')
        expect(code).toBe(1)
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
    20_000
  )
})
