/**
 * Harness Policy Engine.
 *
 * Owns the persisted policy configuration and evaluates decisions for tools,
 * shell commands, git actions, file mutations, network access and budgets.
 * Decisions are pure; interactive `ask` confirmation and enforcement live in
 * the runtime integration (policy-tool-guard.ts, HarnessRuntime).
 */

import type { BrowserWindow, MessageBoxOptions } from 'electron'
import { dialog } from 'electron'
import type { JsonStore } from '../../services/storage'
import { log } from '../../services/logger'
import { HarnessError } from '../harness-error'
import type {
  HarnessEvaluationPreset,
  HarnessEvaluationStageKind,
  HarnessPolicyBudget,
  HarnessPolicyConfig,
  HarnessPolicyDecision,
  HarnessPolicyDecisionReport,
  HarnessPolicyDomain,
  HarnessPolicySnapshot
} from '@shared/types/harness'
import {
  classifyFileCommand,
  classifyGitCommand,
  commandMatchesPattern,
  DANGEROUS_COMMAND_PATTERNS,
  DEFAULT_POLICY_CONFIG,
  isNetworkCommand
} from './policy-defaults'

export interface PolicyEvaluation {
  decision: HarnessPolicyDecision
  domain: HarnessPolicyDomain
  rule: string
}

export type PolicyDecisionListener = (report: HarnessPolicyDecisionReport) => void

export class PolicyEngine {
  private readonly listeners = new Set<PolicyDecisionListener>()
  private getWindow: () => BrowserWindow | null = () => null

  constructor(private readonly store: JsonStore<HarnessPolicyConfig>) {}

  attachWindow(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
  }

  onDecision(listener: PolicyDecisionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async snapshot(): Promise<HarnessPolicySnapshot> {
    return {
      config: await this.config(),
      dangerousPatterns: [...DANGEROUS_COMMAND_PATTERNS],
      updatedAt: Date.now()
    }
  }

  async config(): Promise<HarnessPolicyConfig> {
    const stored = await this.store.read()
    return mergeWithDefaults(stored)
  }

  async update(next: HarnessPolicyConfig): Promise<HarnessPolicySnapshot> {
    const normalized = mergeWithDefaults(next)
    await this.store.write(normalized)
    return {
      config: normalized,
      dangerousPatterns: [...DANGEROUS_COMMAND_PATTERNS],
      updatedAt: Date.now()
    }
  }

  peek(): HarnessPolicyConfig {
    return mergeWithDefaults(this.store.peek())
  }

  budget(): HarnessPolicyBudget {
    return this.peek().budget
  }

  autoEvaluate(): boolean {
    return this.peek().evaluation.autoEvaluate
  }

  evaluationPreset(): HarnessEvaluationPreset {
    return this.peek().evaluation.preset
  }

  customEvaluationStages(): HarnessEvaluationStageKind[] {
    return this.peek().evaluation.customStages
  }

  autoPreRunCheckpoint(): boolean {
    return this.peek().checkpoints.autoPreRun
  }

  toolDecision(toolName: string): PolicyEvaluation {
    const config = this.peek()
    const decision = config.tools.overrides[toolName] ?? config.tools.default
    return {
      decision,
      domain: 'tool',
      rule: config.tools.overrides[toolName] ? `tools.overrides.${toolName}` : 'tools.default'
    }
  }

  /** Filter a requested tool list down to what policy allows to be active. */
  filterToolNames(toolNames: string[]): {
    allowed: string[]
    denied: Array<{ name: string; evaluation: PolicyEvaluation }>
  } {
    const allowed: string[] = []
    const denied: Array<{ name: string; evaluation: PolicyEvaluation }> = []
    for (const name of toolNames) {
      const evaluation = this.toolDecision(name)
      if (evaluation.decision === 'deny') denied.push({ name, evaluation })
      else allowed.push(name)
    }
    return { allowed, denied }
  }

  fileDecision(action: 'write' | 'delete' | 'rename' | 'outsideWorkspace'): PolicyEvaluation {
    const config = this.peek()
    return { decision: config.files[action], domain: 'file', rule: `files.${action}` }
  }

  gitDecision(
    action: 'commit' | 'push' | 'forcePush' | 'reset' | 'checkout' | 'branchDelete'
  ): PolicyEvaluation {
    const config = this.peek()
    return { decision: config.git[action], domain: 'git', rule: `git.${action}` }
  }

  networkDecision(): PolicyEvaluation {
    const config = this.peek()
    return { decision: config.network, domain: 'network', rule: 'network' }
  }

  /**
   * Evaluate a shell command against the full policy chain:
   * deny-list → allow-list → git policy → file policy → network policy →
   * dangerous confirmation → shell default.
   */
  shellCommandDecision(command: string): PolicyEvaluation {
    const config = this.peek()
    for (const pattern of config.shell.denyCommands) {
      if (commandMatchesPattern(command, pattern)) {
        return { decision: 'deny', domain: 'shell', rule: `shell.denyCommands: ${pattern}` }
      }
    }
    for (const pattern of config.shell.allowCommands) {
      if (commandMatchesPattern(command, pattern)) {
        return { decision: 'allow', domain: 'shell', rule: `shell.allowCommands: ${pattern}` }
      }
    }
    const gitAction = classifyGitCommand(command)
    if (gitAction) return this.gitDecision(gitAction)
    const fileAction = classifyFileCommand(command)
    if (fileAction) return this.fileDecision(fileAction)
    if (isNetworkCommand(command)) return this.networkDecision()
    if (config.shell.dangerousConfirmation) {
      for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
        if (commandMatchesPattern(command, pattern)) {
          return {
            decision: 'ask',
            domain: 'shell',
            rule: `shell.dangerousConfirmation: ${pattern}`
          }
        }
      }
    }
    return { decision: config.shell.default, domain: 'shell', rule: 'shell.default' }
  }

