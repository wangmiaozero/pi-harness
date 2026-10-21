let unsubscribe = () => {}
/** @type {import('../../../packages/harness-plugin-sdk').HarnessPlugin} */
export default {
  activate(api) {
    /** @type {Map<string, {runId:string, startedAt:number, toolCalls:number}>} */
    const runs = new Map()
    unsubscribe = api.events.subscribe(
      ['run.started', 'run.completed', 'run.failed', 'tool.completed'],
      ({ sessionId, event }) => {
        if (event.type === 'run.started') {
          if (!event.runId) return
          if (runs.size >= 100) {
            const oldest = runs.keys().next().value
            if (oldest) runs.delete(oldest)
          }
          runs.set(sessionId, { runId: event.runId, startedAt: event.timestamp, toolCalls: 0 })
        } else if (event.type === 'tool.completed') {
          const run = runs.get(sessionId)
          if (run) run.toolCalls++
        } else {
          const run = runs.get(sessionId)
          if (run && run.runId === event.runId) {
            api.diagnostics.log('Run metrics', {
              runId: run.runId,
              durationMs: Math.max(0, event.timestamp - run.startedAt),
              toolCalls: run.toolCalls
            })
            runs.delete(sessionId)
          }
        }
      }
    )
  },
  deactivate() {
    unsubscribe()
  }
}
