import type { VoiceSettings } from '@shared/agent-settings/schema'
import { downsample24to16 } from './voice-protocol'

// JSON event protocol for the Doubao realtime speech model 3.0 (Seeduplex).
// Source: 资料/字节火山/字节火山-端到端实时语音大模型-端到端实时语音（Seeduplex）.md.
// Everything travels as JSON text frames over one WebSocket — no binary framing,
// no gzip, no interleaved session ids (that was the pre-3.0 protocol). Kept as a
// table so any future protocol drift is a one-place change.
export const DOUBAO_PROTOCOL = {
  url: 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue',
  // 3.0 is a fixed-model product; the settings form's model field is advisory only.
  model: '1.2.6.1',
  // Legacy console auth only; the new console authenticates with X-Api-Key alone.
  resourceValue: 'volc.speech.dialog',
  gatewayKeyValue: 'PlgvMymc7f3tQnJ6',
  defaultVoice: 'zh_female_vv_jupiter_bigtts',
  client: {
    sessionCreate: 'session.create',
    sessionClose: 'session.close',
    audioAppend: 'input_audio_buffer.append',
    mute: 'input_audio_mute.commit',
    unmute: 'input_audio_unmute.commit',
    responseCancel: 'response.cancel'
  },
  server: {
    sessionCreated: 'session.created',
    sessionClosed: 'session.closed',
    asrStarted: 'conversation.item.input_audio_transcription.started',
    asrDelta: 'conversation.item.input_audio_transcription.delta',
    asrCompleted: 'conversation.item.input_audio_transcription.completed',
    asrFailed: 'conversation.item.input_audio_transcription.failed',
    textDelta: 'response.output_text.delta',
    textDone: 'response.output_text.done',
    audioDelta: 'response.output_audio.delta',
    audioDone: 'response.output_audio.done',
    functionCall: 'response.function_call_arguments.done',
    responseDone: 'response.done',
    responseCanceled: 'response.canceled',
    error: 'error'
  }
} as const

// Two auth shapes against the same duplex endpoint:
// - 'apiKey' (new console): a single secret from console > API Key management,
//   sent as X-Api-Key — the only auth header the Seeduplex docs mention.
// - 'app' (legacy console): AppID + Access Token as the four X-Api-* headers of
//   the previous protocol generation. The docs still accept it for now.
export type DoubaoCredentials =
  { kind: 'apiKey'; apiKey: string } | { kind: 'app'; appId: string; accessToken: string }

const safeSecret = (value: unknown): string =>
  typeof value === 'string' && value.length <= 4096 && !/[\r\n\0]/.test(value) ? value : ''

// The credential secret stores a JSON payload assembled by the settings UI:
// either { apiKey } or { appId, accessToken }.
export function parseDoubaoCredentials(raw: string): DoubaoCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  const { apiKey, appId, accessToken } = (parsed ?? {}) as Record<string, unknown>
  const key = safeSecret(apiKey)
  const token = safeSecret(accessToken)
  if (key) {
    if (appId != null || accessToken != null)
      throw new Error('Use either an API key or an App ID + Access Token pair')
    return { kind: 'apiKey', apiKey: key }
  }
  if (typeof appId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(appId) || !token)
    throw new Error('Invalid Doubao credentials')
  return { kind: 'app', appId, accessToken: token }
}

export function doubaoHeaders(credentials: DoubaoCredentials): Record<string, string> {
  if (credentials.kind === 'apiKey') return { 'X-Api-Key': credentials.apiKey }
  return {
    'X-Api-App-ID': credentials.appId,
    'X-Api-Access-Key': credentials.accessToken,
    'X-Api-App-Key': DOUBAO_PROTOCOL.gatewayKeyValue,
    'X-Api-Resource-Id': DOUBAO_PROTOCOL.resourceValue
  }
}

export interface DoubaoEvent {
  type?: unknown
  [key: string]: unknown
}

