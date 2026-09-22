/**
 * Domain RPC methods: session.*, agent.*, harness.*.
 *
 * Mirrors the Electron IPC surface one-to-one (register-workspace.ts and
 * register-harness.ts) so the Tauri bridge can be a pure forwarder:
 * piSwitch.sessions/agent/harness → runtime_request(method, params) → here.
 *
 * agent.* methods route through the HarnessService — in Electron the
 * workspace's `agent` IS the HarnessRuntime (`implements AgentRuntime`), so
 * agent.start/prompt/abort/command all observe the session and emit harness
 * events too.
 */

import type { RuntimeServices } from '../services.js'
import { requireString, optionalString, RuntimeError } from '../pi/errors.js'
import type { RpcHandler, RpcParams } from './dispatch.js'
import { registerControlPlaneMethods } from './domain-control-methods.js'

type MethodMap = Record<string, RpcHandler>

/** Read `params.x` as an optional string (null treated as undefined). */
function nullableString(params: RpcParams, key: string): string | null | undefined {
  const value = params[key]
  if (value === undefined || value === null) return value === null ? null : undefined
  if (typeof value !== 'string') {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be a string or null`)
  }
  return value
}

function optionalBoolean(params: RpcParams, key: string): boolean | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be a boolean`)
  }
  return value
}

/** Validate an unknown `params.command` payload. */
function requireCommand(params: RpcParams): Record<string, unknown> {
  const command = params['command']
  if (typeof command !== 'object' || command === null || Array.isArray(command)) {
    throw new RuntimeError('INVALID_INPUT', 'Parameter "command" must be an object')
  }
  const record = command as Record<string, unknown>
  if (typeof record['type'] !== 'string' || record['type'].length === 0) {
    throw new RuntimeError('INVALID_INPUT', 'Parameter "command.type" must be a non-empty string')
  }
  return record
}

function optionalImages(params: RpcParams): unknown {
  const images = params['images']
  if (images !== undefined && images !== null && !Array.isArray(images)) {
    throw new RuntimeError('INVALID_INPUT', 'Parameter "images" must be an array when present')
  }
  return images ?? undefined
}

