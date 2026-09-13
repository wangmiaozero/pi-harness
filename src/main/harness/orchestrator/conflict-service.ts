/**
 * Conflict Service.
 *
 * Detects merge risk between parallel agents: the same file modified by more
 * than one agent's runs. Detection only — the harness surfaces the risk and
 * the user decides; nothing merges automatically.
 */

import type { HarnessArtifact } from '@shared/types/harness'
import type { HarnessConflictFile, HarnessConflictReport } from '@shared/types/harness'

export class ConflictService {
  /**
   * Group file artifacts by path and flag paths touched by more than one
   * agent. Missing paths (command logs etc.) cannot conflict and are ignored.
   */
  detect(orchestrationId: string, artifacts: readonly HarnessArtifact[]): HarnessConflictReport {
    const pathAgentTasks = new Map<string, Map<string, Set<string>>>()

    for (const artifact of artifacts) {
      if (!artifact.path || artifact.type !== 'file') continue
      if (!artifact.producedByAgentId) continue
      let agents = pathAgentTasks.get(artifact.path)
      if (!agents) {
        agents = new Map()
        pathAgentTasks.set(artifact.path, agents)
      }
      const tasks = agents.get(artifact.producedByAgentId) ?? new Set<string>()
      if (artifact.producedByTaskId) tasks.add(artifact.producedByTaskId)
      agents.set(artifact.producedByAgentId, tasks)
    }

    const conflicts: HarnessConflictFile[] = []
    for (const [path, agents] of pathAgentTasks) {
      if (agents.size < 2) continue
      conflicts.push({
        path,
        agentIds: [...agents.keys()],
        taskIds: [...new Set([...agents.values()].flatMap((tasks) => [...tasks]))]
      })
    }

    conflicts.sort((a, b) => a.path.localeCompare(b.path))
    return {
      orchestrationId,
      detectedAt: Date.now(),
      conflicts
    }
  }
}
