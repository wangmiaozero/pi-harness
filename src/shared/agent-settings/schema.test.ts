import { describe, expect, it } from 'vitest'
import {
  aiPreferencesSchema,
  mcpSaveSchema,
  remotePairSchema,
  shortcutOverridesSchema,
  voiceSaveSchema
} from './schema'
const revision = 'a'.repeat(64)
describe('agent settings boundaries', () => {
  it('accepts native MCP definitions and rejects unsafe identifiers, URLs and secret literals', () => {
    const stdio = {
      id: 'filesystem',
      revision,
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'fixture'],
      enabled: true,
      exposure: 'codemode'
    }
    expect(mcpSaveSchema.safeParse(stdio).success).toBe(true)
    for (const id of ['../outside', 'a/b', 'a\\b', '-invalid'])
      expect(mcpSaveSchema.safeParse({ ...stdio, id }).success).toBe(false)
    expect(mcpSaveSchema.safeParse({ ...stdio, env: { TOKEN: '${TOKEN}' } }).success).toBe(true)
    expect(mcpSaveSchema.safeParse({ ...stdio, env: { TOKEN: 'private' } }).success).toBe(false)
    expect(mcpSaveSchema.safeParse({ ...stdio, shell: true }).success).toBe(false)
    for (const url of [
      'http://example.test/mcp',
      'file:///etc/passwd',
      'https://user:password@example.test/mcp',
      'https://example.test/mcp?token=x'
    ]) {
      expect(
        mcpSaveSchema.safeParse({
          id: 'remote',
          revision,
          type: 'http',
          url,
          enabled: true,
          exposure: 'direct'
        }).success
      ).toBe(false)
    }
  })
  it('rejects insecure remote endpoints and token query parameters', () => {
    const input = { label: 'Fixture', token: 'ppt1.fixture', url: 'wss://host.test/v1/racp/ws' }
    expect(remotePairSchema.safeParse(input).success).toBe(true)
    expect(
      remotePairSchema.safeParse({ ...input, url: 'ws://127.0.0.1:1234/v1/racp/ws' }).success
    ).toBe(true)
    for (const url of [
      'ws://host.test/v1/racp/ws',
      'wss://user:pass@host.test/v1/racp/ws',
      'wss://host.test/v1/racp/ws?token=private',
      'wss://host.test/other'
    ])
      expect(remotePairSchema.safeParse({ ...input, url }).success).toBe(false)
  })
  it('checks shortcut conflicts against default and customized bindings', () => {
    expect(shortcutOverridesSchema.safeParse({ settings: ['meta+g'] }).success).toBe(true)
    expect(shortcutOverridesSchema.safeParse({ settings: ['meta+k'] }).success).toBe(false)
    expect(
      shortcutOverridesSchema.safeParse({ settings: [], 'command-palette': ['meta+,'] }).success
    ).toBe(true)
    expect(
      shortcutOverridesSchema.safeParse({ settings: ['meta+g'], 'command-palette': ['meta+g'] })
        .success
    ).toBe(false)
    expect(shortcutOverridesSchema.safeParse({ unknown: [] }).success).toBe(false)
  })
  it('bounds AI and voice settings and rejects unknown privilege fields', () => {
    const ai = {
      defaultThinkingLevel: 'medium',
      compactionEnabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
      retryEnabled: true,
      maxRetries: 3
    }
    expect(aiPreferencesSchema.safeParse(ai).success).toBe(true)
    expect(aiPreferencesSchema.safeParse({ ...ai, maxRetries: 100000 }).success).toBe(false)
    const voice = {
      enabled: false,
      endpoint: 'https://example.test/v1',
      model: 'audio',
      voice: 'voice',
      profile: 'realtime-ga'
    }
    expect(voiceSaveSchema.safeParse(voice).success).toBe(true)
    expect(voiceSaveSchema.safeParse({ ...voice, arbitraryCommand: 'bad' }).success).toBe(false)
  })
})
