import type { MascotStyle } from '../constants/mascot'

export const PET_STATES = [
  'idle',
  'thinking',
  'running',
  'coding',
  'tool-calling',
  'waiting',
  'review',
  'success',
  'failed',
  'warning',
  'waving',
  'jumping',
  'sleeping'
] as const

export type PetState = (typeof PET_STATES)[number]
export type TemporaryPetState = Extract<PetState, 'success' | 'waving' | 'jumping'>
export type PetThemeId = Exclude<MascotStyle, 'none'>

export interface PetStateContext {
  hasError: boolean
  hasWarning: boolean
  waitingForUser: boolean
  thinking: boolean
  running: boolean
  streaming: boolean
  toolCalling: boolean
  coding: boolean
  taskCompleted: boolean
  taskSucceeded: boolean
  activeSession: boolean
  lastActivityAt: number
  now: number
  sleepEnabled: boolean
  sleepTimeoutMs: number
}

export interface PetAnimation {
  row: number
  frames: number
  fps: number
  loop: boolean
}

export interface PetManifest {
  id: PetThemeId
  name: string
  sprite: string
  frameWidth: number
  frameHeight: number
  columns: number
  rows: number
  accent: string
  priority?: boolean
  animations: Partial<Record<PetState, PetAnimation>>
}

export type PetEvent =
  | { type: 'USER_ACTIVITY'; at?: number }
  | { type: 'SESSION_CREATED'; at?: number }
  | { type: 'TASK_STARTED'; at?: number }
  | { type: 'THINKING_STARTED'; at?: number }
  | { type: 'THINKING_FINISHED'; at?: number }
  | { type: 'STREAM_STARTED'; at?: number }
  | { type: 'STREAM_FINISHED'; at?: number }
  | { type: 'TOOL_CALL_STARTED'; id: string; tool: string; at?: number }
  | { type: 'TOOL_CALL_FINISHED'; id: string; failed?: boolean; at?: number }
  | { type: 'WAITING_FOR_USER'; waiting: boolean; at?: number }
  | { type: 'TASK_SUCCEEDED'; celebrate?: boolean; at?: number }
  | { type: 'TASK_FAILED'; at?: number }
  | { type: 'RUNTIME_SETTLED'; at?: number }
  | { type: 'WARNING'; durationMs?: number; at?: number }
  | { type: 'WARNING_CLEARED'; at?: number }

export interface PetDebugSnapshot {
  currentState: PetState
  previousState: PetState | null
  temporaryState: TemporaryPetState | null
  resolvedState: PetState
  currentTool: string | null
  context: PetStateContext
}
