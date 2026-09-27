import { describe, expect, it } from 'vitest'
import type { HarnessArtifact, HarnessRun } from '@shared/types/harness'
import type { AgentMessage } from '@shared/types/workspace'
import { buildMessageFileChanges } from './message-file-changes'

describe('buildMessageFileChanges', () => {
  it('binds file artifacts to the final assistant message of their run', () => {
    const messages = [
      { role: 'user', content: 'change it' },
      {
        role: 'assistant',
        model: 'test',
        provider: 'test',
        content: [{ type: 'toolCall', toolName: 'write', toolCallId: 'tool-1', input: {} }]
      },
      { role: 'toolResult', toolCallId: 'tool-1', toolName: 'write', content: [] },
      {
        role: 'assistant',
        model: 'test',
        provider: 'test',
        content: [{ type: 'text', text: 'done' }]
      }
    ] as AgentMessage[]
    const entryIds = ['user-1', 'assistant-tool', 'tool-result', 'assistant-final']
    const run = {
      id: 'run-1',
      anchorEntryId: 'user-1',
      cwd: '/repo'
    } as HarnessRun
    const artifact = fileArtifact('artifact-1', 'run-1', 'src/app.ts', {
      metadata: {
        resolvedPath: '/repo/src/app.ts',
        additions: 3,
        deletions: 1,
        patch: '@@ -1 +1 @@\n-old\n+new'
      }
    })

    const result = buildMessageFileChanges(messages, entryIds, [run], [artifact])

    expect(result.has('assistant-tool')).toBe(false)
    expect(result.get('assistant-final')).toEqual({
      runId: 'run-1',
      additions: 3,
      deletions: 1,
      files: [
        expect.objectContaining({
          artifactId: 'artifact-1',
          path: '/repo/src/app.ts',
          displayPath: 'src/app.ts'
        })
      ]
    })
  })

  it('does not leak artifacts from another run or session branch', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', model: 'test', provider: 'test', content: [] },
      { role: 'user', content: 'second' },
      { role: 'assistant', model: 'test', provider: 'test', content: [] }
    ] as AgentMessage[]
    const entryIds = ['user-1', 'assistant-1', 'user-2', 'assistant-2']
    const runs = [
      { id: 'run-1', anchorEntryId: 'user-1', cwd: '/repo' },
      { id: 'run-2', anchorEntryId: 'missing', cwd: '/other' }
    ] as HarnessRun[]
    const artifacts = [fileArtifact('a1', 'run-1', 'a.ts'), fileArtifact('a2', 'run-2', 'b.ts')]

    const result = buildMessageFileChanges(messages, entryIds, runs, artifacts)

    expect([...result.keys()]).toEqual(['assistant-1'])
    expect(result.get('assistant-1')?.files.map((file) => file.displayPath)).toEqual(['a.ts'])
  })
})

function fileArtifact(
  id: string,
  runId: string,
  path: string,
  overrides: Partial<HarnessArtifact> = {}
): HarnessArtifact {
  return {
    id,
    runId,
    sessionId: 'session-1',
    type: 'file',
    name: path.split('/').at(-1) ?? path,
    path,
    createdAt: 1,
    sourceEventId: null,
    producedByAgentId: null,
    producedByTaskId: null,
    consumedByAgentIds: [],
    consumedByTaskIds: [],
    metadata: {},
    ...overrides
  }
}
