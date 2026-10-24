/**
 * Policy enforcement at the Pi tool boundary.
 *
 * Checks `bash`, `powershell`, `write` and `edit` in Pi's public tool_call hook. Every call is
 * evaluated against the Harness Policy Engine before execution:
 * - `deny` → the tool call fails with a clear policy reason (Pi records it as
 *   a tool error and the agent can adjust).
 * - `ask`  → an interactive confirmation dialog is awaited. No window → deny.
 * - `allow` → execution proceeds.
 *
 * This composes with (never replaces) the workspace write guard.
 */

import type { HarnessPolicyDomain } from '@shared/types/harness'
import { toolNeedsApproval, type PermissionMode } from '@shared/workspace/permission-mode'
import type { PolicyEngine, PolicyEvaluation } from './policy-engine'
import { normalizeCommand } from './policy-defaults'

export interface PolicyGuardContext {
  sessionId: string
  signal?: AbortSignal
  /**
   * Session permission mode. Under `auto` (全自动) every interactive `ask`
   * decision is auto-allowed — `deny` decisions still deny.
   */
  permissionMode?: PermissionMode
  /** Reports policy decisions back into the Harness timeline / run steps. */
  report: (payload: {
    domain: HarnessPolicyDomain
    decision: 'allow' | 'ask' | 'deny'
    target: string
    rule: string
    allowed: boolean
  }) => void
}

export async function assertPolicyToolAllowed(
  policy: PolicyEngine,
  context: PolicyGuardContext,
  toolName: string,
  args: unknown
): Promise<void> {
  context.signal?.throwIfAborted()
  const toolEvaluation = policy.toolDecision(toolName)
  if (toolEvaluation.decision !== 'allow') {
    if (!(await resolve(policy, context, toolName, toolEvaluation))) {
      throw new Error(`Blocked by Harness Policy (${toolEvaluation.rule}): ${toolName}`)
    }
  }
  if (toolName === 'bash' || toolName === 'powershell') {
    const command = readStringArg(args, ['command', 'cmd']) ?? ''
    if (!command.trim()) return
    await assertShellAllowed(policy, context, command)
    return
  }
  if (toolName !== 'write' && toolName !== 'edit') {
    if (
      context.permissionMode &&
      toolNeedsApproval(toolName, context.permissionMode) &&
      toolEvaluation.decision === 'allow'
    ) {
      if (!(await resolve(policy, context, toolName, { ...toolEvaluation, decision: 'ask' }))) {
        throw new Error(`Tool approval declined: ${toolName}`)
      }
    }
    return
  }
  // Workspace edits are allowed; external targets are approved by the path guard.
  const target = readStringArg(args, ['path', 'file', 'file_path', 'filePath', 'target'])
  const evaluation = policy.fileDecision('write')
  const allowed = await resolve(
    policy,
    context,
    target ?? `${toolName} (unknown target)`,
    evaluation
  )
  if (!allowed) {
    throw new Error(
      `Blocked by Harness Policy (files.write = ${evaluation.decision}): ${target ?? toolName}`
    )
  }
}

async function assertShellAllowed(
  policy: PolicyEngine,
  context: PolicyGuardContext,
  command: string
): Promise<void> {
  const normalized = normalizeCommand(command)
  let evaluation = policy.shellCommandDecision(normalized)
  // Compound scripts, execution of downloaded code and network mutations need
  // review in the assisted tier even if the first command looks harmless.
  if (
    context.permissionMode === 'accept-edits' &&
    evaluation.decision !== 'deny' &&
    /(?:[;&|`<>]|\$\(|\b(?:sudo|chmod|chown)\b|\b(?:curl|wget)\b.*(?:--(?:data|upload-file)|\s-[dTFX]\b))/.test(
      normalized
    )
  ) {
    evaluation = { decision: 'ask', domain: 'shell', rule: 'shell.riskDetected' }
  }
  if (context.permissionMode === 'ask' && evaluation.decision === 'allow') {
    evaluation = { ...evaluation, decision: 'ask' }
  }
  const allowed = await resolve(policy, context, normalized, evaluation)
  if (!allowed) {
    throw new Error(
      `Blocked by Harness Policy (${evaluation.rule} = ${evaluation.decision}): ${normalized}`
    )
  }
}

async function resolve(
  policy: PolicyEngine,
  context: PolicyGuardContext,
  target: string,
  evaluation: PolicyEvaluation
): Promise<boolean> {
  if (evaluation.decision === 'allow') {
    context.report({
      domain: evaluation.domain,
      decision: 'allow',
      target,
      rule: evaluation.rule,
      allowed: true
    })
    return true
  }
  // 全自动 (permission mode `auto`) means the user pre-approved execution:
  // interactive asks must not block the run. Hard `deny` rules are still
  // enforced below (resolveAsk is only reached for ask; deny falls through
  // to the caller's throw).
  if (
    evaluation.decision === 'ask' &&
    (context.permissionMode === 'auto' ||
      (context.permissionMode === 'accept-edits' && evaluation.domain === 'network'))
  ) {
    context.report({
      domain: evaluation.domain,
      decision: 'ask',
      target,
      rule: evaluation.rule,
      allowed: true
    })
    return true
  }
  const allowed = await policy.resolveAsk(context.sessionId, target, evaluation, context.signal)
  return allowed
}

function readStringArg(args: unknown, keys: string[]): string | null {
  if (!args || typeof args !== 'object') return null
  const record = args as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}
