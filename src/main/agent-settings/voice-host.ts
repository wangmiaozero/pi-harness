import path from 'node:path'
import type { VoicePreparation, VoiceSettings } from '@shared/agent-settings/schema'
import type { PiConfigService } from '../pi/config-service'
import type { ProviderService } from '../services/provider-service'
import type { WorkspaceServices } from '../ipc/register-workspace'
import type { VoiceHost } from './voice-service'
import { loadPiCodingAgent } from '../agent/pi-sdk'
import { ConfigError } from '../services/errors'
import { httpEndpoint } from '@shared/agent-settings/schema'

export function createVoiceHost(
  config: PiConfigService,
  providers: ProviderService,
  workspace: WorkspaceServices
): VoiceHost {
  const authPath = () => path.join(path.dirname(config.modelsPath()), 'auth.json')
  async function context(input: VoicePreparation): Promise<string> {
    if (!input.sessionId) {
      if (input.shareContext)
        throw new ConfigError('Choose a work conversation before sharing context.')
      return ''
    }
    const detail = await workspace.sessions.get(input.sessionId)
    if (!input.shareContext) return ''
    return detail.context.messages
      .filter(
        (message): message is Extract<typeof message, { role: 'user' | 'assistant' }> =>
          (message.role === 'user' || message.role === 'assistant') &&
          (typeof message.content === 'string' ||
            message.content.every((part) => part.type === 'text'))
      )
      .slice(-6)
      .map((message) => {
        const text =
          typeof message.content === 'string'
            ? message.content
            : message.content
                .flatMap((part) => (part.type === 'text' ? [part.text] : []))
                .join('\n')
        return `${message.role}: ${text.slice(0, 2000)}`
      })
      .join('\n\n')
  }
  return {
    context,
    async hasCredential(settings) {
      if (settings.adapter === 'codex-live') {
        const sdk = await loadPiCodingAgent()
        const models = await sdk.ModelRuntime.create({
          authPath: authPath(),
          modelsPath: config.modelsPath(),
          refreshOnCreate: false,
          allowModelNetwork: false
        })
        return (await models.listCredentials()).some(
          (entry) => entry.providerId === 'openai-codex' && entry.type === 'oauth'
        )
      }
      if (!settings.providerKey) return false
      const p = await providers.get(settings.providerKey)
      return Boolean(p && (p.apiKeyRef || p.apiKey))
    },
    async resolve(settings: VoiceSettings) {
      if (settings.adapter === 'codex-live') {
        const sdk = await loadPiCodingAgent()
        const models = await sdk.ModelRuntime.create({
          authPath: authPath(),
          modelsPath: config.modelsPath(),
          refreshOnCreate: false,
          allowModelNetwork: false
        })
        if (
          !(await models.listCredentials()).some(
            (entry) => entry.providerId === 'openai-codex' && entry.type === 'oauth'
          )
        )
          throw new ConfigError('Sign in to Codex in Pi first.')
        const result = await models.getAuth('openai-codex')
        const auth = result?.auth
        const key =
          auth?.apiKey ??
          Object.entries(auth?.headers ?? {})
            .find(([name]) => name.toLowerCase() === 'authorization')?.[1]
            ?.replace(/^Bearer\s+/i, '')
        if (!key || key.length > 16384 || /[\r\n]/.test(key))
          throw new ConfigError('Codex sign-in expired. Sign in again in Pi.')
        let accountId: string | undefined
        try {
          const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
          accountId = claims['https://api.openai.com/auth']?.chatgpt_account_id
        } catch {
          /* Missing claims are rejected below. */
        }
        accountId ??=
          Object.entries(auth?.headers ?? {}).find(
            ([name]) => name.toLowerCase() === 'chatgpt-account-id'
          )?.[1] ?? undefined
        if (
          typeof accountId !== 'string' ||
          !accountId ||
          accountId.length > 256 ||
          /[\r\n]/.test(accountId)
        )
          throw new ConfigError('The Codex account is unavailable. Sign in again in Pi.')
        return { key, accountId }
      }
      const p = settings.providerKey ? await providers.get(settings.providerKey) : null
      if (
        !p ||
        (settings.adapter === 'gemini-live'
          ? p.protocol !== 'google-generative-ai'
          : !p.protocol.startsWith('openai'))
      )
        throw new ConfigError('Select a compatible voice service account.')
      const endpoint = httpEndpoint.parse(p.baseUrl)
      return { key: await providers.revealApiKey(p.key), endpoint }
    },
    async deliver(sessionId, instruction) {
      const detail = await workspace.sessions.get(sessionId)
      if (!detail.info) throw new ConfigError('The work conversation is unavailable.')
      await workspace.access.assertAllowed(detail.info.cwd, { mustExist: true })
      const state = await workspace.agent.getState(sessionId)
      if (!state) {
        await workspace.beforeAgentStart?.(undefined, sessionId)
        await workspace.agent.start({ sessionId, permissionMode: 'ask' })
      }
      await workspace.agent.prompt(sessionId, instruction, {
        ...(state?.isStreaming || state?.isPromptRunning
          ? { streamingBehavior: 'followUp' as const }
          : {})
      })
    }
  }
}
