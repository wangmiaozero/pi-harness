/** Native Pi SDK boundary. Runtime imports stay lazy and in Main. */
import type { AgentSession, SessionManager, SessionInfo } from '@earendil-works/pi-coding-agent'

export type AgentSessionLike = AgentSession
export type PiSessionManagerLike = SessionManager
export type PiSessionInfoLike = Pick<
  SessionInfo,
  | 'path'
  | 'id'
  | 'cwd'
  | 'name'
  | 'created'
  | 'modified'
  | 'messageCount'
  | 'firstMessage'
  | 'parentSessionPath'
>
export type PiModelLike = NonNullable<AgentSession['model']>
export type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent')

let cached: PiCodingAgentModule | null = null
let loading: Promise<PiCodingAgentModule> | null = null

export async function loadPiCodingAgent(): Promise<PiCodingAgentModule> {
  if (cached) return cached
  if (!loading) {
    loading = import('@earendil-works/pi-coding-agent')
      .then((sdk) => {
        cached = sdk
        return sdk
      })
      .finally(() => {
        loading = null
      })
  }
  return loading
}

export function peekPiCodingAgent(): PiCodingAgentModule | null {
  return cached
}
