/**
 * Harness Checkpoints.
 *
 * A checkpoint records recovery anchors that are actually available at creation
 * time: the session tree entry, the git HEAD/dirty state and the context
 * snapshot. Recovery reuses Pi's own navigate/fork capabilities — we never
 * pretend a full workspace rollback happened.
 */

import { randomUUID } from 'node:crypto'
import type { JsonStore } from '../../support/json-store.js'
import { log } from '../../support/runtime-log.js'
import { HarnessError } from '../harness-error.js'
import type {
  HarnessCheckpoint,
  HarnessEvent,
  HarnessForkResult
} from '../types.js'

const MAX_CHECKPOINTS_TOTAL = 500
const MAX_CHECKPOINTS_PER_SESSION = 100

export interface CheckpointGitState {
  commit: string | null
  branch: string | null
  dirty: { modified: number; added: number; deleted: number } | null
}

export interface CheckpointSessionState {
  leafId: string | null
  cwd: string | null
}

export interface CheckpointHooks {
  getSessionState: (sessionId: string) => Promise<CheckpointSessionState>
  getGitState: (cwd: string | null) => Promise<CheckpointGitState | null>
  getContextState: (sessionId: string) => Promise<{ percent: number | null; tokens: number | null } | null>
  navigateTree: (sessionId: string, entryId: string) => Promise<unknown>
  fork: (sessionId: string, entryId: string) => Promise<HarnessForkResult>
  prompt: (sessionId: string, message: string) => Promise<unknown>
  getLastRetryablePrompt: (sessionId: string) => Promise<string | null>
  emit: (sessionId: string, event: HarnessEvent) => void
  attachToRun: (sessionId: string, checkpointId: string, runId: string | null) => void
}

export interface CheckpointStoreRecord {
  schemaVersion: 1
  checkpoints: HarnessCheckpoint[]
}

export const EMPTY_CHECKPOINT_STORE: CheckpointStoreRecord = {
  schemaVersion: 1,
  checkpoints: []
}

export class CheckpointService {
  constructor(
    private readonly store: JsonStore<CheckpointStoreRecord>,
    private readonly hooks: CheckpointHooks
  ) {}

  async list(sessionId: string): Promise<HarnessCheckpoint[]> {
    const record = await this.store.read()
    return record.checkpoints.filter((checkpoint) => checkpoint.sessionId === sessionId)
  }

  async create(
    sessionId: string,
    options: {
      reason: HarnessCheckpoint['reason']
      includeGit?: boolean
      runId?: string | null
    }
  ): Promise<HarnessCheckpoint> {
    const sessionState = await this.readSessionState(sessionId)
    const gitState =
      options.includeGit === false ? null : await this.readGitState(sessionId, sessionState.cwd)
    const contextState = await this.readContextState(sessionId)
    const checkpoint: HarnessCheckpoint = {
      id: `cp-${randomUUID()}`,
      runId: options.runId ?? null,
      sessionId,
      createdAt: Date.now(),
      reason: options.reason,
      kind: checkpointKind(sessionState.leafId, gitState),
      sessionEntryId: sessionState.leafId,
      gitCommit: gitState?.commit ?? null,
      gitBranch: gitState?.branch ?? null,
      gitDirtyState: gitState?.dirty ?? null,
      contextState,
      metadata: {
        ...(sessionState.cwd ? { cwd: sessionState.cwd } : {})
      }
    }
    const record = await this.store.read()
    const next = [checkpoint, ...record.checkpoints]
    await this.store.write({
      schemaVersion: 1,
      checkpoints: pruneCheckpoints(next, sessionId)
    })
    this.hooks.emit(sessionId, {
      type: 'checkpoint.created',
      timestamp: Date.now(),
      checkpointId: checkpoint.id,
      reason: checkpoint.reason
    })
    this.hooks.attachToRun(sessionId, checkpoint.id, options.runId ?? null)
    return checkpoint
  }

  async get(checkpointId: string): Promise<HarnessCheckpoint | null> {
    const record = await this.store.read()
    return record.checkpoints.find((checkpoint) => checkpoint.id === checkpointId) ?? null
  }

