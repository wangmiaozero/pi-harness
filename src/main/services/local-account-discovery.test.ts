// @vitest-environment node
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LocalAccountDiscovery, parseAccountStatus } from './local-account-discovery'
import type { resolveExecutable } from '../environment/command-resolver'

describe('local account status', () => {
  it('exposes only an allowlisted status, never CLI output or identity', () => {
    expect(parseAccountStatus('codex', 0, 'Logged in using ChatGPT')).toEqual({
      source: 'codex',
      status: 'detected',
      authentication: 'subscription'
    })
    expect(parseAccountStatus('codex', 0, 'API key configured - sk-te...1234')).toEqual({
      source: 'codex',
      status: 'detected',
      authentication: 'apiKey'
    })
    expect(parseAccountStatus('codex', 1, 'Not logged in')).toEqual({
      source: 'codex',
      status: 'signedOut'
    })
    expect(parseAccountStatus('codex', 1, 'Error checking login status: password')).toEqual({
      source: 'codex',
      status: 'failed'
    })
    expect(
      parseAccountStatus(
        'claude',
        0,
        JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          email: 'name@example.com',
          token: 'private'
        })
      )
    ).toEqual({ source: 'claude', status: 'detected', authentication: 'subscription' })
    expect(parseAccountStatus('claude', 0, '{"loggedIn":"true"}').status).toBe('failed')
  })

  it('coalesces discovery and distinguishes absent and unsupported CLI', async () => {
    const resolve = vi.fn(async (command: string): ReturnType<typeof resolveExecutable> => ({
      command,
      found: command === 'gemini',
      path: command === 'gemini' ? '/fixture/gemini' : null,
      source: command === 'gemini' ? 'process-path' : null,
      version: null
    }))
    const readShell = vi.fn(async (_options?: { cwd?: string }) => ({ shell: null, path: null }))
    const discovery = new LocalAccountDiscovery(resolve, undefined, readShell)
    const result = discovery.list()
    expect(discovery.list()).toBe(result)
    expect(await result).toEqual([
      { source: 'codex', status: 'missing' },
      { source: 'claude', status: 'missing' },
      { source: 'gemini', status: 'unsupported' }
    ])
    expect(await discovery.list()).toEqual(await result)
    expect(resolve).toHaveBeenCalledTimes(3)
    await discovery.list(true)
    expect(resolve).toHaveBeenCalledTimes(6)
    discovery.close()
  })

  it('uses one login-shell PATH snapshot and runs the status command with the discovered PATH', async () => {
    const shellBin = path.resolve('fixture-login-bin')
    const shellPath = shellBin + path.delimiter + 'relative-entry'
    const resolve = vi.fn(
      async (
        command: string,
        options?: Parameters<typeof resolveExecutable>[1]
      ): ReturnType<typeof resolveExecutable> => {
        const found =
          command === 'codex' && (options?.env?.PATH ?? '').split(path.delimiter).includes(shellBin)
        return {
          command,
          found,
          path: found ? path.join(shellBin, 'codex') : null,
          source: found ? 'process-path' : null,
          version: found ? '1.0' : null
        }
      }
    )
    const readShell = vi.fn(async (_options?: { cwd?: string }) => ({
      shell: null,
      path: shellPath
    }))
    const run = vi.fn(
      async (_file: string, _args: string[], _options: { env?: NodeJS.ProcessEnv }) => ({
        stdout: 'Logged in using ChatGPT',
        stderr: ''
      })
    )
    const discovery = new LocalAccountDiscovery(
      resolve,
      run as unknown as ConstructorParameters<typeof LocalAccountDiscovery>[1],
      readShell
    )
    const result = await discovery.list()
    if (process.platform === 'win32') {
      expect(readShell).not.toHaveBeenCalled()
      expect(result[0].status).toBe('missing')
    } else {
      expect(readShell).toHaveBeenCalledTimes(1)
      expect(result[0]).toMatchObject({
        source: 'codex',
        status: 'detected',
        authentication: 'subscription'
      })
      expect(run).toHaveBeenCalledExactlyOnceWith(
        path.join(shellBin, 'codex'),
        ['login', 'status'],
        expect.any(Object)
      )
      const paths = run.mock.calls[0][2].env?.PATH?.split(path.delimiter)
      expect(paths).toContain(shellBin)
      expect(paths).not.toContain('relative-entry')
    }
    discovery.close()
  })
})
