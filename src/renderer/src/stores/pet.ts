import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { createPetStateContext, PET_SLEEP_TIMEOUT_MS, resolvePetState } from '@shared/pet/resolver'
import { isCodingTool } from '@shared/pet/tool-detector'
import type {
  PetDebugSnapshot,
  PetEvent,
  PetState,
  PetStateContext,
  TemporaryPetState
} from '@shared/pet/types'

export const PET_SUCCESS_DURATION_MS = 1800
export const PET_JUMP_DURATION_MS = 1500
export const PET_WAVE_DURATION_MS = 1500

interface ActiveTool {
  id: string
  name: string
  coding: boolean
}

interface TemporaryStep {
  state: TemporaryPetState
  durationMs: number
}

export const usePetStore = defineStore('pet', () => {
  const context = reactive<PetStateContext>(createPetStateContext())
  const state = ref<PetState>('idle')
  const previousState = ref<PetState | null>(null)
  const temporaryState = ref<TemporaryPetState | null>(null)
  const lastChangedAt = ref(Date.now())
  const currentTool = ref<string | null>(null)
  const activeTools = new Map<string, ActiveTool>()
  let temporaryTimer: ReturnType<typeof setTimeout> | null = null
  let warningTimer: ReturnType<typeof setTimeout> | null = null
  let sleepTimer: ReturnType<typeof setTimeout> | null = null
  let temporaryGeneration = 0

  const resolvedState = computed(() => resolvePetState(context))
  const debugSnapshot = computed<PetDebugSnapshot>(() => ({
    currentState: state.value,
    previousState: previousState.value,
    temporaryState: temporaryState.value,
    resolvedState: resolvedState.value,
    currentTool: currentTool.value,
    context: { ...context }
  }))

  function setState(next: PetState): void {
    if (state.value === next) return
    previousState.value = state.value
    state.value = next
    lastChangedAt.value = Date.now()
  }

  function resolveState(now = Date.now()): PetState {
    context.now = now
    const resolved = resolvePetState(context)
    if (!temporaryState.value) setState(resolved)
    scheduleSleepTimer(now, resolved)
    return resolved
  }

  function setTemporaryState(next: TemporaryPetState, durationMs: number): void {
    runTemporarySequence([{ state: next, durationMs }])
  }

  function runTemporarySequence(steps: TemporaryStep[]): void {
    clearTemporaryTimer()
    const generation = ++temporaryGeneration
    const run = (index: number) => {
      if (generation !== temporaryGeneration) return
      const step = steps[index]
      if (!step) {
        temporaryState.value = null
        resolveState()
        return
      }
      temporaryState.value = step.state
      setState(step.state)
      temporaryTimer = setTimeout(() => run(index + 1), Math.max(0, step.durationMs))
    }
    run(0)
  }

  function clearTemporaryState(): void {
    temporaryGeneration += 1
    clearTemporaryTimer()
    temporaryState.value = null
    resolveState()
  }

  function updateActivity(at = Date.now(), wakeWithWave = true): void {
    const wasSleeping = resolvedState.value === 'sleeping' || state.value === 'sleeping'
    context.lastActivityAt = at
    context.now = at
    resolveState(at)
    if (wasSleeping && wakeWithWave && !isRuntimeBusy()) {
      setTemporaryState('waving', PET_WAVE_DURATION_MS)
    }
  }

  function configureSleep(enabled: boolean, timeoutMs = PET_SLEEP_TIMEOUT_MS): void {
    context.sleepEnabled = enabled
    context.sleepTimeoutMs = Math.max(1000, timeoutMs)
    resolveState()
  }

  function syncRuntime(
    patch: Partial<
      Pick<
        PetStateContext,
        'running' | 'streaming' | 'thinking' | 'waitingForUser' | 'activeSession' | 'hasError'
      >
    >,
    at = Date.now()
  ): void {
    Object.assign(context, patch)
    context.now = at
    if (patch.running || patch.streaming || patch.thinking) context.lastActivityAt = at
    resolveState(at)
  }

  function handleEvent(event: PetEvent): void {
    const at = event.at ?? Date.now()
    context.now = at
    if (event.type !== 'USER_ACTIVITY') context.lastActivityAt = at
    switch (event.type) {
      case 'USER_ACTIVITY':
        updateActivity(at, true)
        return
      case 'SESSION_CREATED':
        resetSessionContext()
        context.activeSession = true
        updateActivity(at, false)
        setTemporaryState('waving', PET_WAVE_DURATION_MS)
        return
      case 'TASK_STARTED':
        clearTemporaryStateWithoutResolve()
        clearWarning()
        activeTools.clear()
        recomputeTools()
        context.hasError = false
        context.waitingForUser = false
        context.taskCompleted = false
        context.taskSucceeded = false
        context.running = true
        context.streaming = false
        context.thinking = false
        resolveState(at)
        return
      case 'THINKING_STARTED':
        clearWarning()
        context.thinking = true
        context.running = true
        context.streaming = true
        resolveState(at)
        return
      case 'THINKING_FINISHED':
        context.thinking = false
        resolveState(at)
        return
      case 'STREAM_STARTED':
        clearWarning()
        context.thinking = false
        context.streaming = true
        context.running = true
        resolveState(at)
        return
      case 'STREAM_FINISHED':
        context.streaming = false
        resolveState(at)
        return
      case 'TOOL_CALL_STARTED':
        clearWarning()
        activeTools.set(event.id, {
          id: event.id,
          name: event.tool,
          coding: isCodingTool(event.tool)
        })
        context.running = true
        context.thinking = false
        recomputeTools()
        resolveState(at)
        return
      case 'TOOL_CALL_FINISHED':
        activeTools.delete(event.id)
        recomputeTools()
        if (event.failed) {
          clearTemporaryStateWithoutResolve()
          context.hasError = true
          context.running = false
          context.streaming = false
          context.thinking = false
        }
        resolveState(at)
        return
      case 'WAITING_FOR_USER':
        context.waitingForUser = event.waiting
        resolveState(at)
        return
      case 'TASK_SUCCEEDED':
        if (context.hasError) {
          resolveState(at)
          return
        }
        finishRuntimeTask(true)
        runTemporarySequence(
          event.celebrate === false
            ? [{ state: 'success', durationMs: PET_SUCCESS_DURATION_MS }]
            : [
                { state: 'success', durationMs: PET_SUCCESS_DURATION_MS },
                { state: 'jumping', durationMs: PET_JUMP_DURATION_MS }
              ]
        )
        return
      case 'TASK_FAILED':
        clearTemporaryStateWithoutResolve()
        finishRuntimeTask(false)
        context.hasError = true
        resolveState(at)
        return
      case 'RUNTIME_SETTLED':
        activeTools.clear()
        recomputeTools()
        context.running = false
        context.streaming = false
        context.thinking = false
        resolveState(at)
        return
      case 'WARNING':
        setWarning(event.durationMs ?? 4000)
        resolveState(at)
        return
      case 'WARNING_CLEARED':
        clearWarning()
        resolveState(at)
        return
    }
  }

  function dispose(): void {
    temporaryGeneration += 1
    clearTemporaryTimer()
    if (warningTimer) clearTimeout(warningTimer)
    if (sleepTimer) clearTimeout(sleepTimer)
    warningTimer = null
    sleepTimer = null
    activeTools.clear()
  }

  function finishRuntimeTask(succeeded: boolean): void {
    activeTools.clear()
    recomputeTools()
    context.running = false
    context.streaming = false
    context.thinking = false
    context.waitingForUser = false
    context.taskCompleted = true
    context.taskSucceeded = succeeded
  }

  function resetSessionContext(): void {
    activeTools.clear()
    recomputeTools()
    context.hasError = false
    context.hasWarning = false
    context.waitingForUser = false
    context.taskCompleted = false
    context.taskSucceeded = false
  }

  function recomputeTools(): void {
    const tools = [...activeTools.values()]
    const codingTool = [...tools].reverse().find((tool) => tool.coding)
    const selected = codingTool ?? tools.at(-1) ?? null
    currentTool.value = selected?.name ?? null
    context.coding = Boolean(codingTool)
    context.toolCalling = !codingTool && tools.length > 0
  }

  function setWarning(durationMs: number): void {
    if (warningTimer) clearTimeout(warningTimer)
    context.hasWarning = true
    warningTimer = setTimeout(
      () => {
        warningTimer = null
        context.hasWarning = false
        resolveState()
      },
      Math.max(0, durationMs)
    )
  }

  function clearWarning(): void {
    if (warningTimer) clearTimeout(warningTimer)
    warningTimer = null
    context.hasWarning = false
  }

  function clearTemporaryTimer(): void {
    if (temporaryTimer) clearTimeout(temporaryTimer)
    temporaryTimer = null
  }

  function clearTemporaryStateWithoutResolve(): void {
    temporaryGeneration += 1
    clearTemporaryTimer()
    temporaryState.value = null
  }

  function isRuntimeBusy(): boolean {
    return Boolean(
      context.running ||
      context.streaming ||
      context.thinking ||
      context.toolCalling ||
      context.coding
    )
  }

  function scheduleSleepTimer(now: number, resolved: PetState): void {
    if (sleepTimer) clearTimeout(sleepTimer)
    sleepTimer = null
    if (!context.sleepEnabled || resolved !== 'idle' || isRuntimeBusy()) return
    const remaining = context.sleepTimeoutMs - (now - context.lastActivityAt)
    if (remaining <= 0) return
    sleepTimer = setTimeout(() => {
      sleepTimer = null
      resolveState()
    }, remaining)
  }

  resolveState()

  return {
    state,
    previousState,
    temporaryState,
    resolvedState,
    lastChangedAt,
    lastActivityAt: computed(() => context.lastActivityAt),
    currentTool,
    context,
    debugSnapshot,
    setState,
    resolveState,
    setTemporaryState,
    clearTemporaryState,
    updateActivity,
    configureSleep,
    syncRuntime,
    handleEvent,
    dispose
  }
})
