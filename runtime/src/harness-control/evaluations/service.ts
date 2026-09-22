/**
 * Harness Evaluation — engineering verification over real run evidence.
 *
 * No LLM judge in this version. Every check and pipeline stage is computed
 * from what actually happened: the run verdict, session entries (bash
 * commands + exit codes), tool results and the git workspace state after
 * the run. Stages required by the configured preset turn "not executed"
 * into a visible warning.
 */

import type { JsonStore } from '../../support/json-store.js'
import type { GitStatusResponse, SessionEntry } from '../../types.js'
import type {
  HarnessEvaluation,
  HarnessEvaluationCheck,
  HarnessEvaluationPipeline,
  HarnessEvaluationPreset,
  HarnessEvaluationStage,
  HarnessEvaluationStageKind,
  HarnessRun
} from '../types.js'
import { log } from '../../support/runtime-log.js'

export type ExecutionKind = 'test' | 'lint' | 'typecheck' | 'build'

export interface EvaluationHooks {
  getEntries: (sessionId: string) => Promise<SessionEntry[]>
  getGitStatus: (sessionId: string) => Promise<GitStatusResponse | null>
}

export interface EvaluationStoreRecord {
  schemaVersion: 1
  evaluations: HarnessEvaluation[]
}

export const EMPTY_EVALUATION_STORE: EvaluationStoreRecord = {
  schemaVersion: 1,
  evaluations: []
}

export interface ExecutedCommand {
  kind: ExecutionKind
  command: string
  exitCode: number | null
}

const MAX_EVIDENCE_FILES = 20
const MAX_PERSISTED_EVALUATIONS = 200
/** Wall-clock tolerance when slicing entries for a live run without an anchor. */
const SLICE_TOLERANCE_MS = 5000

const TEST_COMMAND_PATTERN =
  /(^|\s)(vitest|jest|pytest3?|unittest|go\s+test|cargo\s+test|mvn\s+test|gradle\s+test|make\s+test|rake|ruff\s+check\s+tests)(\s|$)|(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t)(\s|$)/
