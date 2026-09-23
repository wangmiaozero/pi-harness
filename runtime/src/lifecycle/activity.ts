/**
 * Idle-shutdown input. Busy means the sidecar must stay up.
 * Text-delta batching and orchestration runs show up here as live agents.
 */

export interface ActivitySnapshot {
  busy: boolean
  reasons: string[]
  memory: {
    rss: number
    heapUsed: number
    heapTotal: number
  }
}

export function describeActivity(input: {
  runningAgents: readonly string[]
  installState: string | null
}): ActivitySnapshot {
  const reasons: string[] = []
  if (input.runningAgents.length > 0) reasons.push('agent')
  if (input.installState === 'pending' || input.installState === 'running') {
    reasons.push('pi-install')
  }
  const memory = process.memoryUsage()
  return {
    busy: reasons.length > 0,
    reasons,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal
    }
  }
}
