// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_VOICE } from './voice-service'
import { createVoiceHost } from './voice-host'
import type { PiConfigService } from '../pi/config-service'
import type { ProviderService } from '../services/provider-service'
import type { WorkspaceServices } from '../ipc/register-workspace'

describe('voice workspace boundary', () => {
  function setup() {
    const workspace = {
      sessions: {
        get: vi.fn(async (id: string) => {
          if (id !== 'known') throw new Error('Unknown session')
          return {
            info: { cwd: '/known-project' },
            context: {
              messages: [
                ...Array.from({ length: 9 }, (_, i) => ({
                  role: i % 2 ? 'assistant' : 'user',
                  content: `message-${i}`
                })),
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: 'private attachment prompt' },
                    { type: 'image', data: 'private-image', mimeType: 'image/png' }
                  ]
                },
                { role: 'toolResult', content: [{ type: 'text', text: 'private tool output' }] },
                {
                  role: 'assistant',
                  content: [
                    { type: 'thinking', thinking: 'private reasoning' },
                    { type: 'text', text: 'mixed reasoning answer' }
                  ]
                }
              ]
            }
          }
        })
      },
      access: { assertAllowed: vi.fn() },
      agent: {
        getState: vi.fn(async () => null as { isStreaming: boolean } | null),
        start: vi.fn(),
        prompt: vi.fn()
      },
      beforeAgentStart: vi.fn()
    }
    return {
      workspace,
      host: createVoiceHost(
        {} as PiConfigService,
        {} as ProviderService,
        workspace as unknown as WorkspaceServices
      )
    }
  }
  it('resolves the existing Pi Codex account without requiring a model catalog refresh', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-codex-auth-'))
    const fetcher = vi.fn(async () => {
      throw new Error('Network is forbidden for this fixture')
    })
    vi.stubGlobal('fetch', fetcher)
    try {
      const token =
        'fixture.' +
        Buffer.from(
          JSON.stringify({
            'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' }
          })
        ).toString('base64url') +
        '.fixture'
      await fs.writeFile(path.join(directory, 'models.json'), '{"providers":{}}')
      await fs.writeFile(
        path.join(directory, 'auth.json'),
        JSON.stringify({
          'openai-codex': {
            type: 'oauth',
            access: token,
            refresh: 'fixture-refresh',
            expires: Date.now() + 3600000
          }
        })
      )
      const host = createVoiceHost(
        { modelsPath: () => path.join(directory, 'models.json') } as PiConfigService,
        {} as ProviderService,
        {} as WorkspaceServices
      )
      const settings = { ...DEFAULT_VOICE, adapter: 'codex-live' as const }
      expect(await host.hasCredential(settings)).toBe(true)
      expect(await host.resolve(settings)).toEqual({ key: token, accountId: 'fixture-account' })
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
  it('requires opt-in and shares at most six plain-text messages from the bound session', async () => {
    const { workspace, host } = setup()
    expect(await host.context({ sessionId: 'known', shareContext: false })).toBe('')
    expect(await host.context({ sessionId: 'known', shareContext: true })).toBe(
      'assistant: message-3\n\nuser: message-4\n\nassistant: message-5\n\nuser: message-6\n\nassistant: message-7\n\nuser: message-8'
    )
    expect(workspace.sessions.get).toHaveBeenCalledWith('known')
    await expect(host.context({ sessionId: '../other', shareContext: true })).rejects.toThrow()
    await expect(host.context({ shareContext: true })).rejects.toThrow()
  })
  it('delivers reviewed requests through the current runtime and existing permission checks', async () => {
    const { workspace, host } = setup()
    await host.deliver('known', 'Review this change')
    expect(workspace.access.assertAllowed).toHaveBeenCalledWith('/known-project', {
      mustExist: true
    })
    expect(workspace.beforeAgentStart).toHaveBeenCalledWith(undefined, 'known')
    expect(workspace.agent.start).toHaveBeenCalledWith({
      sessionId: 'known',
      permissionMode: 'ask'
    })
    expect(workspace.agent.prompt).toHaveBeenCalledWith('known', 'Review this change', {})
    workspace.agent.getState.mockResolvedValue({ isStreaming: true })
    await host.deliver('known', 'Follow up')
    expect(workspace.agent.start).toHaveBeenCalledOnce()
    expect(workspace.agent.prompt).toHaveBeenLastCalledWith('known', 'Follow up', {
      streamingBehavior: 'followUp'
    })
  })
})
