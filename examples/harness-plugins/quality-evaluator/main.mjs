let dispose = () => {}
/** @type {import('../../../packages/harness-plugin-sdk').HarnessPlugin} */
export default {
  activate(api) {
    const removeEvaluator = api.evaluators.register(
      { id: 'quality', version: '1.0.0' },
      (evidence) => {
        const score =
          evidence.status === 'failed' || evidence.status === 'aborted'
            ? 0
            : Math.max(0, 100 - evidence.toolFailureCount * 20)
        return {
          evaluatorId: 'quality',
          version: '1.0.0',
          score,
          status: score === 100 ? 'passed' : score >= 60 ? 'warning' : 'failed',
          findings: [
            {
              code: 'tool-outcomes',
              severity: evidence.toolFailureCount ? 'warning' : 'info',
              message: `${evidence.toolFailureCount} failed tool calls out of ${evidence.toolCallCount}.`
            }
          ],
          metadata: {
            rubric: 'Run verdict and recorded tool failures; not a code-quality guarantee.'
          }
        }
      }
    )
    const removeExporter = api.exporters.register(
      { id: 'json-trace', version: '1.0.0' },
      (trace) => ({ schemaVersion: 1, trace })
    )
    dispose = () => {
      removeEvaluator()
      removeExporter()
    }
  },
  deactivate() {
    dispose()
  }
}