  /** Navigate the session tree back to the checkpoint anchor, then optionally prompt. */
  async resume(checkpointId: string, message?: string): Promise<{
    resumed: boolean
    prompted: boolean
  }> {
    const checkpoint = await this.requireCheckpoint(checkpointId)
    if (!checkpoint.sessionEntryId) {
      throw new HarnessError(
        'CHECKPOINT_NOT_FOUND',
        'This checkpoint has no session anchor to resume from.',
        { checkpointId },
        'Create a checkpoint while the session has entries, or fork from a git checkpoint instead.'
      )
    }
    const sessionId = checkpoint.sessionId
    this.hooks.emit(sessionId, {
      type: 'recovery.started',
      timestamp: Date.now(),
      kind: 'resume',
      checkpointId
    })
    await this.hooks.navigateTree(sessionId, checkpoint.sessionEntryId)
    let prompted = false
    if (message && message.trim()) {
      await this.hooks.prompt(sessionId, message)
      prompted = true
    }
    this.hooks.emit(sessionId, {
      type: 'recovery.completed',
      timestamp: Date.now(),
      kind: 'resume',
      checkpointId
    })
    return { resumed: true, prompted }
  }

  /** Fork the session at the checkpoint anchor into a brand-new Pi session. */
  async fork(checkpointId: string): Promise<HarnessForkResult> {
    const checkpoint = await this.requireCheckpoint(checkpointId)
    if (!checkpoint.sessionEntryId) {
      throw new HarnessError(
        'CHECKPOINT_NOT_FOUND',
        'This checkpoint has no session anchor to fork from.',
        { checkpointId }
      )
    }
    const sessionId = checkpoint.sessionId
    this.hooks.emit(sessionId, {
      type: 'recovery.started',
      timestamp: Date.now(),
      kind: 'fork',
      checkpointId
    })
    const result = await this.hooks.fork(sessionId, checkpoint.sessionEntryId)
    this.hooks.emit(sessionId, {
      type: 'recovery.completed',
      timestamp: Date.now(),
      kind: 'fork',
      checkpointId
    })
    return result
  }

  /**
   * Retry the last failed or aborted run by re-sending its prompt.
   * Returns the retried prompt, or null when there is nothing to retry.
   */
  async retryLastRun(sessionId: string): Promise<{ retried: boolean; prompt: string | null }> {
    const prompt = await this.hooks.getLastRetryablePrompt(sessionId)
    if (!prompt) {
      return { retried: false, prompt: null }
    }
    this.hooks.emit(sessionId, {
      type: 'recovery.started',
      timestamp: Date.now(),
      kind: 'retry'
    })
    await this.hooks.prompt(sessionId, prompt)
    this.hooks.emit(sessionId, {
      type: 'recovery.completed',
      timestamp: Date.now(),
      kind: 'retry'
    })
    return { retried: true, prompt }
  }

  private async requireCheckpoint(checkpointId: string): Promise<HarnessCheckpoint> {
    const checkpoint = await this.get(checkpointId)
    if (!checkpoint) {
      throw new HarnessError('CHECKPOINT_NOT_FOUND', `Checkpoint not found: ${checkpointId}`, {
        checkpointId
      })
    }
    return checkpoint
  }

  private async readSessionState(sessionId: string): Promise<CheckpointSessionState> {
    try {
      return await this.hooks.getSessionState(sessionId)
    } catch (error) {
      log.harness.warn('checkpoint session state unavailable:', error)
      return { leafId: null, cwd: null }
    }
  }

  private async readGitState(
    sessionId: string,
    cwd: string | null
  ): Promise<CheckpointGitState | null> {
    if (!cwd) return null
    try {
      return await this.hooks.getGitState(cwd)
    } catch (error) {
      log.harness.warn(`checkpoint git state unavailable for ${sessionId}:`, error)
      return null
    }
  }

  private async readContextState(
    sessionId: string
  ): Promise<{ percent: number | null; tokens: number | null } | null> {
    try {
      return await this.hooks.getContextState(sessionId)
    } catch {
      return null
    }
  }
}

function checkpointKind(
  sessionEntryId: string | null,
  gitState: CheckpointGitState | null
): HarnessCheckpoint['kind'] {
  if (sessionEntryId) return 'session'
  if (gitState?.commit) return 'git'
  return 'logical'
}

function pruneCheckpoints(
  checkpoints: HarnessCheckpoint[],
  touchedSessionId: string
): HarnessCheckpoint[] {
  const perSession = new Map<string, number>()
  const kept: HarnessCheckpoint[] = []
  for (const checkpoint of checkpoints) {
    const count = perSession.get(checkpoint.sessionId) ?? 0
    const isTouched = checkpoint.sessionId === touchedSessionId
    if (isTouched && count >= MAX_CHECKPOINTS_PER_SESSION) continue
    perSession.set(checkpoint.sessionId, count + 1)
    kept.push(checkpoint)
    if (kept.length >= MAX_CHECKPOINTS_TOTAL) break
  }
  return kept
}
