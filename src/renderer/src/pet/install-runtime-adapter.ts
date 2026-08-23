import { watch, type WatchStopHandle } from 'vue'
import { getApi } from '@renderer/composables/useApi'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'
import { useAgentStore } from '@renderer/stores/agent'
import { usePetStore } from '@renderer/stores/pet'
import { useSessionStore } from '@renderer/stores/sessions'
import { useSettingsStore } from '@renderer/stores/settings'
import { adaptAgentEventToPetEvents } from '@shared/pet/runtime-adapter'
import type { AgentEvent } from '@shared/types/workspace'

const ACTIVITY_THROTTLE_MS = 500

export function installPetRuntimeAdapter(): () => void {
  const pet = usePetStore()
  const agent = useAgentStore()
  const sessions = useSessionStore()
  const settings = useSettingsStore()
  const confirm = useConfirmDialog()
  const stops: WatchStopHandle[] = []
  let lastActivityAt = 0

  const unsubscribeAgent = getApi().on('agent-event', (payload) => {
    const body = payload as { sessionId?: string; event?: AgentEvent }
    if (!body.event || (sessions.currentId && body.sessionId !== sessions.currentId)) return
    for (const event of adaptAgentEventToPetEvents(body.event)) pet.handleEvent(event)
  })

  stops.push(
    watch(
      () =>
        [
          agent.sending,
          agent.streaming.isStreaming,
          agent.state?.isPromptRunning,
          agent.runningIds.includes(sessions.currentId ?? ''),
          agent.error,
          sessions.currentId
        ] as const,
      ([sending, streaming, promptRunning, listedRunning, error, sessionId]) => {
        pet.syncRuntime({
          running: Boolean(sending || streaming || promptRunning || listedRunning),
          streaming: Boolean(streaming),
          activeSession: Boolean(sessionId),
          hasError: Boolean(error)
        })
      },
      { immediate: true }
    ),
    watch(
      () => sessions.currentId,
      (current, previous) => {
        if (current && current !== previous) pet.handleEvent({ type: 'SESSION_CREATED' })
      }
    ),
    watch(
      () => confirm.state.open,
      (waiting) => pet.handleEvent({ type: 'WAITING_FOR_USER', waiting }),
      { immediate: true }
    ),
    watch(
      () => [settings.settings?.petAutoSleep, settings.settings?.petSleepMinutes] as const,
      ([enabled, minutes]) => pet.configureSleep(enabled ?? true, (minutes ?? 10) * 60_000),
      { immediate: true }
    )
  )

  const reportActivity = () => {
    const now = Date.now()
    if (now - lastActivityAt < ACTIVITY_THROTTLE_MS) return
    lastActivityAt = now
    pet.handleEvent({ type: 'USER_ACTIVITY', at: now })
  }
  const reportVisibility = () => {
    if (document.visibilityState === 'visible') reportActivity()
  }

  window.addEventListener('pointerdown', reportActivity, { passive: true })
  window.addEventListener('keydown', reportActivity)
  window.addEventListener('focus', reportActivity)
  document.addEventListener('visibilitychange', reportVisibility)

  return () => {
    unsubscribeAgent()
    stops.forEach((stop) => stop())
    window.removeEventListener('pointerdown', reportActivity)
    window.removeEventListener('keydown', reportActivity)
    window.removeEventListener('focus', reportActivity)
    document.removeEventListener('visibilitychange', reportVisibility)
    pet.dispose()
  }
}