  /**
   * Resolve an `ask` decision interactively. Without a visible window the
   * safe answer is deny — the control plane never silently escalates.
   */
  async resolveAsk(
    sessionId: string,
    target: string,
    evaluation: PolicyEvaluation
  ): Promise<boolean> {
    if (evaluation.decision === 'allow') return true
    if (evaluation.decision === 'deny') return false
    const win = this.getWindow()
    if (!win || win.isDestroyed()) {
      this.report({
        sessionId,
        domain: evaluation.domain,
        decision: evaluation.decision,
        target,
        rule: evaluation.rule,
        allowed: false
      })
      return false
    }
    const options: MessageBoxOptions = {
      type: 'warning',
      buttons: ['Allow once', 'Deny'],
      defaultId: 1,
      cancelId: 1,
      title: 'Harness Policy',
      message: 'Pi wants to execute a command that requires confirmation',
      detail: target.slice(0, 2000),
      noLink: true
    }
    let allowed = false
    try {
      const result = await dialog.showMessageBox(win, options)
      allowed = result.response === 0
    } catch (error) {
      log.harness.warn('policy confirmation dialog failed:', error)
      allowed = false
    }
    this.report({
      sessionId,
      domain: evaluation.domain,
      decision: 'ask',
      target,
      rule: evaluation.rule,
      allowed
    })
    return allowed
  }

  report(report: HarnessPolicyDecisionReport): void {
    const payload: HarnessPolicyDecisionReport = { ...report }
    for (const listener of this.listeners) {
      try {
        listener(payload)
      } catch (error) {
        log.harness.error('policy decision listener failed:', error)
      }
    }
  }

  policyDenied(message: string, details?: unknown): HarnessError {
    return new HarnessError('POLICY_DENIED', message, details)
  }
}

