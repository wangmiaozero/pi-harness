import type { HarnessCapabilities } from '@shared/types/harness'
import type { AgentSessionLike } from '../agent/pi-sdk'

export function detectHarnessCapabilities(session: AgentSessionLike): HarnessCapabilities {
  const manager = session.sessionManager
  const persisted = callBoolean(() => manager.isPersisted())
  return {
    prompt: typeof session.prompt === 'function',
    abort: typeof session.abort === 'function',
    steering: typeof session.steer === 'function',
    followUp: typeof session.followUp === 'function',
    compaction: typeof session.compact === 'function',
    autoCompaction: typeof session.setAutoCompactionEnabled === 'function',
    thinkingLevel: typeof session.setThinkingLevel === 'function',
    tools:
      typeof session.getAllTools === 'function' &&
      typeof session.getActiveToolNames === 'function' &&
      typeof session.setActiveToolsByName === 'function',
    sessionFork:
      persisted &&
      typeof manager.getEntry === 'function' &&
      typeof manager.createBranchedSession === 'function',
    sessionTree:
      typeof session.navigateTree === 'function' && typeof manager.getEntries === 'function',
    modelSwitch:
      typeof session.setModel === 'function' &&
      typeof session.modelRuntime?.getModel === 'function',
    contextUsage: typeof session.getContextUsage === 'function',
    stats: typeof session.getSessionStats === 'function'
  }
}

export function getThinkingOptions(session: AgentSessionLike): string[] {
  if (typeof session.getAvailableThinkingLevels === 'function') {
    try {
      const levels = session.getAvailableThinkingLevels()
      if (Array.isArray(levels) && levels.length) return [...new Set(levels.map(String))]
    } catch {
      /* Older Pi versions may expose the method without supporting this model. */
    }
  }
  return session.supportsThinking?.() === false ? ['off'] : ['off']
}

function callBoolean(fn: () => boolean): boolean {
  try {
    return fn()
  } catch {
    return false
  }
}
