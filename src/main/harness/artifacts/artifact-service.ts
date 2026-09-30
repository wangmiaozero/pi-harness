/**
 * Harness Artifact Tracking.
 *
 * Artifacts are what a run actually produced or touched: files it wrote,
 * commands it ran, commits it made, checkpoints it created. Everything is
 * derived from real evidence (session entries, git state, checkpoints) —
 * artifact records carry metadata and previews only, never full file bodies.
 */

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { JsonStore } from '../../services/storage'
import { log, redactSecrets } from '../../services/logger'
import type { GitFileDiffResponse, SessionEntry } from '@shared/types/workspace'
import { countUnifiedDiffChanges } from '@shared/workspace/unified-diff'
import type {
  HarnessArtifact,
  HarnessArtifactType,
  HarnessCheckpoint,
  HarnessEvent,
  HarnessRun
} from '@shared/types/harness'
import {
  classifyExecutionCommand,
  collectFileMutations,
  readFileMutationPath,
  sliceRunEntries
} from '../evaluation/evaluation-service'

const MAX_PERSISTED_ARTIFACTS = 1000
const COMMAND_PREVIEW_LENGTH = 200
const PATCH_PREVIEW_LENGTH = 250_000

export interface ArtifactStoreRecord {
  schemaVersion: 1
  artifacts: HarnessArtifact[]
}

export const EMPTY_ARTIFACT_STORE: ArtifactStoreRecord = { schemaVersion: 1, artifacts: [] }

export interface ArtifactHooks {
  getEntries: (sessionId: string) => Promise<SessionEntry[]>
  getCheckpoints: (sessionId: string) => Promise<HarnessCheckpoint[]>
  getGitCommits: (
    cwd: string,
    since: number,
    until: number
  ) => Promise<Array<{ hash: string; subject: string; timestamp: number }>>
  getFileDiff?: (cwd: string, filePath: string) => Promise<GitFileDiffResponse>
  emit: (sessionId: string, event: HarnessEvent) => void
}

export class ArtifactService {
  private readonly fileBackfills = new Map<string, Promise<HarnessArtifact[]>>()

  constructor(
    private readonly store: JsonStore<ArtifactStoreRecord>,
    private readonly hooks: ArtifactHooks
  ) {}

