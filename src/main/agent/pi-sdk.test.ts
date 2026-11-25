// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as sdk from '@earendil-works/pi-coding-agent'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { findModelPreset, findProviderPreset } from '@shared/constants/provider-presets'

describe('Pi SDK compatibility surface', () => {
  it('exposes the Native Pi services used by the compatibility layer', () => {
    expectFunctions(sdk, [
      'createAgentSessionServices',
      'createAgentSessionFromServices',
      'resolveModelScopeWithDiagnostics',
      'buildSessionContext',
      'buildContextEntries'
    ])
    expectFunctions(sdk.SessionManager, ['listAll', 'open', 'create'])
    expectFunctions(sdk.SettingsManager, ['create'])
    expectFunctions(sdk.AgentSession.prototype, [
      'prompt',
      'abort',
      'compact',
      'abortCompaction',
      'steer',
      'followUp',
      'navigateTree',
      'setModel',
      'setThinkingLevel',
      'getAvailableThinkingLevels',
      'setAutoCompactionEnabled',
      'setAutoRetryEnabled',
      'getAllTools',
      'getActiveToolNames',
      'setActiveToolsByName',
      'getContextUsage',
      'getSessionStats'
    ])
    expectFunctions(sdk.ModelRuntime.prototype, ['getModel', 'refresh', 'completeSimple'])
    expectFunctions(sdk.ExtensionRunner.prototype, ['getRegisteredCommands'])
    expectFunctions(sdk.DefaultResourceLoader.prototype, ['getSkills'])
  })

  it.each([
    ['openai', 'openai-responses', 272000, 272000, null],
    ['azure', 'azure-openai-responses', 1050000, 1050000, null],
    ['openai-codex', 'openai-codex-responses', 500000, 272000, 'low']
  ] as const)('honors the GPT-6.2 capabilities for %s', (provider, api, sol, astra, minimal) => {
    const models = getBuiltinModels(provider)
    for (const [id, contextWindow] of [
      ['gpt-6.2-sol', sol],
      ['gpt-6.2-astra', astra]
    ] as const) {
      const native = models.find((model) => model.id === id)
      expect(native).toMatchObject({
        api,
        contextWindow,
        maxTokens: 128000,
        thinkingLevelMap: { off: null, minimal }
      })
      if (provider === 'openai') {
        const preset = findProviderPreset({
          key: provider,
          protocol: 'openai-responses',
          baseUrl: native?.baseUrl
        })
        expect(preset?.defaultModelId).toBe('gpt-6.2-sol')
        expect(findModelPreset(id, preset)).toMatchObject({
          contextWindow,
          maxOutputTokens: native?.maxTokens,
          thinkingLevels: native?.thinkingLevelMap,
          tools: true
        })
      }
    }
  })

  it('keeps OpenAI Responses defaults scoped to the official endpoint', () => {
    expect(
      findProviderPreset({
        key: 'openai-responses',
        protocol: 'openai-responses',
        baseUrl: 'http://127.0.0.1:9000/v1'
      })
    ).toBeUndefined()
  })
})

function expectFunctions(value: object, names: string[]): void {
  const record = value as Record<string, unknown>
  for (const name of names) expect(record[name], name).toBeTypeOf('function')
}
