import { describe, expect, it, vi } from 'vitest'
import type { HarnessRun } from '@shared/types/harness'
import type { GitStatusResponse, SessionEntry } from '@shared/types/workspace'
import {
  classifyExecutionCommand,
  collectExecutedCommands,
  collectFileMutations,
  EvaluationService,
  sliceRunEntries
} from './evaluation-service'

function run(overrides: Partial<HarnessRun> = {}): HarnessRun {
  return {
    id: 'h:entry-1',
    sessionId: 's1',
    parentRunId: null,
    relation: 'original',
    forkedFromRunId: null,
    forkedFromEventId: null,
    forkedFromCheckpointId: null,
    status: 'success',
    source: 'live',
    anchorEntryId: null,
    cwd: null,
    startedAt: Date.parse('2024-01-01T00:00:00.000Z'),
    finishedAt: Date.parse('2024-01-01T00:00:10.000Z'),
    model: 'test-model',
    provider: null,
    prompt: 'ship it',
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, estimatedCost: null },
    toolCallCount: 0,
    toolFailureCount: 0,
    contextUsage: null,
    result: null,
    error: null,
    agentId: null,
    taskId: null,
    orchestrationId: null,
    budgetExceeded: null,
    steps: [],
    checkpointIds: [],
    ...overrides
  }
}

function userEntry(id: string, timestamp: string, text: string): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp,
    message: { role: 'user', content: text }
  } as unknown as SessionEntry
}

function bashEntry(id: string, timestamp: string, command: string, exitCode: number): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp,
    message: { role: 'bashExecution', command, output: '', exitCode }
  } as unknown as SessionEntry
}

function toolCallEntry(id: string, timestamp: string, toolName: string): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp,
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', toolCallId: `${id}-tc`, toolName, input: {} }]
    }
  } as unknown as SessionEntry
}

function gitStatus(overrides: Partial<GitStatusResponse> = {}): GitStatusResponse {
  return {
    isGitRepository: true,
    repositoryRoot: '/tmp/project',
    files: [],
    additions: 0,
    deletions: 0,
    ...overrides
  }
}

describe('classifyExecutionCommand', () => {
  it('classifies test, lint and build commands', () => {
    expect(classifyExecutionCommand('pnpm vitest run src')).toBe('test')
    expect(classifyExecutionCommand('npm test')).toBe('test')
    expect(classifyExecutionCommand('pnpm lint')).toBe('lint')
    expect(classifyExecutionCommand('npx eslint .')).toBe('lint')
    expect(classifyExecutionCommand('pnpm build')).toBe('build')
    expect(classifyExecutionCommand('tsc --noEmit')).toBe('typecheck')
    expect(classifyExecutionCommand('pnpm typecheck')).toBe('typecheck')
    expect(classifyExecutionCommand('ls -la')).toBeNull()
  })
})

describe('collectExecutedCommands', () => {
  it('collects commands with exit codes and skips cancelled ones', () => {
    const entries = [
      bashEntry('b1', '2024-01-01T00:00:02.000Z', 'pnpm vitest run', 0),
      bashEntry('b2', '2024-01-01T00:00:03.000Z', 'pnpm build', 1),
      {
        ...bashEntry('b3', '2024-01-01T00:00:04.000Z', 'rm -rf x', 0),
        message: { role: 'bashExecution', command: 'rm -rf x', output: '', exitCode: 0, cancelled: true }
      } as unknown as SessionEntry
    ]
    expect(collectExecutedCommands(entries)).toEqual([
      { kind: 'test', command: 'pnpm vitest run', exitCode: 0 },
      { kind: 'build', command: 'pnpm build', exitCode: 1 }
    ])
  })
})

describe('collectFileMutations', () => {
  it('collects files touched by write and edit tool calls', () => {
    const entries = [
      {
        ...toolCallEntry('t1', '2024-01-01T00:00:02.000Z', 'write'),
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', toolCallId: 't1-tc', toolName: 'write', input: { path: 'a.ts' } }
          ]
        }
      } as unknown as SessionEntry,
      {
        ...toolCallEntry('t2', '2024-01-01T00:00:03.000Z', 'edit'),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              toolCallId: 't2-tc',
              toolName: 'edit',
              input: { path: 'b.ts', edits: [] }
            }
          ]
        }
      } as unknown as SessionEntry,
      toolCallEntry('t3', '2024-01-01T00:00:04.000Z', 'read')
    ]
    expect(collectFileMutations(entries)).toEqual(['a.ts', 'b.ts'])
  })
})

