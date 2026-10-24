import { createHash } from 'node:crypto'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC_INVOKE, IPC_EVENT } from '@shared/ipc/channels'
import {
  aiPreferencesSchema,
  scopeSchema,
  instructionSaveSchema,
  mcpSaveSchema,
  mcpMarketQuerySchema,
  mcpCatalogInstallSchema,
  mcpTargetSchema,
  mcpToggleSchema,
  voiceSaveSchema,
  voicePrepareSchema,
  voiceStartSchema,
  voiceSignalSchema,
  voiceReviewSchema,
  callIdSchema,
  voiceAudioSchema,
  remotePairSchema,
  remoteApprovalResponseSchema
} from '@shared/agent-settings/schema'
import type { IpcHandleRegistrar } from './trusted-ipc'
import type { PiConfigService } from '../pi/config-service'
import type { FileAccessService } from '../files/file-access-service'
import { ValidationError } from '../services/errors'
import { JsonStore } from '../services/storage'
import { McpDiscoveryService } from '../agent-settings/mcp-discovery'
import { AgentPreferencesService } from '../agent-settings/preferences-service'
import { LiveVoiceService, DEFAULT_VOICE } from '../agent-settings/voice-service'
import { RemoteHostService } from '../agent-settings/remote-service'
import type { VoiceHost } from '../agent-settings/voice-service'
import type { RemoteState } from '../agent-settings/remote-service'

export function registerAgentSettingsIpc(
  ipc: IpcHandleRegistrar,
  wrap: <T>(fn: () => Promise<T>) => Promise<unknown>,
  config: PiConfigService,
  access: FileAccessService,
  getWindow: () => BrowserWindow | null,
  voiceHost?: VoiceHost
): void {
  const preferences = new AgentPreferencesService(config, access)
  const discovery = new McpDiscoveryService(preferences, access)
  const voice = new LiveVoiceService(
    new JsonStore(path.join(app.getPath('userData'), 'voice.json'), DEFAULT_VOICE),
    (event) => {
      const win = getWindow()
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
        win.webContents.send(IPC_EVENT.voiceEvent, event)
    },
    `voice-${createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 24)}`,
    voiceHost
  )
  const remote = new RemoteHostService(
    new JsonStore<RemoteState>(path.join(app.getPath('userData'), 'remote-hosts.json'), {
      hosts: []
    })
  )
  app.once('will-quit', () => {
    voice.dispose()
    remote.dispose()
  })
  function handle<T>(
    channel: string,
    schema: z.ZodType<T>,
    action: (input: T) => Promise<unknown> | unknown
  ): void {
    ipc.handle(channel, (_event, input, ...extra) =>
      wrap(async () => {
        if (extra.length) throw new ValidationError('Invalid settings request.')
        const parsed = schema.safeParse(input)
        if (!parsed.success) throw new ValidationError('Invalid settings request.')
        return action(parsed.data)
      })
    )
  }
  const none = z.undefined()
  handle(IPC_INVOKE.agentSettingsAiGet, none, () => preferences.ai())
  handle(IPC_INVOKE.agentSettingsAiSet, aiPreferencesSchema, (input) => preferences.saveAi(input))
  handle(IPC_INVOKE.agentSettingsInstructionsRead, scopeSchema, (input) =>
    preferences.instructions(input)
  )
  handle(IPC_INVOKE.agentSettingsInstructionsSave, instructionSaveSchema, (input) =>
    preferences.saveInstructions(input)
  )
  handle(IPC_INVOKE.agentSettingsMcpList, scopeSchema, (input) => preferences.mcp(input))
  handle(IPC_INVOKE.mcpScan, scopeSchema, (input) => discovery.scan(input))
  handle(IPC_INVOKE.mcpMarket, mcpMarketQuerySchema, ({ query, cursor }) =>
    discovery.market(query, cursor)
  )
  handle(IPC_INVOKE.mcpCatalogInstall, mcpCatalogInstallSchema, (input) => discovery.install(input))
  handle(IPC_INVOKE.agentSettingsMcpSave, mcpSaveSchema, (input) => preferences.saveMcp(input))
  handle(IPC_INVOKE.agentSettingsMcpToggle, mcpToggleSchema, (input) =>
    preferences.changeMcp(input, (old) => {
      if (!old) throw new ValidationError('Server no longer exists. Reload the list.')
      return { ...old, enabled: input.enabled }
    })
  )
  handle(IPC_INVOKE.agentSettingsMcpRemove, mcpTargetSchema, (input) =>
    preferences.changeMcp(input, () => undefined)
  )
  handle(IPC_INVOKE.voiceSettingsGet, none, () => voice.settings())
  handle(IPC_INVOKE.voiceSettingsSave, voiceSaveSchema, (input) => voice.save(input))
  handle(IPC_INVOKE.voicePrepare, voicePrepareSchema.optional(), (input) =>
    voice.prepare(getWindow()!.webContents, input ?? {})
  )
  handle(IPC_INVOKE.voiceStart, voiceStartSchema, ({ callId, offerSdp }) =>
    voice.start(callId, offerSdp)
  )
  handle(IPC_INVOKE.voiceSignal, voiceSignalSchema, ({ callId, message }) =>
    voice.signal(callId, message)
  )
  handle(IPC_INVOKE.voiceReview, voiceReviewSchema, ({ callId, operationId, accept }) =>
    voice.review(callId, operationId, accept)
  )
  handle(IPC_INVOKE.voiceStop, callIdSchema, ({ callId }) => voice.stop(callId))
  handle(IPC_INVOKE.voiceAudio, voiceAudioSchema, ({ callId, data }) => voice.audio(callId, data))
  const host = z.strictObject({ id: z.string().uuid() })
  const session = host.extend({ sessionId: z.string().min(1).max(256) })
  handle(IPC_INVOKE.remoteApprove, remoteApprovalResponseSchema, (input) => remote.approve(input))
  handle(IPC_INVOKE.remoteHostsList, none, () => remote.list())
  handle(IPC_INVOKE.remoteHostsPair, remotePairSchema, (input) => remote.pair(input))
  handle(IPC_INVOKE.remoteHostsConnect, host, ({ id }) => remote.connect(id))
  handle(IPC_INVOKE.remoteHostsDisconnect, host, ({ id }) => remote.disconnect(id))
  handle(IPC_INVOKE.remoteHostsRemove, host, ({ id }) => remote.remove(id))
  handle(IPC_INVOKE.remoteProjects, host, ({ id }) => remote.projects(id))
  handle(IPC_INVOKE.remoteSessions, host, ({ id }) => remote.sessions(id))
  handle(IPC_INVOKE.remoteHistory, session, ({ id, sessionId }) => remote.history(id, sessionId))
  handle(
    IPC_INVOKE.remotePrompt,
    session.extend({ text: z.string().trim().min(1).max(64000) }),
    ({ id, sessionId, text }) => remote.prompt(id, sessionId, text)
  )
  handle(IPC_INVOKE.remoteStop, session, ({ id, sessionId }) => remote.stop(id, sessionId))
  handle(
    IPC_INVOKE.remoteCreate,
    host.extend({ projectId: z.string().min(1).max(256) }),
    ({ id, projectId }) => remote.create(id, projectId)
  )
}
