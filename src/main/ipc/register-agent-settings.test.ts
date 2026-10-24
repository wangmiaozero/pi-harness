import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_INVOKE } from '@shared/ipc/channels'
import type { IpcHandleRegistrar } from './trusted-ipc'
const mocks = vi.hoisted(() => ({
  ai: vi.fn(),
  instructions: vi.fn(),
  mcp: vi.fn(),
  pair: vi.fn(),
  audio: vi.fn(),
  get: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => '/fixture', once: vi.fn() } }))
vi.mock('../agent-settings/preferences-service', () => ({
  AgentPreferencesService: class {
    ai = mocks.ai
    instructions = mocks.instructions
    mcp = mocks.mcp
  }
}))
vi.mock('../agent-settings/remote-service', () => ({
  RemoteHostService: class {
    pair = mocks.pair
  }
}))
vi.mock('../agent-settings/voice-service', () => ({
  DEFAULT_VOICE: {},
  LiveVoiceService: class {
    audio = mocks.audio
    settings = mocks.get
  }
}))
import { registerAgentSettingsIpc } from './register-agent-settings'
import type { PiConfigService } from '../pi/config-service'
import type { FileAccessService } from '../files/file-access-service'

describe('agent settings IPC', () => {
  beforeEach(() => vi.clearAllMocks())
  function setup() {
    const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => Promise<unknown>>()
    const ipc = {
      handle: (channel: string, handler: unknown) =>
        handlers.set(channel, handler as (_event: unknown, ...args: unknown[]) => Promise<unknown>)
    } as IpcHandleRegistrar
    registerAgentSettingsIpc(
      ipc,
      (fn) => fn(),
      {} as PiConfigService,
      {} as FileAccessService,
      () => null
    )
    return (channel: string, ...input: unknown[]) => handlers.get(channel)!({}, ...input)
  }
  it('rejects unbounded, unknown and privilege-bearing inputs before calling services', async () => {
    const invoke = setup()
    await expect(invoke(IPC_INVOKE.agentSettingsAiGet, { root: '/outside' })).rejects.toThrow(
      'Invalid'
    )
    await expect(invoke(IPC_INVOKE.agentSettingsAiGet, undefined, 'extra')).rejects.toThrow(
      'Invalid'
    )
    await expect(
      invoke(IPC_INVOKE.agentSettingsInstructionsRead, { root: '/project', command: 'bad' })
    ).rejects.toThrow('Invalid')
    await expect(
      invoke(IPC_INVOKE.agentSettingsInstructionsSave, { content: 'content', revision: 'wrong' })
    ).rejects.toThrow('Invalid')
    await expect(invoke(IPC_INVOKE.agentSettingsMcpSave, { id: '../escape' })).rejects.toThrow(
      'Invalid'
    )
    await expect(
      invoke(IPC_INVOKE.voicePrepare, { sessionId: 'known', shareContext: true, root: '/outside' })
    ).rejects.toThrow('Invalid')
    await expect(
      invoke(IPC_INVOKE.voiceReview, { callId: 'bad', operationId: 'bad', accept: true })
    ).rejects.toThrow('Invalid')
    await expect(
      invoke(IPC_INVOKE.mcpCatalogInstall, {
        catalogId: 'memory',
        revision: 'a'.repeat(64),
        command: 'bad'
      })
    ).rejects.toThrow('Invalid')
    await expect(invoke(IPC_INVOKE.voiceAudio, { callId: 'wrong', data: 'AAAA' })).rejects.toThrow(
      'Invalid'
    )
    await expect(
      invoke(IPC_INVOKE.remoteHostsPair, {
        label: 'Host',
        url: 'ws://outside.test/v1/racp/ws',
        token: 'ppt1.fixture'
      })
    ).rejects.toThrow('Invalid')
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled()
  })
  it('passes only validated data to the Main services', async () => {
    const invoke = setup()
    await invoke(IPC_INVOKE.agentSettingsAiGet)
    await invoke(IPC_INVOKE.agentSettingsInstructionsRead, {})
    await invoke(IPC_INVOKE.agentSettingsMcpList, { root: '/project' })
    const input = { label: 'Fixture', url: 'ws://127.0.0.1:1234/v1/racp/ws', token: 'ppt1.fixture' }
    await invoke(IPC_INVOKE.remoteHostsPair, input)
    expect(mocks.ai).toHaveBeenCalledOnce()
    expect(mocks.instructions).toHaveBeenCalledWith({})
    expect(mocks.mcp).toHaveBeenCalledWith({ root: '/project' })
    expect(mocks.pair).toHaveBeenCalledWith(input)
  })
})
