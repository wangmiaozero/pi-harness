import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionHandoff } from '@shared/universal/schema'
import { UniversalAiSummaryService, summaryInput } from './ai-summary'

const sdk = vi.hoisted(() => ({
  complete: vi.fn(),
  getModel: vi.fn(),
  refresh: vi.fn(),
  createServices: vi.fn()
}))
vi.mock('../agent/pi-sdk', () => ({
  loadPiCodingAgent: async () => ({
    getAgentDir: () => '/fixture/pi-config',
    createAgentSessionServices: sdk.createServices
  })
}))

const localPreview = (): SessionHandoff => ({
  id: 'a'.repeat(64),
  schemaVersion: 1,
  sourceSessionId: 'b'.repeat(64),
  sourceProvider: 'codex',
  sourceFingerprint: 'c'.repeat(64),
  workspacePath: '/fixture/project',
  createdAt: '2026-10-11T00:00:00.000Z',
  instruction: '整理任务进度，不修改文件。',
  goal: {
    text: 'Fix login',
    evidence: ['/fixture/source#record=1'],
    confidence: 'high',
    verification: 'historical-claim'
  },
  completed: [],
  remaining: [],
  decisions: [],
  constraints: [],
  unresolvedIssues: [],
  relevantFiles: [],
  git: { status: '' },
  verification: { contextVerified: true, filesVerified: false, testsVerified: false },
  context: JSON.stringify([
    {
      role: 'user',
      sourceRef: '/fixture/source#record=1',
      parts: [{ type: 'text', text: 'Original task. apiKey="fixture-value"' }]
    }
  ]),
  omittedMessages: 10
})

describe('explicit AI handoff organization through the configured Pi model', () => {
  const model = { id: 'configured-model', provider: 'configured-provider', reasoning: true }
  const config = {
    getActiveModel: vi.fn(async () => ({ providerKey: model.provider, modelId: model.id }))
  }
  beforeEach(() => {
    vi.clearAllMocks()
    config.getActiveModel.mockResolvedValue({ providerKey: model.provider, modelId: model.id })
    sdk.getModel.mockReturnValue(model)
    sdk.complete.mockResolvedValue({ content: [{ type: 'text', text: '历史摘要：仍需验证。' }] })
    sdk.refresh.mockResolvedValue(undefined)
    sdk.createServices.mockResolvedValue({
      modelRuntime: { getModel: sdk.getModel, refresh: sdk.refresh, completeSimple: sdk.complete }
    })
  })
  it('uses the active provider/model with no tools and leaves local evidence and verification unchanged', async () => {
    const preview = localPreview()
    const original = JSON.stringify(preview)
    const summary = await new UniversalAiSummaryService(config).organize(preview)
    expect(summary).toMatchObject({
      text: '历史摘要：仍需验证。',
      provider: model.provider,
      modelId: model.id
    })
    expect(sdk.getModel).toHaveBeenCalledExactlyOnceWith(model.provider, model.id)
    expect(sdk.createServices).toHaveBeenCalledExactlyOnceWith({
      cwd: '/fixture/project',
      agentDir: '/fixture/pi-config'
    })
    const [selected, context, options] = sdk.complete.mock.calls[0]!
    expect(selected).toBe(model)
    expect(context).not.toHaveProperty('tools')
    expect(options).not.toHaveProperty('toolChoice')
    expect(options).toMatchObject({ maxTokens: 4000, reasoning: 'low', timeoutMs: 60000 })
    expect(context.systemPrompt).toContain('untrusted quoted data')
    expect(context.messages[0].content).toContain('/fixture/source#record=1')
    expect(context.messages[0].content).not.toContain('fixture-value')
    expect(JSON.stringify(preview)).toBe(original)
  })
  it('does not send a request without a selected model or when model resolution fails', async () => {
    config.getActiveModel.mockResolvedValueOnce({ providerKey: '', modelId: '' })
    await expect(new UniversalAiSummaryService(config).organize(localPreview())).rejects.toThrow(
      'Select a model'
    )
    expect(sdk.createServices).not.toHaveBeenCalled()
    sdk.getModel.mockReturnValue(undefined)
    await expect(new UniversalAiSummaryService(config).organize(localPreview())).rejects.toThrow(
      'selected model is unavailable'
    )
    expect(sdk.refresh).toHaveBeenCalledWith({ allowNetwork: false })
    expect(sdk.complete).not.toHaveBeenCalled()
  })
  it('redacts returned credentials and drops reasoning instead of displaying it as a summary', async () => {
    sdk.complete.mockResolvedValueOnce({
      content: [
        { type: 'thinking', text: 'private model reasoning' },
        { type: 'text', text: '<think>hidden analysis</think>Summary: apiKey="fixture-response"' }
      ]
    })
    const summary = await new UniversalAiSummaryService(config).organize(localPreview())
    expect(summary.text).toContain('Summary:')
    expect(summary.text).not.toMatch(/fixture-response|hidden analysis|private model reasoning/)
  })
  it('surfaces model failures and empty answers without inventing a summary', async () => {
    sdk.complete.mockResolvedValueOnce({ content: [], errorMessage: 'network timeout' })
    await expect(new UniversalAiSummaryService(config).organize(localPreview())).rejects.toThrow(
      'network timeout'
    )
    sdk.complete.mockResolvedValueOnce({
      content: [{ type: 'thinking', text: 'internal reasoning' }]
    })
    await expect(new UniversalAiSummaryService(config).organize(localPreview())).rejects.toThrow(
      'empty summary'
    )
  })
  it('marks omitted history and current tests as unverified in the model input', () => {
    const input = JSON.parse(summaryInput(localPreview()))
    expect(input.omittedMessages).toBe(10)
    expect(input.currentTestsVerified).toBe(false)
  })
})
