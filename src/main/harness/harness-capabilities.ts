import type { HarnessCapabilities } from '@shared/types/harness'
import type { AgentSessionLike } from '../agent/pi-sdk'

export function detectHarnessCapabilities(session: AgentSessionLike): HarnessCapabilities {
  const manager = session.sessionManager
  const persisted = callBoolean(() => manager.isPersisted())
  return {
    prompt: true,
    abort: true,
    steering: true,
    followUp: true,
    compaction: true,
    abortCompaction: true,
    autoCompaction: true,
    autoRetry: true,
    thinkingLevel: true,
    tools: true,
    skills: true,
    extensions: true,
    sessionFork: persisted,
    sessionTree: true,
    modelSwitch: true,
    contextUsage: true,
    stats: true
  }
}

export function getThinkingOptions(session: AgentSessionLike): string[] {
  const levels = session.getAvailableThinkingLevels()
  return levels.length ? [...new Set(levels)] : ['off']
}

function callBoolean(fn: () => boolean): boolean {
  try {
    return fn()
  } catch {
    return false
  }
}
