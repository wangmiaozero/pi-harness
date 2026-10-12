// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ArchitectureModel } from './model'
import { scanProject } from './scanner'
import { extractGraph } from './graph'

const sdk = vi.hoisted(() => ({ load: vi.fn(), complete: vi.fn() }))
vi.mock('../agent/pi-sdk', () => ({ loadPiCodingAgent: sdk.load }))
beforeEach(() => {
  vi.clearAllMocks()
})
describe('configured Pi model architecture enrichment', () => {
  it('uses bounded redacted excerpts and labels inference without adding graph identities', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'architecture-ai-')))
    try {
      await fs.writeFile(
        path.join(root, 'main.ts'),
        'export const apiKey="sk-abcdefghijklmnopqrstuvwx"\nexport const app=1'
      )
      const scan = await scanProject(root, new AbortController().signal)
      const graph = extractGraph(root, scan)
      sdk.load.mockResolvedValue({
        createAgentSessionServices: async () => ({
          modelRuntime: {
            getModel: () => ({ id: 'fixture', provider: 'local', contextWindow: 64000 }),
            completeSimple: sdk.complete
          }
        })
      })
      sdk.complete.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary: 'Entry module',
              modules: [{ id: graph.nodes[0].id, description: 'Exports app' }]
            })
          }
        ]
      })
      const policy = {
        budget: () => ({
          maxTokens: 12000,
          maxCost: null,
          maxRunDurationMs: 20000,
          maxToolCalls: null
        }),
        networkDecision: () => ({
          decision: 'allow' as const,
          domain: 'network' as const,
          rule: 'test'
        }),
        resolveAsk: async () => true
      }
      const model = new ArchitectureModel(
        { getActiveModel: async () => ({ providerKey: 'local', modelId: 'fixture' }) },
        policy
      )
      await model.enrich(root, graph, scan, new AbortController().signal, 'zh-TW')
      const context = sdk.complete.mock.calls[0][1]
      expect(context.systemPrompt).toContain('zh-TW')
      expect(context.messages[0].content).not.toContain('sk-abcdefghijklmnopqrstuvwx')
      expect(context.messages[0].content).toContain('[REDACTED]')
      expect(graph.nodes[0].evidence).toBe('ai-inferred')
      expect(graph.nodes[0].sourceReferences[0].path).toBe('main.ts')
      expect(graph.revision.modelId).toBe('local/fixture')
      sdk.complete.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary: 'Fake',
              modules: [{ id: 'unknown', description: 'Invented' }]
            })
          }
        ]
      })
      await expect(model.enrich(root, graph, scan, new AbortController().signal)).rejects.toThrow(
        'unknown module'
      )
      const denied = new ArchitectureModel(
        { getActiveModel: async () => ({ providerKey: 'local', modelId: 'fixture' }) },
        { ...policy, resolveAsk: async () => false }
      )
      await expect(denied.enrich(root, graph, scan, new AbortController().signal)).rejects.toThrow(
        'Policy'
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