export function registerDomainMethods(methods: MethodMap, services: RuntimeServices): void {
  const { sessions, harness } = services

  // ------------------------------------------------------------- session.*

  methods['session.list'] = async (params) => {
    const force = optionalBoolean(params, 'force') ?? false
    return { sessions: await sessions.list(force) }
  }

  methods['session.get'] = async (params) => sessions.get(requireString(params, 'sessionId'))

  methods['session.rename'] = async (params) => {
    await sessions.rename(requireString(params, 'sessionId'), requireString(params, 'name'))
    return null
  }

  methods['session.delete'] = async (params) => {
    const sessionId = requireString(params, 'sessionId')
    try {
      await harness.stopSession(sessionId)
    } catch {
      /* a session that never ran or already died is still deletable */
    }
    await sessions.remove(sessionId)
    return null
  }

  methods['session.context'] = async (params) => {
    const leafId = nullableString(params, 'leafId')
    const detail = await sessions.get(requireString(params, 'sessionId'), leafId)
    return detail.context
  }

  methods['session.viewFullHistory'] = async (params) =>
    sessions.getFullHistory(requireString(params, 'sessionId'))

  // -------------------------------------------------------------- agent.*

  methods['agent.start'] = async (params) => {
    const toolNames = optionalStringArrayOrEmpty(params, 'toolNames')
    const provider = optionalString(params, 'provider')
    const modelId = optionalString(params, 'modelId')
    const thinkingLevel = optionalString(params, 'thinkingLevel')
    const sessionId = nullableString(params, 'sessionId')
    const cwd = optionalString(params, 'cwd')
    const message = optionalString(params, 'message')
    return harness.start({
      ...(sessionId ? { sessionId } : {}),
      ...(cwd ? { cwd } : {}),
      ...(message ? { message } : {}),
      ...(toolNames ? { toolNames } : {}),
      ...(provider && modelId ? { provider, modelId } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {})
    })
  }

  methods['agent.prompt'] = async (params) => {
    const streamingBehavior = optionalString(params, 'streamingBehavior')
    if (
      streamingBehavior !== undefined &&
      streamingBehavior !== 'steer' &&
      streamingBehavior !== 'followUp'
    ) {
      throw new RuntimeError(
        'INVALID_INPUT',
        'Parameter "streamingBehavior" must be "steer" or "followUp"'
      )
    }
    return harness.prompt(requireString(params, 'sessionId'), requireString(params, 'message'), {
      images: optionalImages(params),
      ...(streamingBehavior ? { streamingBehavior } : {})
    })
  }

  methods['agent.abort'] = async (params) => {
    await harness.abort(requireString(params, 'sessionId'))
    return null
  }

  methods['agent.state'] = async (params) =>
    harness.getAgentState(requireString(params, 'sessionId'))

  methods['agent.running'] = async () => ({ ids: harness.listRunning() })

  methods['agent.command'] = async (params) => {
    const command = requireCommand(params)
    return harness.executeAgentCommand(requireString(params, 'sessionId'), command)
  }

  // ------------------------------------------------------------ harness.*

  methods['harness.getState'] = async (params) =>
    harness.getState(requireString(params, 'sessionId'))

  methods['harness.getTools'] = async (params) =>
    harness.getTools(requireString(params, 'sessionId'))

  methods['harness.setTools'] = async (params) => {
    const toolNames = requireStringArray(params, 'toolNames')
    await harness.setTools(requireString(params, 'sessionId'), toolNames)
    return null
  }

  methods['harness.setModel'] = async (params) => {
    await harness.setModel(
      requireString(params, 'sessionId'),
      requireString(params, 'provider'),
      requireString(params, 'modelId')
    )
    return null
  }

  methods['harness.setThinkingLevel'] = async (params) => {
    await harness.setThinkingLevel(
      requireString(params, 'sessionId'),
      requireString(params, 'level')
    )
    return null
  }

  methods['harness.compact'] = async (params) => {
    const instructions = optionalString(params, 'instructions')
    return harness.compact(requireString(params, 'sessionId'), instructions)
  }

  methods['harness.abortCompaction'] = async (params) => {
    await harness.abortCompaction(requireString(params, 'sessionId'))
    return null
  }

  methods['harness.setAutoCompaction'] = async (params) => {
    await harness.setAutoCompaction(
      requireString(params, 'sessionId'),
      optionalBoolean(params, 'enabled') === true
    )
    return null
  }

  methods['harness.steer'] = async (params) => {
    await harness.steer(requireString(params, 'sessionId'), requireString(params, 'message'))
    return null
  }

  methods['harness.followUp'] = async (params) => {
    await harness.followUp(requireString(params, 'sessionId'), requireString(params, 'message'))
    return null
  }

  methods['harness.fork'] = async (params) =>
    harness.fork(requireString(params, 'sessionId'), requireString(params, 'entryId'))

  methods['harness.navigateTree'] = async (params) =>
    harness.navigateTree(requireString(params, 'sessionId'), requireString(params, 'targetId'))

  methods['harness.getSession'] = async (params) =>
    harness.getSession(requireString(params, 'sessionId'))

  methods['harness.getStats'] = async (params) =>
    harness.getStats(requireString(params, 'sessionId'))

  methods['harness.getTimeline'] = async (params) => {
    const sessionId = requireString(params, 'sessionId')
    return { events: harness.getTimeline(sessionId) }
  }

  registerControlPlaneMethods(methods, services)
}

/** `toolNames?: string[]` — undefined or a string array ([] allowed). */
function optionalStringArrayOrEmpty(params: RpcParams, key: string): string[] | undefined {
  const value = params[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be an array of strings`)
  }
  return value as string[]
}

function requireStringArray(params: RpcParams, key: string): string[] {
  const value = optionalStringArrayOrEmpty(params, key)
  if (value === undefined) {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be an array of strings`)
  }
  return value
}