const LINT_COMMAND_PATTERN =
  /(^|\s)(eslint|prettier|biome\s+check|ruff\s+check|flake8|rubocop|golangci-lint|clippy|swiftlint)(\s|$)|(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?lint(\s|$)/
const TYPECHECK_COMMAND_PATTERN =
  /(^|\s)(tsc|vue-tsc|pyright|mypy|cargo\s+check|go\s+vet)(\s|$)|(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(typecheck|check|type-check)(\s|$)/
const BUILD_COMMAND_PATTERN =
  /(^|\s)(tsc|vite\s+build|webpack|rollup|esbuild|next\s+build|nuxt\s+build|cargo\s+build|go\s+build|make)(\s|$)|(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?build(\s|$)/

export class EvaluationService {
  private readonly cache = new Map<string, HarnessEvaluation[]>()

  constructor(
    private readonly hooks: EvaluationHooks,
    private readonly store?: JsonStore<EvaluationStoreRecord>
  ) {}

  list(sessionId: string): Promise<HarnessEvaluation[]> {
    if (this.store) return this.listPersisted(sessionId)
    return Promise.resolve([...(this.cache.get(sessionId) ?? [])])
  }

  get(sessionId: string, runId: string): Promise<HarnessEvaluation | null> {
    return this.list(sessionId).then(
      (items) => items.find((evaluation) => evaluation.runId === runId) ?? null
    )
  }

  /** Evaluations for a set of run ids, across sessions (project scope). */
  async listByRunIds(runIds: readonly string[]): Promise<Map<string, HarnessEvaluation>> {
    const wanted = new Set(runIds)
    const result = new Map<string, HarnessEvaluation>()
    if (!wanted.size) return result
    if (this.store) {
      const record = await this.store.read()
      for (const evaluation of record.evaluations) {
        if (wanted.has(evaluation.runId)) result.set(evaluation.runId, evaluation)
      }
      return result
    }
    for (const items of this.cache.values()) {
      for (const evaluation of items) {
        if (wanted.has(evaluation.runId) && !result.has(evaluation.runId)) {
          result.set(evaluation.runId, evaluation)
        }
      }
    }
    return result
  }

  async evaluate(
    sessionId: string,
    run: HarnessRun,
    options: {
      preset?: HarnessEvaluationPreset
      customStages?: HarnessEvaluationStageKind[]
    } = {}
  ): Promise<HarnessEvaluation> {
    const entries = await this.readEntries(sessionId)
    const runEntries = sliceRunEntries(entries, run)
    const commands = collectExecutedCommands(runEntries)
    const fileMutations = collectFileMutations(runEntries)
    const gitStatus = await this.readGitStatus(sessionId)
    const preset = options.preset ?? 'standard'
    const customStages = options.customStages ?? []

    const checks: HarnessEvaluationCheck[] = []
    checks.push(evaluateRunStatus(run))
    checks.push(evaluateUnhandledErrors(run))
    checks.push(evaluateToolFailures(run))
    checks.push(evaluateGitWorkspace(gitStatus))
    checks.push(evaluateExpectedChanges(fileMutations, gitStatus))
    for (const kind of ['test', 'lint', 'typecheck', 'build'] as const) {
      checks.push(...evaluateExecutionChain(kind, commands, fileMutations))
    }

    const pipeline = buildPipeline({
      run,
      preset,
      customStages,
      commands,
      fileMutations,
      gitStatus,
      checks
    })

    const evaluation: HarnessEvaluation = {
      runId: run.id,
      sessionId,
      evaluatedAt: Date.now(),
      status: pipeline.finalStatus,
      checks,
      pipeline
    }
    await this.record(evaluation)
    return evaluation
  }

  async record(evaluation: HarnessEvaluation): Promise<void> {
    if (this.store) {
      await this.recordPersisted(evaluation)
      return
    }
    const existing = this.cache.get(evaluation.sessionId) ?? []
    const next = [
      evaluation,
      ...existing.filter((item) => item.runId !== evaluation.runId)
    ].slice(0, 100)
    this.cache.set(evaluation.sessionId, next)
  }

  private async listPersisted(sessionId: string): Promise<HarnessEvaluation[]> {
    const record = await this.store!.read()
    return record.evaluations
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => b.evaluatedAt - a.evaluatedAt)
  }

  private async recordPersisted(evaluation: HarnessEvaluation): Promise<void> {
    const record = await this.store!.read()
    const next = [
      evaluation,
      ...record.evaluations.filter(
        (item) => !(item.runId === evaluation.runId && item.sessionId === evaluation.sessionId)
      )
    ].slice(0, MAX_PERSISTED_EVALUATIONS)
    await this.store!.write({ schemaVersion: 1, evaluations: next })
  }

  private async readEntries(sessionId: string): Promise<SessionEntry[]> {
    try {
      return await this.hooks.getEntries(sessionId)
    } catch (error) {
      log.harness.warn(`evaluation cannot read session entries (${sessionId}):`, error)
      return []
    }
  }

  private async readGitStatus(sessionId: string): Promise<GitStatusResponse | null> {
    try {
      return await this.hooks.getGitStatus(sessionId)
    } catch {
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluation Pipeline
// ---------------------------------------------------------------------------

export interface PipelineInputs {
  run: HarnessRun
  preset: HarnessEvaluationPreset
  customStages: HarnessEvaluationStageKind[]
  commands: ExecutedCommand[]
  fileMutations: string[]
  gitStatus: GitStatusResponse | null
  checks: HarnessEvaluationCheck[]
}

/** Stage kinds each preset requires. */
export function requiredStagesForPreset(
  preset: HarnessEvaluationPreset,
  customStages: readonly HarnessEvaluationStageKind[]
): HarnessEvaluationStageKind[] {
  switch (preset) {
    case 'fast':
      return ['static-check', 'lint', 'typecheck']
    case 'standard':
      return ['static-check', 'lint', 'typecheck', 'test', 'build']
    case 'strict':
      return ['static-check', 'lint', 'typecheck', 'test', 'build', 'git-inspection', 'custom-check']
    case 'custom':
      return ['static-check', ...customStages]
  }
}

export function buildPipeline(inputs: PipelineInputs): HarnessEvaluationPipeline {
  const required = new Set(requiredStagesForPreset(inputs.preset, inputs.customStages))
  const stages: HarnessEvaluationStage[] = []

  stages.push(staticCheckStage(inputs))
  for (const kind of ['lint', 'typecheck', 'test', 'build'] as const) {
    stages.push(commandStage(kind, inputs.commands, required.has(kind)))
  }
  stages.push(gitInspectionStage(inputs.gitStatus, required.has('git-inspection')))
  stages.push(customCheckStage(inputs.fileMutations, inputs.gitStatus, required.has('custom-check')))

  const relevant = stages.filter((stage) => stage.status !== 'skipped')
  const finalStatus: HarnessEvaluationPipeline['finalStatus'] = relevant.some(
    (stage) => stage.status === 'failed'
  )
    ? 'failed'
    : relevant.some((stage) => stage.status === 'warning')
      ? 'warning'
      : 'passed'

  return {
    id: `pipe-${inputs.run.id}`,
    runId: inputs.run.id,
    name: `${inputs.preset} pipeline`,
    preset: inputs.preset,
    stages,
    finalStatus,
    startedAt: inputs.run.startedAt,
    finishedAt: inputs.run.finishedAt ?? inputs.run.startedAt
  }
}

function staticCheckStage(inputs: PipelineInputs): HarnessEvaluationStage {
  const failedChecks = inputs.checks.filter(
    (check) => check.id === 'run-completed' || check.id === 'unhandled-errors'
  )
  const status = failedChecks.some((check) => check.status === 'failed')
    ? 'failed'
    : inputs.run.toolFailureCount > 0
      ? 'warning'
      : 'passed'
  const failed = failedChecks.find((check) => check.status === 'failed')
  return {
    id: 'stage-static-check',
    kind: 'static-check',
    name: 'Static check',
    status,
    command: null,
    duration: null,
    evidence: failed?.evidence ?? null,
    message:
      failed?.message ??
      (inputs.run.toolFailureCount > 0
        ? `${inputs.run.toolFailureCount} tool call(s) failed.`
        : 'Run verdict and tool results are clean.')
  }
}

function commandStage(
  kind: 'lint' | 'typecheck' | 'test' | 'build',
  commands: readonly ExecutedCommand[],
  required: boolean
): HarnessEvaluationStage {
  const executed = commands.filter((command) => command.kind === kind)
  const label = kind === 'typecheck' ? 'Typecheck' : kind === 'test' ? 'Tests' : kind === 'lint' ? 'Lint' : 'Build'
  if (!executed.length) {
    return {
      id: `stage-${kind}`,
      kind,
      name: label,
      status: required ? 'warning' : 'skipped',
      command: null,
      duration: null,
      evidence: null,
      message: required ? `No ${label.toLowerCase()} command was executed.` : null
    }
  }
  const failed = executed.filter((command) => command.exitCode !== null && command.exitCode !== 0)
  return {
    id: `stage-${kind}`,
    kind,
    name: label,
    status: failed.length ? 'failed' : 'passed',
    command: executed[0]?.command ?? null,
    duration: null,
    evidence: failed.length
      ? failed
          .slice(0, 5)
          .map((command) => `exit ${command.exitCode}: ${command.command}`)
          .join('\n')
      : null,
    message: failed.length
      ? `${failed.length} of ${executed.length} ${label.toLowerCase()} command(s) exited non-zero.`
      : `${executed.length} ${label.toLowerCase()} command(s) passed.`
  }
}

function gitInspectionStage(
  gitStatus: GitStatusResponse | null,
  required: boolean
): HarnessEvaluationStage {
  if (!gitStatus || !gitStatus.isGitRepository) {
    return {
      id: 'stage-git-inspection',
      kind: 'git-inspection',
      name: 'Git inspection',
      status: required ? 'warning' : 'skipped',
      command: null,
      duration: null,
      evidence: null,
      message: required ? 'Not a git repository.' : null
    }
  }
  const conflicts = gitStatus.files.filter((file) => file.code === 'U' || file.code === 'C')
  return {
    id: 'stage-git-inspection',
    kind: 'git-inspection',
    name: 'Git inspection',
    status: conflicts.length ? 'failed' : 'passed',
    command: null,
    duration: null,
    evidence: conflicts.length
      ? conflicts
          .slice(0, MAX_EVIDENCE_FILES)
          .map((file) => file.filePath)
          .join('\n')
      : null,
    message: conflicts.length
      ? `Conflict markers present in ${conflicts.length} file(s).`
      : gitStatus.files.length
        ? `${gitStatus.files.length} file(s) modified in the working tree.`
        : 'Working tree is clean.'
  }
}

function customCheckStage(
  fileMutations: readonly string[],
  gitStatus: GitStatusResponse | null,
  _required: boolean
): HarnessEvaluationStage {
  if (!fileMutations.length) {
    return {
      id: 'stage-custom-check',
      kind: 'custom-check',
      name: 'File changes',
      status: 'passed',
      command: null,
      duration: null,
      evidence: null,
      message: 'No file mutations were attempted in this run.'
    }
  }
  const changedByGit = gitStatus?.isGitRepository ? gitStatus.files.length > 0 : null
  if (changedByGit === false) {
    return {
      id: 'stage-custom-check',
      kind: 'custom-check',
      name: 'File changes',
      status: 'warning',
      command: null,
      duration: null,
      evidence: fileMutations.slice(0, MAX_EVIDENCE_FILES).join('\n'),
      message: `The run attempted to modify ${fileMutations.length} file(s) but the working tree shows no changes.`
    }
  }
  return {
    id: 'stage-custom-check',
    kind: 'custom-check',
    name: 'File changes',
    status: 'passed',
    command: null,
    duration: null,
    evidence: fileMutations.slice(0, MAX_EVIDENCE_FILES).join('\n'),
    message: `${fileMutations.length} file(s) targeted for modification.`
  }
}

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

/** Slice session entries belonging to a run (anchor-based, timestamp fallback). */
export function sliceRunEntries(entries: readonly SessionEntry[], run: HarnessRun): SessionEntry[] {
  const anchorId = run.anchorEntryId ?? (run.id.startsWith('h:') ? run.id.slice(2) : null)
  if (anchorId) {
    const startIndex = entries.findIndex((entry) => entry.id === anchorId)
    if (startIndex >= 0) {
      const slice: SessionEntry[] = []
      for (let index = startIndex; index < entries.length; index += 1) {
        const entry = entries[index]
        if (!entry) continue
        if (index > startIndex && isUserPromptEntry(entry)) break
        slice.push(entry)
      }
      return slice
    }
  }
  // Live run without anchor: match by wall-clock window.
  if (!run.finishedAt) return []
  const start = run.startedAt - SLICE_TOLERANCE_MS
  const end = run.finishedAt + SLICE_TOLERANCE_MS
  return entries.filter((entry) => {
    const timestamp = Date.parse(entry.timestamp)
    return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end
  })
}

export function classifyExecutionCommand(command: string): ExecutionKind | null {
  const normalized = command.trim().replace(/\s+/g, ' ')
  if (TEST_COMMAND_PATTERN.test(normalized)) return 'test'
  if (LINT_COMMAND_PATTERN.test(normalized)) return 'lint'
  if (TYPECHECK_COMMAND_PATTERN.test(normalized)) return 'typecheck'
  if (BUILD_COMMAND_PATTERN.test(normalized)) return 'build'
  return null
}

export function collectExecutedCommands(entries: readonly SessionEntry[]): ExecutedCommand[] {
  const commands: ExecutedCommand[] = []
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message as
      | { role?: string; command?: unknown; exitCode?: unknown; cancelled?: boolean }
      | undefined
    if (!message || message.role !== 'bashExecution') continue
    if (typeof message.command !== 'string' || !message.command.trim()) continue
    const kind = classifyExecutionCommand(message.command)
    if (!kind) continue
    if (message.cancelled === true) continue
    const exitCode =
      typeof message.exitCode === 'number' && Number.isFinite(message.exitCode)
        ? message.exitCode
        : null
    commands.push({ kind, command: message.command.slice(0, 300), exitCode })
  }
  return commands
}

/** File paths the run tried to mutate through write/edit tool calls. */
export function collectFileMutations(entries: readonly SessionEntry[]): string[] {
  const paths: string[] = []
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
      const target = readPath(toolCall.input)
      if (target) paths.push(target)
    }
  }
  return [...new Set(paths)]
}

function readPath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  for (const key of ['path', 'file', 'file_path', 'filePath', 'target']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function isUserPromptEntry(entry: SessionEntry): boolean {
  if (entry.type !== 'message') return false
  const message = entry.message as { role?: string } | undefined
  return message?.role === 'user'
}

function evaluateRunStatus(run: HarnessRun): HarnessEvaluationCheck {
  if (run.status === 'failed') {
    return {
      id: 'run-completed',
      name: 'Run completed',
      status: 'failed',
      message: run.error ?? 'The run ended with an error.',
      evidence: run.error ?? undefined
    }
  }
  if (run.status === 'aborted') {
    return {
      id: 'run-completed',
      name: 'Run completed',
      status: 'warning',
      message: 'The run was aborted before finishing.'
    }
  }
  return {
    id: 'run-completed',
    name: 'Run completed',
    status: 'passed',
    message: 'The agent turn finished successfully.'
  }
}

function evaluateUnhandledErrors(run: HarnessRun): HarnessEvaluationCheck {
  if (run.error) {
    return {
      id: 'unhandled-errors',
      name: 'Unhandled errors',
      status: 'failed',
      message: run.error.slice(0, 200)
    }
  }
  return {
    id: 'unhandled-errors',
    name: 'Unhandled errors',
    status: 'passed',
    message: 'No unhandled runtime errors.'
  }
}

function evaluateToolFailures(run: HarnessRun): HarnessEvaluationCheck {
  if (run.toolFailureCount > 0) {
    const failedTools = [
      ...new Set(run.steps.filter((step) => step.kind === 'tool' && step.status === 'failed').map((step) => step.name))
    ]
    return {
      id: 'tool-failures',
      name: 'Tool failures',
      status: 'warning',
      message: `${run.toolFailureCount} tool call(s) failed.`,
      evidence: failedTools.join(', ') || undefined
    }
  }
  return {
    id: 'tool-failures',
    name: 'Tool failures',
    status: 'passed',
    message: 'No failed tool calls.'
  }
}

function evaluateGitWorkspace(gitStatus: GitStatusResponse | null): HarnessEvaluationCheck {
  if (!gitStatus || !gitStatus.isGitRepository) {
    return {
      id: 'git-workspace',
      name: 'Git workspace',
      status: 'passed',
      message: 'Not a git repository — nothing to inspect.'
    }
  }
  const conflicts = gitStatus.files.filter((file) => file.code === 'U' || file.code === 'C')
  if (conflicts.length) {
    return {
      id: 'git-workspace',
      name: 'Git workspace',
      status: 'failed',
      message: `Conflict markers present in ${conflicts.length} file(s).`,
      evidence: conflicts
        .slice(0, MAX_EVIDENCE_FILES)
        .map((file) => file.filePath)
        .join('\n')
    }
  }
  if (gitStatus.files.length) {
    return {
      id: 'git-workspace',
      name: 'Git workspace',
      status: 'passed',
      message: `${gitStatus.files.length} file(s) modified in the working tree.`,
      evidence: gitStatus.files
        .slice(0, MAX_EVIDENCE_FILES)
        .map((file) => `${file.code} ${file.filePath}`)
        .join('\n')
    }
  }
  return {
    id: 'git-workspace',
    name: 'Git workspace',
    status: 'passed',
    message: 'Working tree is clean.'
  }
}

function evaluateExpectedChanges(
  fileMutations: readonly string[],
  gitStatus: GitStatusResponse | null
): HarnessEvaluationCheck {
  if (!fileMutations.length) {
    return {
      id: 'expected-changes',
      name: 'File changes',
      status: 'passed',
      message: 'No file mutations were attempted in this run.'
    }
  }
  const changedByGit = gitStatus?.isGitRepository ? gitStatus.files.length > 0 : null
  if (changedByGit === false) {
    return {
      id: 'expected-changes',
      name: 'File changes',
      status: 'warning',
      message: `The run attempted to modify ${fileMutations.length} file(s) but the working tree shows no changes.`,
      evidence: fileMutations.slice(0, MAX_EVIDENCE_FILES).join('\n')
    }
  }
  return {
    id: 'expected-changes',
    name: 'File changes',
    status: 'passed',
    message: `${fileMutations.length} file(s) targeted for modification.`,
    evidence: fileMutations.slice(0, MAX_EVIDENCE_FILES).join('\n')
  }
}

function evaluateExecutionChain(
  kind: ExecutionKind,
  commands: readonly ExecutedCommand[],
  fileMutations: readonly string[]
): HarnessEvaluationCheck[] {
  const executed = commands.filter((command) => command.kind === kind)
  const label = kind === 'test' ? 'Tests' : kind === 'lint' ? 'Lint' : kind === 'typecheck' ? 'Typecheck' : 'Build'
  if (!executed.length) {
    return [
      {
        id: `${kind}-executed`,
        name: `${label} executed`,
        status: fileMutations.length ? 'warning' : 'passed',
        message: fileMutations.length
          ? `No ${label} command was executed although files were modified.`
          : `No ${label} command was executed.`
      }
    ]
  }
  const failed = executed.filter((command) => command.exitCode !== null && command.exitCode !== 0)
  if (failed.length) {
    return [
      {
        id: `${kind}-executed`,
        name: `${label} executed`,
        status: 'passed',
        message: `${executed.length} ${label} command(s) executed.`
      },
      {
        id: `${kind}-passed`,
        name: `${label} passed`,
        status: 'failed',
        message: `${failed.length} of ${executed.length} ${label} command(s) exited non-zero.`,
        evidence: failed
          .slice(0, 5)
          .map((command) => `exit ${command.exitCode}: ${command.command}`)
          .join('\n')
      }
    ]
  }
  return [
    {
      id: `${kind}-executed`,
      name: `${label} executed`,
      status: 'passed',
      message: `${executed.length} ${label} command(s) executed.`
    },
    {
      id: `${kind}-passed`,
      name: `${label} passed`,
      status: 'passed',
      message:
        executed.every((command) => command.exitCode === 0)
          ? `All ${label} commands exited 0.`
          : `${label} commands completed (exit codes unavailable).`
    }
  ]
}
