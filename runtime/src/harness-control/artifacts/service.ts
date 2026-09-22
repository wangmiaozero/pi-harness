/**
 * Harness Artifact Tracking.
 *
 * Artifacts are what a run actually produced or touched: files it wrote,
 * commands it ran, commits it made, checkpoints it created. Everything is
 * derived from real evidence (session entries, git state, checkpoints) —
 * artifact records carry metadata and previews only, never full file bodies.
 */

import { randomUUID } from 'node:crypto'
import type { JsonStore } from '../../support/json-store.js'
import { log, redactSecrets } from '../../support/runtime-log.js'
import type { SessionEntry } from '../../types.js'
import type {
  HarnessArtifact,
  HarnessArtifactType,
  HarnessCheckpoint,
  HarnessEvent,
  HarnessRun
} from '../types.js'
import { classifyExecutionCommand, collectFileMutations, sliceRunEntries } from '../evaluations/service.js'

const MAX_PERSISTED_ARTIFACTS = 1000
const COMMAND_PREVIEW_LENGTH = 200

export interface ArtifactStoreRecord {
  schemaVersion: 1
  artifacts: HarnessArtifact[]
}

export const EMPTY_ARTIFACT_STORE: ArtifactStoreRecord = { schemaVersion: 1, artifacts: [] }

export interface ArtifactHooks {
  getEntries: (sessionId: string) => Promise<SessionEntry[]>
  getCheckpoints: (sessionId: string) => Promise<HarnessCheckpoint[]>
  getGitCommits: (cwd: string, since: number, until: number) => Promise<
    Array<{ hash: string; subject: string; timestamp: number }>
  >
  emit: (sessionId: string, event: HarnessEvent) => void
}

export class ArtifactService {
  constructor(
    private readonly store: JsonStore<ArtifactStoreRecord>,
    private readonly hooks: ArtifactHooks
  ) {}

  async list(sessionId: string, runId?: string): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    return record.artifacts
      .filter((artifact) =>
        runId ? artifact.runId === runId : artifact.sessionId === sessionId
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async listByRunIds(runIds: string[]): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    const wanted = new Set(runIds)
    return record.artifacts.filter((artifact) => wanted.has(artifact.runId))
  }

