import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AgentPermissionRequest } from '@shared/ipc/api-types'
import { normalizePermissionMode, type PermissionMode } from '@shared/workspace/permission-mode'
import { useSettingsStore } from './settings'
import { callApi, getApi } from '@renderer/composables/useApi'

/**
 * Tool-approval requests pushed from the desktop extension while an agent is
 * running, plus the per-session permission mode selected in the composer.
 */
export const usePermissionStore = defineStore('permission', () => {
  const pending = ref<AgentPermissionRequest[]>([])
  const modes = ref<Record<string, PermissionMode>>({})

  function requestsFor(sessionId: string | null): AgentPermissionRequest[] {
    return pending.value.filter((request) => request.sessionId === sessionId)
  }

  function modeFor(sessionId: string | null): PermissionMode {
    if (!sessionId || !(sessionId in modes.value)) {
      return normalizePermissionMode(useSettingsStore().settings?.defaultPermissionMode)
    }
    return modes.value[sessionId]
  }

  function setMode(sessionId: string | null, mode: PermissionMode): void {
    modes.value = { ...modes.value, [sessionId ?? '']: mode }
    if (sessionId) {
      void callApi(() => getApi().agent.setPermissionMode(sessionId, mode)).catch(() => undefined)
    }
  }

  function acceptRequest(request: AgentPermissionRequest): void {
    pending.value = pending.value.filter((item) => item.requestId !== request.requestId)
    void callApi(() =>
      getApi().agent.respondPermission(request.requestId, true)
    ).catch(() => undefined)
  }

  function declineRequest(request: AgentPermissionRequest): void {
    pending.value = pending.value.filter((item) => item.requestId !== request.requestId)
    void callApi(() =>
      getApi().agent.respondPermission(request.requestId, false)
    ).catch(() => undefined)
  }

  async function subscribe(): Promise<() => void> {
    return getApi().on('agent-permission', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const request = payload as Partial<AgentPermissionRequest>
      if (
        typeof request.requestId !== 'string' ||
        typeof request.sessionId !== 'string' ||
        typeof request.toolName !== 'string'
      ) {
        return
      }
      pending.value = [
        ...pending.value,
        {
          requestId: request.requestId,
          sessionId: request.sessionId,
          toolName: request.toolName,
          summary: typeof request.summary === 'string' ? request.summary : ''
        }
      ]
    })
  }

  // Subscribe once at store creation, mirroring the agent store's event wiring.
  void subscribe()

  return { pending, modes, requestsFor, modeFor, setMode, acceptRequest, declineRequest, subscribe }
})
