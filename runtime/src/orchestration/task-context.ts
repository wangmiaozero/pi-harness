/**
 * Task Context Builder.
 *
 * Constructs the prompt a task's agent actually receives: task description,
 * parent context, dependency results, handoff artifacts, project context and
 * the agent's role. Context is isolated per agent — no cross-session history
 * is dumped in, only explicit, selected inputs.
 */

import type {
  HarnessAgent,
  HarnessArtifact,
  HarnessRun,
  HarnessTask
} from '../harness-control/types.js'

const ARTIFACT_CONTEXT_LIMIT = 8
const RUN_RESULT_PREVIEW = 600
const TASK_DESCRIPTION_PREVIEW = 4000

export interface TaskContextInputs {
  task: HarnessTask
  agent: HarnessAgent
  /** Completed dependency tasks with their runs. */
  dependencyTasks: HarnessTask[]
  /** Runs of the dependency tasks (for result previews). */
  dependencyRuns: HarnessRun[]
  /** Artifacts explicitly handed off to this task or produced by dependencies. */
  artifacts: HarnessArtifact[]
  /** Review verdict marker expected at the end of a reviewer run. */
  reviewMode: boolean
}

export interface TaskContext {
  prompt: string
  /** Artifact ids referenced in the prompt (handoff bookkeeping). */
  referencedArtifactIds: string[]
}

export class TaskContextBuilder {
  build(input: TaskContextInputs): TaskContext {
    const sections: string[] = []
    const referenced: string[] = []

    sections.push(this.roleSection(input.agent, input.reviewMode))
    sections.push(this.taskSection(input.task))

    const parent = input.dependencyTasks.find(
      (task) => task.id === input.task.parentTaskId
    )
    if (parent) {
      sections.push(`## Parent task\n${parent.title}\n${parent.description ?? ''}`)
    }

    const handoffArtifacts = input.artifacts
      .filter((artifact) => input.task.inputArtifactIds.includes(artifact.id))
      .slice(0, ARTIFACT_CONTEXT_LIMIT)
    const dependencyArtifacts = input.artifacts
      .filter(
        (artifact) =>
          artifact.producedByTaskId !== null &&
          input.task.dependencies.includes(artifact.producedByTaskId) &&
          !handoffArtifacts.some((item) => item.id === artifact.id)
      )
      .slice(0, ARTIFACT_CONTEXT_LIMIT - handoffArtifacts.length)
    const artifacts = [...handoffArtifacts, ...dependencyArtifacts]
    if (artifacts.length) {
      for (const artifact of artifacts) referenced.push(artifact.id)
      sections.push(this.artifactSection(artifacts))
    }

    const dependencyResults = input.dependencyRuns
      .filter((run) => input.task.dependencies.includes(run.taskId ?? '') && run.result)
      .slice(0, ARTIFACT_CONTEXT_LIMIT)
    if (dependencyResults.length) {
      sections.push(this.resultSection(dependencyResults))
    }

    if (input.reviewMode) {
      sections.push(this.reviewSection())
    }

    sections.push(this.completionSection(input.task, input.reviewMode))

    return {
      prompt: sections.filter(Boolean).join('\n\n'),
      referencedArtifactIds: referenced
    }
  }

  /** Context for a reviewer agent gating a completed task. */
  buildReview(input: {
    task: HarnessTask
    agent: HarnessAgent
    artifacts: HarnessArtifact[]
    runs: HarnessRun[]
  }): TaskContext {
    const sections: string[] = []
    sections.push(this.roleSection(input.agent, true))
    sections.push(
      [
        '## Task under review',
        `${input.task.title}`,
        input.task.description?.slice(0, TASK_DESCRIPTION_PREVIEW) ?? ''
      ]
        .filter(Boolean)
        .join('\n')
    )
    const artifacts = input.artifacts.slice(0, ARTIFACT_CONTEXT_LIMIT)
    if (artifacts.length) {
      sections.push(
        [
          '## Artifacts produced by the work',
          ...artifacts.map(
            (artifact) =>
              `- ${artifact.type} — ${artifact.name}${artifact.path ? ` (${artifact.path})` : ''}`
          )
        ].join('\n')
      )
    }
    const results = input.runs
      .filter((run) => run.result)
      .slice(0, ARTIFACT_CONTEXT_LIMIT)
    if (results.length) {
      sections.push(
        [
          '## Agent summaries',
          ...results.map((run) => `- ${(run.result ?? '').slice(0, RUN_RESULT_PREVIEW).trim()}`)
        ].join('\n')
      )
    }
    sections.push(this.reviewSection())
    return {
      prompt: sections.filter(Boolean).join('\n\n'),
      referencedArtifactIds: artifacts.map((artifact) => artifact.id)
    }
  }