  async listByTask(taskId: string): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    return record.artifacts.filter(
      (artifact) => artifact.producedByTaskId === taskId
    )
  }

  async listByAgent(agentId: string): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    return record.artifacts.filter((artifact) => artifact.producedByAgentId === agentId)
  }

  async listByOrchestrationAgents(agentIds: string[]): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    const wanted = new Set(agentIds)
    return record.artifacts.filter((artifact) => artifact.producedByAgentId !== null && wanted.has(artifact.producedByAgentId))
  }

  async getArtifact(artifactId: string): Promise<HarnessArtifact | null> {
    const record = await this.store.read()
    return record.artifacts.find((artifact) => artifact.id === artifactId) ?? null
  }

  /** Record consumption for handoff bookkeeping: who received what. */
  async markConsumed(
    artifactIds: string[],
    agentId: string,
    taskId: string | null
  ): Promise<void> {
    if (!artifactIds.length) return
    const record = await this.store.read()
    const wanted = new Set(artifactIds)
    let changed = false
    const artifacts = record.artifacts.map((artifact) => {
      if (!wanted.has(artifact.id)) return artifact
      changed = true
      return {
        ...artifact,
        consumedByAgentIds: artifact.consumedByAgentIds.includes(agentId)
          ? artifact.consumedByAgentIds
          : [...artifact.consumedByAgentIds, agentId],
        consumedByTaskIds:
          taskId && artifact.consumedByTaskIds.includes(taskId)
            ? artifact.consumedByTaskIds
            : [...artifact.consumedByTaskIds, taskId].filter(Boolean) as string[]
      }
    })
    if (changed) await this.store.write({ schemaVersion: 1, artifacts })
  }

  /**
   * Collect artifacts for a settled run from real evidence: session entries
   * (file writes, executed commands), attached checkpoints and git commits
   * that landed inside the run window.
   */
  async collectForRun(run: HarnessRun): Promise<HarnessArtifact[]> {
    try {
      const entries = await this.hooks.getEntries(run.sessionId)
      const runEntries = sliceRunEntries(entries, run)
      const artifacts: HarnessArtifact[] = [
        ...this.fileArtifacts(run, runEntries),
        ...this.commandArtifacts(run, runEntries)
      ]
      artifacts.push(...(await this.checkpointArtifacts(run)))
      artifacts.push(...(await this.gitCommitArtifacts(run)))
      if (!artifacts.length) return []
      const saved = await this.save(artifacts)
      for (const artifact of saved) {
        this.hooks.emit(run.sessionId, {
          type: 'artifact.recorded',
          timestamp: Date.now(),
          runId: run.id,
          artifactId: artifact.id,
          artifactType: artifact.type
        })
      }
      return saved
    } catch (error) {
      log.harness.warn(`artifact collection failed for run ${run.id}:`, error)
      return []
    }
  }

  private fileArtifacts(run: HarnessRun, entries: readonly SessionEntry[]): HarnessArtifact[] {
    const mutations = collectFileMutations(entries)
    const seen = new Set<string>()
    const artifacts: HarnessArtifact[] = []
    for (const filePath of mutations) {
      if (seen.has(filePath)) continue
      seen.add(filePath)
      artifacts.push(
        this.artifact(run, 'file', fileName(filePath), filePath, timestampOf(entries, filePath), {
          mutation: 'write/edit'
        })
      )
    }
    return artifacts
  }

  private commandArtifacts(run: HarnessRun, entries: readonly SessionEntry[]): HarnessArtifact[] {
    const artifacts: HarnessArtifact[] = []
    for (const entry of entries) {
      if (entry.type !== 'message') continue
      const message = entry.message as
        | { role?: string; command?: unknown; exitCode?: unknown; cancelled?: boolean }
        | undefined
      if (!message || message.role !== 'bashExecution') continue
      if (typeof message.command !== 'string' || !message.command.trim()) continue
      if (message.cancelled === true) continue
      const kind = classifyExecutionCommand(message.command)
      const failed = typeof message.exitCode === 'number' && message.exitCode !== 0
      const type: HarnessArtifactType = kind === 'test' ? 'test-report' : kind === 'build' ? 'build-output' : 'log'
      artifacts.push(
        this.artifact(
          run,
          type,
          message.command.slice(0, COMMAND_PREVIEW_LENGTH),
          null,
          parseTimestamp(entry.timestamp) || run.startedAt,
          {
            command: message.command.slice(0, COMMAND_PREVIEW_LENGTH),
            exitCode: typeof message.exitCode === 'number' ? message.exitCode : null,
            failed
          },
          entry.id
        )
      )
    }
    return artifacts
  }

  private async checkpointArtifacts(run: HarnessRun): Promise<HarnessArtifact[]> {
    let checkpoints: HarnessCheckpoint[]
    try {
      checkpoints = await this.hooks.getCheckpoints(run.sessionId)
    } catch {
      return []
    }
    return checkpoints
      .filter((checkpoint) => run.checkpointIds.includes(checkpoint.id))
      .map((checkpoint) =>
        this.artifact(
          run,
          'checkpoint',
          `checkpoint (${checkpoint.reason})`,
          null,
          checkpoint.createdAt,
          {
            checkpointId: checkpoint.id,
            gitCommit: checkpoint.gitCommit,
            sessionEntryId: checkpoint.sessionEntryId
          },
          checkpoint.id
        )
      )
  }

  private async gitCommitArtifacts(run: HarnessRun): Promise<HarnessArtifact[]> {
    if (!run.cwd || !run.finishedAt) return []
    try {
      const commits = await this.hooks.getGitCommits(run.cwd, run.startedAt, run.finishedAt + 60_000)
      return commits.map((commit) =>
        this.artifact(
          run,
          'git-commit',
          commit.subject.slice(0, COMMAND_PREVIEW_LENGTH),
          null,
          commit.timestamp,
          { hash: commit.hash },
          null
        )
      )
    } catch {
      return []
    }
  }

  private artifact(
    run: HarnessRun,
    type: HarnessArtifactType,
    name: string,
    path: string | null,
    createdAt: number,
    metadata: Record<string, unknown>,
    sourceEventId: string | null = null
  ): HarnessArtifact {
    return {
      id: `art-${randomUUID()}`,
      runId: run.id,
      sessionId: run.sessionId,
      type,
      name,
      path,
      createdAt,
      sourceEventId,
      producedByAgentId: run.agentId,
      producedByTaskId: run.taskId,
      consumedByAgentIds: [],
      consumedByTaskIds: [],
      metadata: redactSecrets(metadata) as Record<string, unknown>
    }
  }

  private async save(artifacts: HarnessArtifact[]): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    const next = [...artifacts, ...record.artifacts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_PERSISTED_ARTIFACTS)
    await this.store.write({ schemaVersion: 1, artifacts: next })
    return artifacts
  }
}

function fileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

function timestampOf(entries: readonly SessionEntry[], filePath: string): number {
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message as
      | { role?: string; content?: unknown }
      | undefined
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue
      const toolCall = block as { type?: string; toolName?: string; input?: unknown }
      if (toolCall.type !== 'toolCall') continue
      if (toolCall.toolName !== 'write' && toolCall.toolName !== 'edit') continue
      const input = toolCall.input as Record<string, unknown> | undefined
      const target =
        input && typeof input === 'object'
          ? (['path', 'file', 'file_path', 'filePath', 'target']
              .map((key) => input[key])
              .find((value) => typeof value === 'string' && value) as string | undefined)
          : undefined
      if (target === filePath) return parseTimestamp(entry.timestamp) || 0
    }
  }
  return 0
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
