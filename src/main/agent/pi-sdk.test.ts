import { describe, expect, it } from 'vitest'

describe('Pi SDK compatibility surface', () => {
  it('exposes the Native Pi services used by the compatibility layer', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')

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
})

function expectFunctions(value: object, names: string[]): void {
  const record = value as Record<string, unknown>
  for (const name of names) expect(record[name], name).toBeTypeOf('function')
}