// session.create payload per the Seeduplex doc. instructions carries the voice
// prompt plus injected conversation context; the 3.0 budget is 64K tokens so a
// 30000-char cut is generous headroom while still bounding pathological prompts.
// TTS is pinned to pcm_s16le @24 kHz because the renderer plays int16
// little-endian and the API default would be OGG/Opus.
export function doubaoSetup(settings: VoiceSettings, instructions: string): { payload: string } {
  const speaker = settings.voice.trim() || DOUBAO_PROTOCOL.defaultVoice
  return {
    payload: JSON.stringify({
      type: DOUBAO_PROTOCOL.client.sessionCreate,
      session: {
        model: DOUBAO_PROTOCOL.model,
        instructions: instructions.slice(0, 30000),
        audio: {
          input: { format: { type: 'pcm', rate: 16000 } },
          output: { format: { type: 'pcm_s16le', rate: 24000 }, voice: speaker }
        }
      }
    })
  }
}

// Mic audio: renderer captures 24 kHz PCM; the API takes 16 kHz PCM base64 in a
// JSON text frame (the doc suggests ~20 ms / 640 B chunks; the renderer emits
// ~85 ms chunks, well within limits).
export function doubaoAudioEvent(pcm24k: Buffer, carry: { remainder: Buffer }): string {
  return JSON.stringify({
    type: DOUBAO_PROTOCOL.client.audioAppend,
    audio: downsample24to16(pcm24k, carry).toString('base64')
  })
}

// Mute is an explicit event pair in 3.0: the model relies on the upstream audio
// stream for keep-alive, so a silenced mic must announce itself or the session
// times out (input_audio_mute.commit / input_audio_unmute.commit).
export const doubaoMuteEvent = (muted: boolean): string =>
  JSON.stringify({ type: muted ? DOUBAO_PROTOCOL.client.mute : DOUBAO_PROTOCOL.client.unmute })

// Client-side barge-in confirmation for an in-flight response.
export const doubaoCancelEvent = (): string =>
  JSON.stringify({ type: DOUBAO_PROTOCOL.client.responseCancel })

export const doubaoCloseEvent = (): string =>
  JSON.stringify({ type: DOUBAO_PROTOCOL.client.sessionClose })

export type DoubaoIncoming =
  | { kind: 'ready'; sessionId?: string }
  | { kind: 'interrupt' }
  | { kind: 'asr'; text: string }
  | { kind: 'asrEnded'; text: string }
  | { kind: 'assistantDelta'; text: string }
  | { kind: 'assistantDone'; text: string }
  | { kind: 'audio'; data: string }
  | { kind: 'ended' }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' }

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

// Normalizes every documented downstream event into the shapes the service reacts
// to; unknown or irrelevant events (context acks, usage, FC echoes, cancellations)
// collapse into `ignore`. ASR `started` doubles as the interruption signal — the
// server barge-in fires on the first recognized syllable, mirroring OpenAI
// speech_started / Gemini interrupted. ASR failures stay non-fatal: recognition
// hiccups must not tear down an otherwise healthy call.
export function mapDoubaoEvent(event: DoubaoEvent): DoubaoIncoming {
  switch (event?.type) {
    case DOUBAO_PROTOCOL.server.sessionCreated: {
      const id = (event.session as DoubaoEvent | undefined)?.id
      return { kind: 'ready', sessionId: typeof id === 'string' && id ? id : undefined }
    }
    case DOUBAO_PROTOCOL.server.asrStarted:
      return { kind: 'interrupt' }
    case DOUBAO_PROTOCOL.server.asrDelta: {
      const delta = text(event.delta)
      return delta ? { kind: 'asr', text: delta } : { kind: 'ignore' }
    }
    case DOUBAO_PROTOCOL.server.asrCompleted:
      return { kind: 'asrEnded', text: text(event.transcript) }
    case DOUBAO_PROTOCOL.server.textDelta: {
      const delta = text(event.delta)
      return delta ? { kind: 'assistantDelta', text: delta } : { kind: 'ignore' }
    }
    case DOUBAO_PROTOCOL.server.textDone:
      return { kind: 'assistantDone', text: text(event.text) }
    case DOUBAO_PROTOCOL.server.audioDelta: {
      const data = text(event.delta)
      return data ? { kind: 'audio', data } : { kind: 'ignore' }
    }
    case DOUBAO_PROTOCOL.server.sessionClosed:
      return { kind: 'ended' }
    case DOUBAO_PROTOCOL.server.error: {
      const err = event.error as DoubaoEvent | undefined
      const message = text(err?.message) || text(event.message) || 'Doubao reported an error.'
      return { kind: 'error', message }
    }
    default:
      return { kind: 'ignore' }
  }
}
