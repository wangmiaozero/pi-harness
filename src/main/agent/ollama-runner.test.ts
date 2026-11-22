import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isLocalOllamaProvider,
  isOllamaRunnerCommand,
  isUserLocalModelEndpoint,
  noteLocalGatewayBaseUrl,
  parseProcessTable,
  stopOllamaRunners,
  stopUserLocalModel
} from './ollama-runner'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('isOllamaRunnerCommand', () => {
  it('matches the Ollama model runner and ignores the daemon and other servers', () => {
    expect(
      isOllamaRunnerCommand(
        '/Applications/Ollama.app/Contents/Resources/llama-server --model /Users/tree/.ollama/models/blobs/sha256-abc'
      )
    ).toBe(true)
    expect(isOllamaRunnerCommand('/usr/local/bin/ollama serve')).toBe(false)
    expect(isOllamaRunnerCommand('/usr/local/bin/llama-server --model /tmp/model.gguf')).toBe(false)
  })
})

describe('parseProcessTable', () => {
  it('reads pid and command from ps output', () => {
    expect(parseProcessTable('  25635 /Applications/Ollama.app/Contents/Resources/llama-server\n')).toEqual([
      { pid: 25635, command: '/Applications/Ollama.app/Contents/Resources/llama-server' }
    ])
  })
})

describe('stopOllamaRunners', () => {
  it('terminates a runner that ignores the first signal', async () => {
    const signals: string[] = []
    let alive = true
    let clock = 0
    const stopped = await stopOllamaRunners({
      list: async () => [
        {
          pid: 42,
          command: '/Applications/Ollama.app/Contents/Resources/llama-server --model blob'
        },
        { pid: 7, command: '/usr/local/bin/ollama serve' }
      ],
      kill: (_pid, signal) => {
        signals.push(signal)
        if (signal === 'SIGKILL') alive = false
      },
      alive: () => alive,
      now: () => clock,
      sleep: async () => {
        clock += 2000
      }
    })
    expect(stopped).toBe(1)
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('does nothing when no Ollama runner is loaded', async () => {
    const signals: string[] = []
    await stopOllamaRunners({
      list: async () => [{ pid: 7, command: 'ollama serve' }],
      kill: (_pid, signal) => signals.push(signal),
      alive: () => false,
      sleep: async () => undefined
    })
    expect(signals).toEqual([])
  })
})

describe('user local models', () => {
  afterEach(() => noteLocalGatewayBaseUrl(null))

  it('includes loopback model servers and skips the gateway proxy and remote providers', () => {
    noteLocalGatewayBaseUrl('http://127.0.0.1:43123/v1')
    expect(isUserLocalModelEndpoint('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isUserLocalModelEndpoint('http://localhost:1234/v1')).toBe(true)
    expect(isUserLocalModelEndpoint('http://127.0.0.1:43123/v1')).toBe(false)
    expect(isUserLocalModelEndpoint('https://api.openai.com/v1')).toBe(false)
  })

  it('stops an Ollama runner without touching another local server or the gateway', async () => {
    const stopped: string[] = []
    noteLocalGatewayBaseUrl('http://127.0.0.1:43123/v1')
    await stopUserLocalModel('http://127.0.0.1:11434/v1', {
      stopOllama: async () => {
        stopped.push('ollama')
        return 1
      },
      listeners: async () => {
        throw new Error('ollama must not scan other ports')
      }
    })
    await stopUserLocalModel('http://127.0.0.1:43123/v1', {
      stopOllama: async () => {
        stopped.push('gateway')
        return 1
      }
    })
    await stopUserLocalModel('https://api.openai.com/v1', {
      stopOllama: async () => {
        stopped.push('cloud')
        return 1
      }
    })
    expect(stopped).toEqual(['ollama'])
  })

  it('stops the process listening for a non-Ollama local model, except this app', async () => {
    const signals: Array<[number, string]> = []
    let alive = new Set([50])
    let clock = 0
    await stopUserLocalModel('http://localhost:1234/v1', {
      stopOllama: async () => {
        throw new Error('not ollama')
      },
      listeners: async () => [
        { pid: process.pid, command: '/Applications/Pi-Harness.app/Contents/MacOS/Pi-Harness' },
        { pid: 50, command: '/Applications/LM Studio.app/Contents/MacOS/LM Studio' }
      ],
      kill: (pid, signal) => {
        signals.push([pid, signal])
        if (signal === 'SIGKILL') alive.delete(pid)
      },
      alive: (pid) => alive.has(pid),
      now: () => clock,
      sleep: async () => {
        clock += 2000
      }
    })
    expect(signals).toEqual([
      [50, 'SIGTERM'],
      [50, 'SIGKILL']
    ])
  })
})

describe('isLocalOllamaProvider', () => {
  it('is true only for the loopback Ollama endpoint of that provider', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-ollama-'))
    dirs.push(dir)
    await fs.writeFile(
      path.join(dir, 'models.json'),
      JSON.stringify({
        providers: {
          ollama: { baseUrl: 'http://127.0.0.1:11434/v1' },
          remote: { baseUrl: 'https://ollama.com/v1' }
        }
      })
    )
    await expect(isLocalOllamaProvider(dir, 'ollama')).resolves.toBe(true)
    await expect(isLocalOllamaProvider(dir, 'remote')).resolves.toBe(false)
    await expect(isLocalOllamaProvider(dir, 'missing')).resolves.toBe(false)
  })
})
