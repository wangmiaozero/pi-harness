/**
 * Harness Run Repository.
 *
 * Persistence seam for run records. The business layer (RunRegistry, run
 * detail, compare, project stats) only talks to this repository — never to a
 * concrete database. The default implementation is an atomic JSON store in
 * userData with retention pruning.
 */

import type { JsonStore } from '../../services/storage'
import { log } from '../../services/logger'
import type { HarnessRun, HarnessRunTreeNode, HarnessRunRelation } from '@shared/types/harness'

const MAX_PERSISTED_RUNS = 500

export interface RunStoreRecord {
  schemaVersion: 1
  runs: HarnessRun[]
}

export const EMPTY_RUN_STORE: RunStoreRecord = { schemaVersion: 1, runs: [] }

export interface RunRepository {
  save(run: HarnessRun): Promise<void>
  saveMany(runs: HarnessRun[]): Promise<void>
  get(runId: string): Promise<HarnessRun | null>
  listAll(): Promise<HarnessRun[]>
  listBySession(sessionId: string): Promise<HarnessRun[]>
  listByCwd(cwd: string): Promise<HarnessRun[]>
  listByOrchestration(orchestrationId: string): Promise<HarnessRun[]>
  prune(now: number, retentionDays: number): Promise<number>
}

export class JsonRunRepository implements RunRepository {
  constructor(private readonly store: JsonStore<RunStoreRecord>) {}

  async save(run: HarnessRun): Promise<void> {
    await this.saveMany([run])
  }

  async saveMany(runs: HarnessRun[]): Promise<void> {
    if (!runs.length) return
    const record = await this.store.read()
    const byId = new Map(record.runs.map((existing) => [existing.id, existing]))
    for (const run of runs) byId.set(run.id, run)
    const next = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_PERSISTED_RUNS)
    await this.store.write({ schemaVersion: 1, runs: next })
  }

  async get(runId: string): Promise<HarnessRun | null> {
    const record = await this.store.read()
    return record.runs.map(normalizeRun).find((run) => run.id === runId) ?? null
  }

  async listAll(): Promise<HarnessRun[]> {
    const record = await this.store.read()
    return record.runs.map(normalizeRun)
  }

  async listBySession(sessionId: string): Promise<HarnessRun[]> {
    const record = await this.store.read()
    return record.runs.map(normalizeRun).filter((run) => run.sessionId === sessionId)
  }

  async listByCwd(cwd: string): Promise<HarnessRun[]> {
    const record = await this.store.read()
    return record.runs.map(normalizeRun).filter((run) => run.cwd === cwd)
  }

  async listByOrchestration(orchestrationId: string): Promise<HarnessRun[]> {
    const record = await this.store.read()
    return record.runs.map(normalizeRun).filter((run) => run.orchestrationId === orchestrationId)
  }

  async prune(now: number, retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
    const record = await this.store.read()
    const kept = record.runs.filter((run) => run.startedAt >= cutoff)
    if (kept.length === record.runs.length) return 0
    await this.store.write({ schemaVersion: 1, runs: kept })
    return record.runs.length - kept.length
  }
}

/** Merge multi-agent binding defaults into runs persisted before v1.5. */
function normalizeRun(run: HarnessRun): HarnessRun {
  return {
    ...run,
    agentId: run.agentId ?? null,
    taskId: run.taskId ?? null,
    orchestrationId: run.orchestrationId ?? null
  }
}

/**
 * Build the Run Tree over persisted + live runs. Tree edges are real
 * relations: forks (cross-session) and retries / recoveries / re-runs
 * (same session). Sequential turns stay siblings in time order.
 */
export function buildRunTree(runs: readonly HarnessRun[]): HarnessRunTreeNode[] {
  const byId = new Map(runs.map((run) => [run.id, run]))
  const children = new Map<string, HarnessRunTreeNode[]>()
  const nodes = new Map<string, HarnessRunTreeNode>()
  for (const run of runs) {
    nodes.set(run.id, {
      runId: run.id,
      sessionId: run.sessionId,
      prompt: run.prompt,
      status: run.status,
      relation: run.relation,
      startedAt: run.startedAt,
      model: run.model,
      children: []
    })
  }
  for (const run of runs) {
    const parentId = treeParentId(run)
    const node = nodes.get(run.id)
    if (!node) continue
    if (parentId && byId.has(parentId) && parentId !== run.id) {
      const siblings = children.get(parentId) ?? []
      siblings.push(node)
      children.set(parentId, siblings)
    }
  }
  const childOf = new Set<string>()
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.startedAt - b.startedAt)
    for (const child of siblings) childOf.add(child.runId)
  }
  return runs
    .filter((run) => !childOf.has(run.id))
    .map((run) => nodes.get(run.id))
    .filter((node): node is HarnessRunTreeNode => Boolean(node))
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(attach(children))
}

function attach(
  children: Map<string, HarnessRunTreeNode[]>
): (node: HarnessRunTreeNode) => HarnessRunTreeNode {
  return (node) => ({
    ...node,
    children: (children.get(node.runId) ?? []).map(attach(children))
  })
}

/** Tree edge: explicit fork source, or the previous run for re-executions. */
export function treeParentId(run: HarnessRun): string | null {
  if (run.forkedFromRunId) return run.forkedFromRunId
  if (run.relation !== 'original' && run.parentRunId) return run.parentRunId
  return null
}

/** Human-readable relation label key — resolved via i18n in the renderer. */
export function relationLabelKey(relation: HarnessRunRelation): string {
  return `workspace.harnessRunRelation.${relation}`
}

/** Safely log repository failures without breaking the run pipeline. */
export async function withRepositoryLog<T>(operation: string, task: () => Promise<T>): Promise<T | null> {
  try {
    return await task()
  } catch (error) {
    log.harness.warn(`run repository ${operation} failed:`, error)
    return null
  }
}