export function mergeWithDefaults(
  value: Partial<HarnessPolicyConfig> | null | undefined
): HarnessPolicyConfig {
  if (!value || typeof value !== 'object') return structuredClone(DEFAULT_POLICY_CONFIG)
  const decision = (candidate: unknown, fallback: HarnessPolicyDecision): HarnessPolicyDecision =>
    candidate === 'allow' || candidate === 'ask' || candidate === 'deny' ? candidate : fallback
  const stringList = (candidate: unknown, fallback: string[]): string[] =>
    Array.isArray(candidate)
      ? candidate.filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0
        )
      : fallback
  const positiveOrNull = (candidate: unknown): number | null =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : null
  const overrides: Record<string, HarnessPolicyDecision> = {}
  if (value.tools && typeof value.tools.overrides === 'object' && value.tools.overrides !== null) {
    for (const [toolName, toolDecision] of Object.entries(value.tools.overrides)) {
      if (
        toolName &&
        (toolDecision === 'allow' || toolDecision === 'ask' || toolDecision === 'deny')
      ) {
        overrides[toolName] = toolDecision
      }
    }
  }
  return {
    schemaVersion: 1,
    tools: {
      default: decision(value.tools?.default, DEFAULT_POLICY_CONFIG.tools.default),
      overrides
    },
    files: {
      write: decision(value.files?.write, DEFAULT_POLICY_CONFIG.files.write),
      delete: decision(value.files?.delete, DEFAULT_POLICY_CONFIG.files.delete),
      rename: decision(value.files?.rename, DEFAULT_POLICY_CONFIG.files.rename),
      outsideWorkspace: decision(
        value.files?.outsideWorkspace,
        DEFAULT_POLICY_CONFIG.files.outsideWorkspace
      )
    },
    shell: {
      default: decision(value.shell?.default, DEFAULT_POLICY_CONFIG.shell.default),
      allowCommands: stringList(value.shell?.allowCommands, []),
      denyCommands: stringList(value.shell?.denyCommands, []),
      dangerousConfirmation:
        typeof value.shell?.dangerousConfirmation === 'boolean'
          ? value.shell.dangerousConfirmation
          : DEFAULT_POLICY_CONFIG.shell.dangerousConfirmation
    },
    git: {
      commit: decision(value.git?.commit, DEFAULT_POLICY_CONFIG.git.commit),
      push: decision(value.git?.push, DEFAULT_POLICY_CONFIG.git.push),
      forcePush: decision(value.git?.forcePush, DEFAULT_POLICY_CONFIG.git.forcePush),
      reset: decision(value.git?.reset, DEFAULT_POLICY_CONFIG.git.reset),
      checkout: decision(value.git?.checkout, DEFAULT_POLICY_CONFIG.git.checkout),
      branchDelete: decision(value.git?.branchDelete, DEFAULT_POLICY_CONFIG.git.branchDelete)
    },
    network: decision(value.network, DEFAULT_POLICY_CONFIG.network),
    budget: {
      maxTokens: positiveOrNull(value.budget?.maxTokens),
      maxCost: positiveOrNull(value.budget?.maxCost),
      maxToolCalls: positiveOrNull(value.budget?.maxToolCalls),
      maxRunDurationMs: positiveOrNull(value.budget?.maxRunDurationMs)
    },
    evaluation: {
      autoEvaluate:
        typeof value.evaluation?.autoEvaluate === 'boolean'
          ? value.evaluation.autoEvaluate
          : DEFAULT_POLICY_CONFIG.evaluation.autoEvaluate,
      preset: normalizePreset(value.evaluation?.preset),
      customStages: normalizeStageKinds(
        value.evaluation?.customStages,
        DEFAULT_POLICY_CONFIG.evaluation.customStages
      )
    },
    checkpoints: {
      autoPreRun:
        typeof value.checkpoints?.autoPreRun === 'boolean'
          ? value.checkpoints.autoPreRun
          : DEFAULT_POLICY_CONFIG.checkpoints.autoPreRun
    }
  }
}

function normalizePreset(candidate: unknown): HarnessPolicyConfig['evaluation']['preset'] {
  return candidate === 'fast' || candidate === 'strict' || candidate === 'custom'
    ? candidate
    : DEFAULT_POLICY_CONFIG.evaluation.preset
}

function normalizeStageKinds(
  candidate: unknown,
  fallback: HarnessPolicyConfig['evaluation']['customStages']
): HarnessPolicyConfig['evaluation']['customStages'] {
  const allowed: HarnessPolicyConfig['evaluation']['customStages'] = [
    'static-check',
    'lint',
    'typecheck',
    'test',
    'build',
    'git-inspection',
    'custom-check'
  ]
  if (!Array.isArray(candidate)) return [...fallback]
  const stages = candidate.filter(
    (item): item is HarnessPolicyConfig['evaluation']['customStages'][number] =>
      (allowed as string[]).includes(String(item))
  )
  return stages.length ? [...new Set(stages)] : [...fallback]
}
