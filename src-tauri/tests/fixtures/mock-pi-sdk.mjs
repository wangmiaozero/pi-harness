/**
 * Mock Pi Coding Agent SDK for host-level integration tests (task §34).
 *
 * The Tauri test suite points the runtime sidecar at this module via
 * `PI_HARNESS_TEST_PI_SDK` so the whole chain
 *   Rust → Runtime sidecar → mock SDK → agent events → Rust
 * runs without the real SDK, the filesystem or any network/API tokens.
 *
 * The surface mirrors what the runtime consumes (see runtime/src/pi/types.ts):
 * `SessionManager`, `createAgentSessionServices`,
 * `createAgentSessionFromServices`, `buildContextEntries`,
 * `buildSessionContext`, `getAgentDir`, `initTheme`, `VERSION`.
 */

const agentDir = process.env.PI_HARNESS_PI_CONFIG_DIR || '/tmp/pi-harness-mock/agent'

if (process.stderr) {
  process.stderr.write(`[mock-pi-sdk] loaded; agentDir=${agentDir}\n`)
}

let counter = 0

class MockSessionManager {
  constructor(cwd) {
    counter += 1
    this.cwd = cwd
    this.id = `mock-${counter}`
    this.file = `${agentDir}/sessions/${this.id}.jsonl`
  }

  getCwd() {
    return this.cwd
  }
  getSessionFile() {
    return this.file
  }
  getSessionId() {
    return this.id
  }
  getSessionName() {
    return this.id
  }
  getEntries() {
    return []
  }
  getEntry() {
    return null
  }
  getHeader() {
    return { id: this.id, cwd: this.cwd, timestamp: new Date().toISOString() }
  }
  getLeafId() {
    return null
  }
  getBranch() {
    return []
  }
  getSessionDir() {
    return `${agentDir}/sessions`
  }
  isPersisted() {
    return true
  }
  newSession() {}
  createBranchedSession() {
    return null
  }
  appendSessionInfo() {}
}

export function makeMockSession(sessionManager) {
  const sessionId = sessionManager.getSessionId()
  const listeners = new Set()
  const session = {
    sessionId,
    sessionFile: sessionManager.getSessionFile(),
    sessionManager,
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: false,
    pendingMessageCount: 0,
    model: { id: 'mock-model', provider: 'mock-provider', input: ['text'] },
    thinkingLevel: 'off',
    agent: { state: {} },
    modelRuntime: {
      getModel: (provider, modelId) => ({ id: modelId, provider, input: ['text'] }),
      refresh: async () => {}
    },
    settingsManager: { getBlockImages: () => false },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** Emits one deterministic turn: agent_start → message_start → agent_end. */
    async prompt(message) {
      session.isStreaming = true
      const emit = (event) => {
        for (const listener of listeners) listener(event)
      }
      emit({ type: 'agent_start', sessionId })
      emit({ type: 'message_start', messageId: 'm1', role: 'assistant' })
      emit({ type: 'agent_end', sessionId })
      session.isStreaming = false
    },
    async abort() {
      session.isStreaming = false
    },
    abortCompaction() {},
    abortBash() {},
    async compact() {
      return { cancelled: false }
    },
    async navigateTree() {
      return { cancelled: false }
    },
    async setModel() {},
    setThinkingLevel() {},
    getAvailableThinkingLevels() {
      return ['off', 'low', 'high']
    },
    setSessionName() {},
    setAutoCompactionEnabled() {},
    setActiveToolsByName() {},
    getAllTools() {
      return [
        { name: 'read', description: 'Read files' },
        { name: 'bash', description: 'Run commands' }
      ]
    },
    getActiveToolNames() {
      return ['read', 'bash']
    },
    getContextUsage() {
      return { percent: 10, contextWindow: 100000, tokens: 1000 }
    },
    getSessionStats() {
      return { tokens: 1000 }
    },
    supportsThinking() {
      return true
    },
    async steer() {},
    async followUp() {},
    setSteeringMode() {},
    setFollowUpMode() {},
    hasActiveModelApiKey() {
      return true
    },
    dispose() {
      listeners.clear()
    }
  }
  return session
}

export const VERSION = '0.84.2-mock'

export const SessionManager = {
  create(cwd) {
    return new MockSessionManager(cwd)
  },
  open(path) {
    throw new Error(`mock: SessionManager.open is not implemented (${path})`)
  },
  async listAll() {
    return []
  }
}

export async function createAgentSessionServices() {
  return {
    settingsManager: { getBlockImages: () => false },
    modelRuntime: {
      getModel: (provider, modelId) => ({ id: modelId, provider, input: ['text'] }),
      refresh: async () => {}
    }
  }
}

export async function createAgentSessionFromServices({ sessionManager }) {
  return { session: makeMockSession(sessionManager), diagnostics: [] }
}

export function buildContextEntries(entries) {
  return entries
}

export function buildSessionContext() {
  return {}
}

export function getAgentDir() {
  return agentDir
}

export function initTheme() {}
