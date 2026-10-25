import { summarizeSessionTitle } from '@shared/workspace/session-title'
import { parentPort } from 'node:worker_threads'
import type { SessionIndexRequest, SessionIndexResponse } from './session-index-client'

const port = parentPort!
let queue = Promise.resolve()
port.on('message', (request: SessionIndexRequest) => {
  queue = queue.then(async () => {
    try {
      if (request.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = request.agentDir
      // Use the public Native Pi reader, never instantiate an AgentSession here.
      const { SessionManager } = await import('@earendil-works/pi-coding-agent')
      const sessions = (await SessionManager.listAll()).map((session) => ({
        path: session.path,
        id: session.id,
        cwd: session.cwd,
        name: session.name,
        suggestedTitle: summarizeSessionTitle([session.firstMessage, session.allMessagesText]),
        created: session.created,
        modified: session.modified,
        messageCount: session.messageCount,
        firstMessage: session.firstMessage,
        parentSessionPath: session.parentSessionPath
      }))
      // allMessagesText is unused by the app; do not clone entire transcripts to Main.
      port.postMessage({ requestId: request.requestId, sessions } satisfies SessionIndexResponse)
    } catch (error) {
      port.postMessage({
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error)
      } satisfies SessionIndexResponse)
    }
  })
})