  private roleSection(agent: HarnessAgent, reviewMode: boolean): string {
    const lines = [
      `You are the ${agent.role} agent ("${agent.name}") in a multi-agent team.`,
      'Work only on your assigned task. Other agents handle their own tasks.'
    ]
    if (agent.description) lines.push(agent.description)
    if (reviewMode) {
      lines.push(
        'You are a reviewer: inspect the work, do not modify code unless the task explicitly requires a fix.'
      )
    }
    return lines.join('\n')
  }

  private taskSection(task: HarnessTask): string {
    const lines = [`## Your task\n${task.title}`]
    if (task.description) {
      lines.push(task.description.slice(0, TASK_DESCRIPTION_PREVIEW))
    }
    if (task.reviewVerdict === 'rejected' && task.reviewSummary) {
      lines.push(
        `A previous attempt was rejected by the reviewer. Address this feedback:\n${task.reviewSummary.slice(0, RUN_RESULT_PREVIEW)}`
      )
    }
    if (task.priority === 'critical' || task.priority === 'high') {
      lines.push(`Priority: ${task.priority}.`)
    }
    return lines.join('\n')
  }

  private artifactSection(artifacts: HarnessArtifact[]): string {
    const lines = ['## Handoff artifacts from previous agents']
    for (const artifact of artifacts) {
      const detail = artifact.path
        ? `${artifact.type} — ${artifact.name} (${artifact.path})`
        : `${artifact.type} — ${artifact.name}`
      lines.push(`- ${detail}`)
    }
    lines.push('Treat these as trusted inputs from your teammates.')
    return lines.join('\n')
  }

  private resultSection(runs: HarnessRun[]): string {
    const lines = ['## Results from dependency tasks']
    for (const run of runs) {
      lines.push(
        `- ${(run.result ?? '').slice(0, RUN_RESULT_PREVIEW).trim() || '(no summary)'}`
      )
    }
    return lines.join('\n')
  }

  private reviewSection(): string {
    return [
      '## Review instructions',
      'Inspect the produced artifacts, diffs, evaluations and tests of the work under review.',
      'End your reply with exactly one verdict line:',
      '`[REVIEW: APPROVED]` when the work meets the requirements,',
      '`[REVIEW: REJECTED]` when it does not, followed by concrete reasons.'
    ].join('\n')
  }

  private completionSection(task: HarnessTask, reviewMode: boolean): string {
    if (reviewMode) {
      return 'Reply with your review and the final verdict line.'
    }
    return [
      '## Completion',
      'When the task is done, reply with a concise summary of what you implemented and the outcome.'
    ].join('\n')
  }
}

/** Parse the reviewer verdict from a run result. */
export function parseReviewVerdict(
  result: string | null
): { verdict: 'approved' | 'rejected'; summary: string | null } | null {
  if (!result) return null
  const match = result.match(/\[REVIEW:\s*(APPROVED|REJECTED)\s*\]/i)
  if (!match) return null
  const verdict = match[1]?.toUpperCase() === 'APPROVED' ? 'approved' : 'rejected'
  const summary = result
    .replace(match[0], '')
    .trim()
    .slice(0, RESULT_PREVIEW_LIMIT)
  return { verdict, summary: summary || null }
}

const RESULT_PREVIEW_LIMIT = 1000
