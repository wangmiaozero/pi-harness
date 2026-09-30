export const DEFAULT_USER_NAME = '我'
export const DEFAULT_ASSISTANT_NAME = '助手'
export const CHAT_PARTICIPANT_NAME_MAX_LENGTH = 32

function normalizeParticipantName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().slice(0, CHAT_PARTICIPANT_NAME_MAX_LENGTH)
  return normalized || fallback
}

export function normalizeUserName(value: unknown): string {
  return normalizeParticipantName(value, DEFAULT_USER_NAME)
}

export function normalizeAssistantName(value: unknown): string {
  return normalizeParticipantName(value, DEFAULT_ASSISTANT_NAME)
}