describe('sliceRunEntries', () => {
  it('slices from the anchor entry when the run id carries one', () => {
    const entries = [
      userEntry('entry-0', '2024-01-01T00:00:00.000Z', 'before'),
      userEntry('entry-1', '2024-01-01T00:00:01.000Z', 'anchor prompt'),
      bashEntry('b1', '2024-01-01T00:00:02.000Z', 'pnpm test', 0)
    ]
    const sliced = sliceRunEntries(entries, run())
    expect(sliced.map((entry) => entry.id)).toEqual(['entry-1', 'b1'])
  })

  it('falls back to a timestamp window for runs without an anchor', () => {
    const entries = [
      userEntry('e0', '2023-12-31T23:59:00.000Z', 'old'),
      userEntry('e1', '2024-01-01T00:00:02.000Z', 'during'),
      userEntry('e2', '2024-01-01T00:01:00.000Z', 'after')
    ]
    const sliced = sliceRunEntries(entries, run({ id: 'run-xyz' }))
    expect(sliced.map((entry) => entry.id)).toEqual(['e1'])
  })
})

describe('EvaluationService', () => {
  it('evaluates a run from real evidence and caches the result', async () => {
    const entries = [
      userEntry('entry-1', '2024-01-01T00:00:01.000Z', 'anchor prompt'),
      bashEntry('b1', '2024-01-01T00:00:02.000Z', 'pnpm vitest run', 0),
      bashEntry('b2', '2024-01-01T00:00:03.000Z', 'pnpm lint', 0),
      bashEntry('b3', '2024-01-01T00:00:04.000Z', 'tsc --noEmit', 0),
      bashEntry('b4', '2024-01-01T00:00:05.000Z', 'pnpm build', 0)
    ]
    const service = new EvaluationService({
      getEntries: vi.fn(async () => entries),
      getGitStatus: vi.fn(async () => gitStatus())
    })

    const evaluation = await service.evaluate('s1', run())

    expect(evaluation).toMatchObject({ runId: 'h:entry-1', sessionId: 's1', status: 'passed' })
    const byId = new Map(evaluation.checks.map((check) => [check.id, check]))
    expect(byId.get('run-completed')?.status).toBe('passed')
    expect(byId.get('unhandled-errors')?.status).toBe('passed')
    expect(byId.get('test-executed')?.status).toBe('passed')
    expect(byId.get('test-passed')?.status).toBe('passed')
    expect(byId.get('build-executed')?.status).toBe('passed')
    expect(byId.get('lint-executed')?.status).toBe('passed')
    expect(evaluation.pipeline?.finalStatus).toBe('passed')
    expect(
      evaluation.pipeline?.stages.map((stage) => [stage.kind, stage.status])
    ).toContainEqual(['typecheck', 'passed'])
    expect(await service.get('s1', 'h:entry-1')).toEqual(evaluation)
  })

  it('marks runs with unhandled errors and failed tests as failed', async () => {
    const entries = [
      userEntry('entry-1', '2024-01-01T00:00:01.000Z', 'anchor prompt'),
      bashEntry('b1', '2024-01-01T00:00:02.000Z', 'pnpm vitest run', 1)
    ]
    const service = new EvaluationService({
      getEntries: vi.fn(async () => entries),
      getGitStatus: vi.fn(async () => gitStatus())
    })

    const evaluation = await service.evaluate(
      's1',
      run({ status: 'failed', error: 'boom' })
    )

    expect(evaluation.status).toBe('failed')
    const byId = new Map(evaluation.checks.map((check) => [check.id, check]))
    expect(byId.get('run-completed')?.status).toBe('failed')
    expect(byId.get('unhandled-errors')?.status).toBe('failed')
    expect(byId.get('test-executed')?.status).toBe('passed')
    expect(byId.get('test-passed')?.status).toBe('failed')
  })

  it('warns when mutations happened but the git tree stayed clean', async () => {
    const entries = [
      userEntry('entry-1', '2024-01-01T00:00:01.000Z', 'anchor prompt'),
      {
        type: 'message',
        id: 't1',
        parentId: null,
        timestamp: '2024-01-01T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', toolCallId: 't1-tc', toolName: 'write', input: { path: 'a.ts' } }
          ]
        }
      } as unknown as SessionEntry
    ]
    const service = new EvaluationService({
      getEntries: vi.fn(async () => entries),
      getGitStatus: vi.fn(async () => gitStatus())
    })

    const evaluation = await service.evaluate('s1', run())

    expect(evaluation.status).toBe('warning')
    expect(
      evaluation.checks.find((check) => check.id === 'expected-changes')?.status
    ).toBe('warning')
  })

  it('flags merge conflicts in the git workspace as failed', async () => {
    const service = new EvaluationService({
      getEntries: vi.fn(async () => []),
      getGitStatus: vi.fn(async () =>
        gitStatus({
          files: [
            {
              filePath: 'conflicted.ts',
              status: 'conflict',
              code: 'U',
              indexStatus: 'U',
              worktreeStatus: 'U'
            }
          ]
        })
      )
    })

    const evaluation = await service.evaluate('s1', run())
    expect(evaluation.checks.find((check) => check.id === 'git-workspace')?.status).toBe('failed')
  })
})
