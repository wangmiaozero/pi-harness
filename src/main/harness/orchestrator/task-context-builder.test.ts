import { describe, expect, it } from 'vitest'
import type {
  HarnessAgent,
  HarnessArtifact,
  HarnessRun,
  HarnessTask
} from '@shared/types/harness'
import { TaskContextBuilder, parseReviewVerdict } from './task-context-builder'

function agent(overrides: Partial<HarnessAgent> = {}): HarnessAgent {
  return {
    id: 'agent-1',
    orchestrationId: 'orch',
    templateId: null,
    name: 'Backend Engineer',
    role: 'backend',
    description: 'Implements core logic.',
    status: 'idle',
    provider: null,
    modelId: null,
    thinkingLevel: null,
    systemPrompt: null,
    toolNames: null,
    skillIds: [],
    isReviewer: false,
    budget: { maxCost: null, maxTokens: null },
    sessionId: null,
    cwd: '/repo',
    workspaceMode: 'shared',
    worktreePath: null,
    worktreeBranch: null,
    currentTaskId: null,
    currentRunId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function task(overrides: Partial<HarnessTask> = {}): HarnessTask {
  return {
    id: 'task-1',
    orchestrationId: 'orch',
    projectId: null,
    title: 'Implement the API',
    description: 'Build the endpoint.',
    status: 'pending',
    priority: 'normal',
    assignedAgentId: 'agent-1',
    parentTaskId: null,
    dependencies: ['task-0'],
    inputArtifactIds: [],
    runIds: [],
    artifactIds: [],
    lastRunId: null,
    retryCount: 0,
    reviewRequired: false,
    reviewAgentId: null,
    reviewVerdict: null,
    reviewSummary: null,
    error: null,
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    ...overrides
  }
}

function artifact(id: string, overrides: Partial<HarnessArtifact> = {}): HarnessArtifact {
  return {
    id,
    runId: 'run-0',
    sessionId: 'sess-0',
    sourceEventId: 'e0',
    type: 'file',
    name: `${id}.ts`,
    path: `/repo/src/${id}.ts`,
    createdAt: 1,
    producedByAgentId: 'agent-0',
    producedByTaskId: 'task-0',
    consumedByAgentIds: [],
    consumedByTaskIds: [],
    metadata: {},
    ...overrides
  }
}

function run(id: string, result: string | null): HarnessRun {
  return {
    id,
    sessionId: 'sess-0',
    parentRunId: null,
    relation: 'original',
    forkedFromRunId: null,
    forkedFromEventId: null,
    forkedFromCheckpointId: null,
    status: 'success',
    source: 'live',
    anchorEntryId: null,
    cwd: '/repo',
    agentId: 'agent-0',
    taskId: 'task-0',
    orchestrationId: 'orch',
    startedAt: 1,
    finishedAt: 2,
    model: null,
    provider: null,
    prompt: 'do it',
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, estimatedCost: null },
    toolCallCount: 0,
    toolFailureCount: 0,
    contextUsage: null,
    result,
    error: null,
    budgetExceeded: null,
    steps: [],
    checkpointIds: []
  }
}

const builder = new TaskContextBuilder()

describe('TaskContextBuilder.build', () => {
  it('includes the role, the task and dependency evidence', () => {
    const context = builder.build({
      task: task(),
      agent: agent(),
      dependencyTasks: [task({ id: 'task-0', title: 'Design the API' })],
      dependencyRuns: [run('run-0', 'Designed the endpoints')],
      artifacts: [artifact('api')],
      reviewMode: false
    })
    expect(context.prompt).toContain('backend agent')
    expect(context.prompt).toContain('## Your task')
    expect(context.prompt).toContain('Implement the API')
    expect(context.prompt).toContain('## Results from dependency tasks')
    expect(context.prompt).toContain('Designed the endpoints')
    expect(context.prompt).toContain('## Handoff artifacts from previous agents')
    expect(context.prompt).toContain('api.ts')
    expect(context.referencedArtifactIds).toEqual([artifact('api').id])
  })

  it('ignores artifacts produced by the agent itself', () => {
    const context = builder.build({
      task: task({ dependencies: [] }),
      agent: agent(),
      dependencyTasks: [],
      dependencyRuns: [],
      artifacts: [artifact('own', { producedByAgentId: 'agent-1' })],
      reviewMode: false
    })
    expect(context.prompt).not.toContain('## Handoff artifacts from previous agents')
    expect(context.referencedArtifactIds).toEqual([])
  })

  it('surfaces rejected review feedback on a retry', () => {
    const context = builder.build({
      task: task({
        reviewVerdict: 'rejected',
        reviewSummary: 'Missing error handling'
      }),
      agent: agent(),
      dependencyTasks: [],
      dependencyRuns: [],
      artifacts: [],
      reviewMode: false
    })
    expect(context.prompt).toContain('rejected by the reviewer')
    expect(context.prompt).toContain('Missing error handling')
  })
})

describe('TaskContextBuilder.buildReview', () => {
  it('builds reviewer instructions with the verdict marker', () => {
    const context = builder.buildReview({
      task: task(),
      agent: agent({ name: 'Reviewer', role: 'reviewer', isReviewer: true }),
      artifacts: [artifact('api')],
      runs: [run('run-1', 'Implemented the endpoint')]
    })
    expect(context.prompt).toContain('reviewer')
    expect(context.prompt).toContain('## Task under review')
    expect(context.prompt).toContain('## Artifacts produced by the work')
    expect(context.prompt).toContain('[REVIEW: APPROVED]')
    expect(context.prompt).toContain('[REVIEW: REJECTED]')
  })
})

describe('parseReviewVerdict', () => {
  it('parses approved verdicts case-insensitively', () => {
    expect(parseReviewVerdict('Looks good.\n[review: approved]')).toEqual({
      verdict: 'approved',
      summary: 'Looks good.'
    })
  })

  it('parses rejected verdicts and keeps the summary', () => {
    expect(parseReviewVerdict('[REVIEW: REJECTED]\nTests are missing.')).toEqual({
      verdict: 'rejected',
      summary: 'Tests are missing.'
    })
  })

  it('returns null without a verdict marker', () => {
    expect(parseReviewVerdict('All good, no marker')).toBeNull()
    expect(parseReviewVerdict(null)).toBeNull()
  })
})
