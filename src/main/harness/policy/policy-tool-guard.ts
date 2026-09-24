/**
 * Policy enforcement at the Pi tool boundary.
 *
 * Wraps the agent session's `bash`, `write` and `edit` tools so every call is
 * evaluated against the Harness Policy Engine before execution:
 * - `deny` → the tool call fails with a clear policy reason (Pi records it as
 *   a tool error and the agent can adjust).
 * - `ask`  → an interactive confirmation dialog is awaited. No window → deny.
 * - `allow` → execution proceeds.
 *
 * This composes with (never replaces) the workspace write guard.
 */

import type { AgentSessionLike } from '../../agent/pi-sdk'
import type { HarnessPolicyDomain } from '@shared/types/harness'
import type { PolicyEngine, PolicyEvaluation } from './policy-engine'
import { normalizeCommand } from './policy-defaults'

const POLICY_GUARDED_TOOLS = new Set(['bash', 'write', 'edit'])

export interface PolicyGuardContext {
  sessionId: string
  /** Reports policy decisions back into the Harness timeline / run steps. */
  report: (payload: {
    domain: HarnessPolicyDomain
    decision: 'allow' | 'ask' | 'deny'
    target: string
    rule: string
    allowed: boolean
  }) => void
}

export function wrapPolicyGuardedTools(
  session: AgentSessionLike,
  policy: PolicyEngine,
  context: PolicyGuardContext
): void {
  const tools = session.getAllTools() as Array<Record<string, unknown> & { name: string }>
  for (const tool of tools) {
    if (!POLICY_GUARDED_TOOLS.has(tool.name)) continue
    const key = (['execute', 'handler', 'fn'] as const).find(
      (name) => typeof tool[name] === 'function'
    )
    if (!key) continue
    const original = tool[key] as (args: unknown) => Promise<unknown>
    tool[key] = async (args: unknown) => {
      await assertPolicyAllowed(policy, context, tool.name, args)
      return original.call(tool, args)
    }
  }
}

async function assertPolicyAllowed(
  policy: PolicyEngine,
  context: PolicyGuardContext,
  toolName: string,
  args: unknown
): Promise<void> {
  if (toolName === 'bash') {
    const command = readStringArg(args, ['command', 'cmd']) ?? ''
    if (!command.trim()) return
    await assertShellAllowed(policy, context, command)
    return
  }
  // write / edit tools — File Policy.
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
  const evaluation = policy.shellCommandDecision(normalized)
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
  const allowed = await policy.resolveAsk(context.sessionId, target, evaluation)
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