  async list(sessionId: string, runId?: string): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    return record.artifacts
      .filter((artifact) => (runId ? artifact.runId === runId : artifact.sessionId === sessionId))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async listByRunIds(runIds: string[]): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    const wanted = new Set(runIds)
    return record.artifacts.filter((artifact) => wanted.has(artifact.runId))
  }

  async listByTask(taskId: string): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    return record.artifacts.filter((artifact) => artifact.producedByTaskId === taskId)
  }

  async listByAgent(agentId: string): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    return record.artifacts.filter((artifact) => artifact.producedByAgentId === agentId)
  }

  async listByOrchestrationAgents(agentIds: string[]): Promise<HarnessArtifact[]> {
    const record = await this.store.read()
    const wanted = new Set(agentIds)
    return record.artifacts.filter(
      (artifact) => artifact.producedByAgentId !== null && wanted.has(artifact.producedByAgentId)
    )
  }

  async getArtifact(artifactId: string): Promise<HarnessArtifact | null> {
    const record = await this.store.read()
    return record.artifacts.find((artifact) => artifact.id === artifactId) ?? null
  }

  /** Record consumption for handoff bookkeeping: who received what. */
  async markConsumed(artifactIds: string[], agentId: string, taskId: string | null): Promise<void> {
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
            : ([...artifact.consumedByTaskIds, taskId].filter(Boolean) as string[])
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
        ...(await this.fileArtifacts(run, runEntries)),
        ...this.commandArtifacts(run, runEntries)
      ]
      artifacts.push(...(await this.checkpointArtifacts(run)))
      artifacts.push(...(await this.gitCommitArtifacts(run)))
      if (!artifacts.length) return []
      const saved = await this.save(artifacts)
      for (const artifact of saved) this.emitRecorded(run, artifact)
      return saved
    } catch (error) {
      log.harness.warn(`artifact collection failed for run ${run.id}:`, error)
      return []
    }
  }

  /**
   * Repair file artifacts created before the persisted Pi tool-call shape was
   * recognized. Loading a conversation only backfills file evidence, so it
   * cannot duplicate command, checkpoint or commit artifacts.
   */
  async ensureFileArtifactsForRun(run: HarnessRun): Promise<HarnessArtifact[]> {
    const pending = this.fileBackfills.get(run.id)
    if (pending) return pending
    const backfill = this.backfillFileArtifacts(run).finally(() => {
      this.fileBackfills.delete(run.id)
    })
    this.fileBackfills.set(run.id, backfill)
    return backfill
  }

  private async backfillFileArtifacts(run: HarnessRun): Promise<HarnessArtifact[]> {
    const existing = await this.list(run.sessionId, run.id)
    const existingFiles = existing.filter((artifact) => artifact.type === 'file' && artifact.path)
    if (existingFiles.length) return existingFiles
    try {
      const entries = await this.hooks.getEntries(run.sessionId)
      const artifacts = await this.fileArtifacts(run, sliceRunEntries(entries, run))
      if (!artifacts.length) return []
      const saved = await this.save(artifacts)
      for (const artifact of saved) this.emitRecorded(run, artifact)
      return saved
    } catch (error) {
      log.harness.warn(`file artifact backfill failed for run ${run.id}:`, error)
      return []
    }
  }

  private async fileArtifacts(
    run: HarnessRun,
    entries: readonly SessionEntry[]
  ): Promise<HarnessArtifact[]> {
    const mutations = collectFileMutations(entries)
    const seen = new Set<string>()
    const artifacts: HarnessArtifact[] = []
    for (const filePath of mutations) {
      const resolvedPath = resolveMutationPath(run.cwd, filePath)
      if (seen.has(resolvedPath)) continue
      seen.add(resolvedPath)
      const metadata: Record<string, unknown> = {
        mutation: 'write/edit',
        resolvedPath
      }
      let diffSupported = false
      if (run.cwd && this.hooks.getFileDiff) {
        try {
          const diff = await this.hooks.getFileDiff(run.cwd, resolvedPath)
          diffSupported = diff.supported
          if (diff.supported && typeof diff.patch === 'string') {
            const count = countUnifiedDiffChanges(diff.patch)
            metadata.additions = count.additions
            metadata.deletions = count.deletions
            metadata.patch = diff.patch.slice(0, PATCH_PREVIEW_LENGTH)
            metadata.patchTruncated = diff.patch.length > PATCH_PREVIEW_LENGTH
          }
        } catch {
          // Diff evidence is best-effort; the file mutation remains authoritative.
        }
      }
      if (!diffSupported) {
        const content = writeContentOf(entries, filePath)
        if (content !== null) {
          const patch = createAddedFilePatch(patchDisplayPath(run.cwd, resolvedPath), content)
          const count = countUnifiedDiffChanges(patch)
          metadata.additions = count.additions
          metadata.deletions = count.deletions
          metadata.patch = patch.slice(0, PATCH_PREVIEW_LENGTH)
          metadata.patchTruncated = patch.length > PATCH_PREVIEW_LENGTH
          metadata.patchSource = 'tool-write-snapshot'
        }
      }
      artifacts.push(
        this.artifact(
          run,
          'file',
          fileName(filePath),
          filePath,
          timestampOf(entries, filePath),
          metadata
        )
      )
    }
    return artifacts
  }

  private commandArtifacts(run: HarnessRun, entries: readonly SessionEntry[]): HarnessArtifact[] {
    const artifacts: HarnessArtifact[] = []
    for (const entry of entries) {
      if (entry.type !== 'message') continue
      const message = entry.message as
        { role?: string; command?: unknown; exitCode?: unknown; cancelled?: boolean } | undefined
      if (!message || message.role !== 'bashExecution') continue
      if (typeof message.command !== 'string' || !message.command.trim()) continue
      if (message.cancelled === true) continue
      const kind = classifyExecutionCommand(message.command)
      const failed = typeof message.exitCode === 'number' && message.exitCode !== 0
      const type: HarnessArtifactType =
        kind === 'test' ? 'test-report' : kind === 'build' ? 'build-output' : 'log'
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
      const commits = await this.hooks.getGitCommits(
        run.cwd,
        run.startedAt,
        run.finishedAt + 60_000
      )
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

  private emitRecorded(run: HarnessRun, artifact: HarnessArtifact): void {
    this.hooks.emit(run.sessionId, {
      type: 'artifact.recorded',
      timestamp: Date.now(),
      runId: run.id,
      artifactId: artifact.id,
      artifactType: artifact.type
    })
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

function resolveMutationPath(cwd: string | null, filePath: string): string {
  if (!cwd || path.isAbsolute(filePath) || path.win32.isAbsolute(filePath)) return filePath
  return path.resolve(cwd, filePath)
}

function timestampOf(entries: readonly SessionEntry[], filePath: string): number {
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message as { role?: string; content?: unknown } | undefined
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      const target = readFileMutationPath(block)
      if (target === filePath) return parseTimestamp(entry.timestamp) || 0
    }
  }
  return 0
}

function writeContentOf(entries: readonly SessionEntry[], filePath: string): string | null {
  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const entry = entries[entryIndex]
    if (entry.type !== 'message') continue
    const message = entry.message as { role?: string; content?: unknown } | undefined
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.content[blockIndex]
      if (readFileMutationPath(block) !== filePath || !block || typeof block !== 'object') continue
      const toolCall = block as {
        toolName?: unknown
        name?: unknown
        input?: unknown
        arguments?: unknown
      }
      const toolName = typeof toolCall.toolName === 'string' ? toolCall.toolName : toolCall.name
      if (toolName !== 'write') continue
      const input =
        toolCall.input && typeof toolCall.input === 'object'
          ? toolCall.input
          : toolCall.arguments && typeof toolCall.arguments === 'object'
            ? toolCall.arguments
            : null
      const content = input ? (input as Record<string, unknown>).content : null
      if (typeof content === 'string') return content
    }
  }
  return null
}

function patchDisplayPath(cwd: string | null, resolvedPath: string): string {
  if (!cwd) return fileName(resolvedPath)
  const relative = path.relative(cwd, resolvedPath)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.replace(/\\/g, '/')
    : fileName(resolvedPath)
}

function createAddedFilePatch(filePath: string, content: string): string {
  const hasTrailingNewline = content.endsWith('\n')
  const lines = content.split('\n')
  if (hasTrailingNewline) lines.pop()
  const body = lines.map((line) => `+${line}`).join('\n')
  const noNewlineMarker =
    !hasTrailingNewline && lines.length ? '\n\\ No newline at end of file' : ''
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`
  ].join('\n')
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
