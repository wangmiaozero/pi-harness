import { gzipSync, gunzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import type { VoiceSettings } from '@shared/agent-settings/schema'
import { downsample24to16 } from './voice-protocol'

// Binary framing for the Volcano Engine end-to-end realtime speech LLM API.
// Constants follow the official document 《端到端实时语音大模型API》 (rev 26.04.29),
// local copy: 资料/豆包ASR/端到端实时语音大模型API.md. All multi-byte integers are
// big-endian. Kept as a table so any future protocol drift is a one-place change.
export const DOUBAO_PROTOCOL = {
  url: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
  resourceValue: 'volc.speech.dialog',
  gatewayKeyValue: 'PlgvMymc7f3tQnJ6',
  // version 0b0001 << 4 | header size 0b0001
  header: 0x11,
  msgType: {
    fullClientRequest: 0b0001,
    audioOnlyRequest: 0b0010,
    fullServerResponse: 0b1001,
    audioOnlyResponse: 0b1011,
    error: 0b1111
  },
  flag: {
    none: 0b0000,
    sequencePositive: 0b0001,
    sequenceLast: 0b0011,
    event: 0b0100,
    error: 0b1111
  },
  serialization: { raw: 0b0000, json: 0b0001 },
  compression: { none: 0b0000, gzip: 0b0001 },
  client: {
    startConnection: 1,
    finishConnection: 2,
    startSession: 100,
    finishSession: 102,
    taskRequest: 200
  },
  server: {
    connectionStarted: 50,
    connectionFailed: 51,
    connectionFinished: 52,
    sessionStarted: 150,
    sessionFinished: 152,
    sessionFailed: 153,
    ttsSentenceStart: 350,
    ttsSentenceEnd: 351,
    ttsResponse: 352,
    ttsEnded: 359,
    asrInfo: 450,
    asrResponse: 451,
    asrEnded: 459,
    chatResponse: 550,
    chatEnded: 559,
    dialogCommonError: 599
  }
} as const

// Session-scoped events interleave `session id size + session id` between the
// event field and the payload size field (doc §2.2); connect-scoped ones do not.
// Covers both directions: client StartSession/FinishSession/TaskRequest carry it,
// as do all session-level server events.
const SESSION_EVENTS = new Set<number>([
  DOUBAO_PROTOCOL.client.startSession,
  DOUBAO_PROTOCOL.client.finishSession,
  DOUBAO_PROTOCOL.client.taskRequest,
  DOUBAO_PROTOCOL.server.sessionStarted,
  DOUBAO_PROTOCOL.server.sessionFinished,
  DOUBAO_PROTOCOL.server.sessionFailed,
  DOUBAO_PROTOCOL.server.ttsSentenceStart,
  DOUBAO_PROTOCOL.server.ttsSentenceEnd,
  DOUBAO_PROTOCOL.server.ttsResponse,
  DOUBAO_PROTOCOL.server.ttsEnded,
  DOUBAO_PROTOCOL.server.asrInfo,
  DOUBAO_PROTOCOL.server.asrResponse,
  DOUBAO_PROTOCOL.server.asrEnded,
  DOUBAO_PROTOCOL.server.chatResponse,
  DOUBAO_PROTOCOL.server.chatEnded,
  DOUBAO_PROTOCOL.server.dialogCommonError
])

export interface DoubaoCredentials {
  appId: string
  accessToken: string
}

// The credential secret stores a JSON pair assembled by the settings UI.
export function parseDoubaoCredentials(raw: string): DoubaoCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  const { appId, accessToken } = (parsed ?? {}) as Record<string, unknown>
  const token = typeof accessToken === 'string' ? accessToken : ''
  if (
    typeof appId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(appId) ||
    !token ||
    token.length > 4096 ||
    /[\r\n\0]/.test(token)
  )
    throw new Error('Invalid Doubao credentials')
  return { appId, accessToken: token }
}

export function doubaoHeaders(credentials: DoubaoCredentials): Record<string, string> {
  return {
    'X-Api-App-ID': credentials.appId,
    'X-Api-Access-Key': credentials.accessToken,
    'X-Api-Resource-Id': DOUBAO_PROTOCOL.resourceValue,
    'X-Api-App-Key': DOUBAO_PROTOCOL.gatewayKeyValue,
    'X-Api-Connect-Id': randomUUID()
  }
}

export interface DoubaoFrameInput {
  msgType: number
  event?: number
  payload?: string | Buffer
  sessionId?: string
  raw?: boolean
  gzip?: boolean
  code?: number
}

// Frames: header(4) → [code] → [sequence] → [event] → [connect id] → [session id]
// → payload size(4) → payload. The client only ever emits the event flag.
export function encodeDoubaoFrame(input: DoubaoFrameInput): Buffer {
  const payload =
    input.payload == null
      ? Buffer.alloc(0)
      : Buffer.isBuffer(input.payload)
        ? input.payload
        : Buffer.from(input.payload, 'utf8')
  const body = input.gzip ? gzipSync(payload) : payload
  let flags = DOUBAO_PROTOCOL.flag.none
  if (input.event != null) flags |= DOUBAO_PROTOCOL.flag.event
  if (input.code != null) flags |= DOUBAO_PROTOCOL.flag.error
  const parts: Buffer[] = [
    Buffer.from([
      DOUBAO_PROTOCOL.header,
      (input.msgType << 4) | flags,
      ((input.raw ? DOUBAO_PROTOCOL.serialization.raw : DOUBAO_PROTOCOL.serialization.json) << 4) |
        (input.gzip ? DOUBAO_PROTOCOL.compression.gzip : DOUBAO_PROTOCOL.compression.none),
      0
    ])
  ]
  if (input.code != null) {
    const code = Buffer.alloc(4)
    code.writeUInt32BE(input.code)
    parts.push(code)
  }
  if (input.event != null) {
    const event = Buffer.alloc(4)
    event.writeUInt32BE(input.event)
    parts.push(event)
  }
  if (input.sessionId != null) {
    const id = Buffer.from(input.sessionId, 'utf8')
    const size = Buffer.alloc(4)
    size.writeUInt32BE(id.length)
    parts.push(size, id)
  }
  const size = Buffer.alloc(4)
  size.writeUInt32BE(body.length)
  parts.push(size, body)
  return Buffer.concat(parts)
}

export function encodeDoubaoEvent(event: number, payload: string, sessionId?: string): Buffer {
  return encodeDoubaoFrame({
    msgType: DOUBAO_PROTOCOL.msgType.fullClientRequest,
    event,
    payload,
    sessionId
  })
}

// Mic audio: renderer captures 24 kHz PCM; the API wants 16 kHz PCM inside a
// TaskRequest event frame (session-scoped, so the session id rides along).
export function doubaoAudioFrame(
  pcm24k: Buffer,
  carry: { remainder: Buffer },
  sessionId: string
): Buffer {
  return encodeDoubaoFrame({
    msgType: DOUBAO_PROTOCOL.msgType.audioOnlyRequest,
    event: DOUBAO_PROTOCOL.client.taskRequest,
    payload: downsample24to16(pcm24k, carry),
    sessionId,
    raw: true
  })
}

export interface DoubaoFrame {
  msgType: number
  flags: number
  serialization: number
  compression: number
  code: number | null
  event: number | null
  sessionId: string | null
  payload: Buffer
}

export function decodeDoubaoFrame(data: Buffer): DoubaoFrame {
  if (data.length < 4 || data[0] !== DOUBAO_PROTOCOL.header) throw new Error('Invalid Doubao frame')
  const msgType = data[1] >> 4
  const flags = data[1] & 0b1111
  const serialization = data[2] >> 4
  const compression = data[2] & 0b1111
  let offset = 4
  let code: number | null = null
  if (flags === DOUBAO_PROTOCOL.flag.error) {
    if (data.length < offset + 4) throw new Error('Truncated Doubao frame')
    code = data.readUInt32BE(offset)
    offset += 4
  } else if (
    flags === DOUBAO_PROTOCOL.flag.sequencePositive ||
    flags === DOUBAO_PROTOCOL.flag.sequenceLast
  ) {
    if (data.length < offset + 4) throw new Error('Truncated Doubao frame')
    offset += 4
  }
  let event: number | null = null
  if (flags === DOUBAO_PROTOCOL.flag.event) {
    if (data.length < offset + 4) throw new Error('Truncated Doubao frame')
    event = data.readUInt32BE(offset)
    offset += 4
  }
  let sessionId: string | null = null
  if (event != null && SESSION_EVENTS.has(event)) {
    if (data.length < offset + 4) throw new Error('Truncated Doubao frame')
    const idLength = data.readUInt32BE(offset)
    offset += 4
    if (idLength > 512 || data.length < offset + idLength) throw new Error('Truncated Doubao frame')
    sessionId = data.subarray(offset, offset + idLength).toString('utf8')
    offset += idLength
  }
  if (data.length < offset + 4) throw new Error('Truncated Doubao frame')
  const payloadSize = data.readUInt32BE(offset)
  offset += 4
  if (payloadSize > data.length - offset) throw new Error('Truncated Doubao frame')
  const payload = data.subarray(offset, offset + payloadSize)
  return {
    msgType,
    flags,
    serialization,
    compression,
    code,
    event,
    sessionId,
    payload:
      compression === DOUBAO_PROTOCOL.compression.gzip ? gunzipSync(payload) : Buffer.from(payload)
  }
}

export type DoubaoIncoming =
  | { kind: 'connected' }
  | { kind: 'ready' }
  | { kind: 'interrupt' }
  | { kind: 'asr'; text: string; final: boolean }
  | { kind: 'asrEnded' }
  | { kind: 'assistantText'; text: string }
  | { kind: 'audio'; data: Buffer }
  | { kind: 'ended' }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' }

function parsePayloadJson(payload: Buffer): Record<string, any> | null {
  try {
    const parsed = JSON.parse(payload.toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

// Normalizes every documented server event into the shapes the service reacts to;
// unknown or irrelevant events collapse into `ignore`.
export function mapDoubaoFrame(frame: DoubaoFrame): DoubaoIncoming {
  if (frame.msgType === DOUBAO_PROTOCOL.msgType.error) {
    const json = parsePayloadJson(frame.payload)
    return {
      kind: 'error',
      message:
        typeof json?.error === 'string' && json.error
          ? json.error
          : `Doubao error ${frame.code ?? ''}`.trim()
    }
  }
  if (frame.msgType === DOUBAO_PROTOCOL.msgType.audioOnlyResponse) {
    return frame.event === DOUBAO_PROTOCOL.server.ttsResponse
      ? { kind: 'audio', data: frame.payload }
      : { kind: 'ignore' }
  }
  if (frame.msgType !== DOUBAO_PROTOCOL.msgType.fullServerResponse || frame.event == null)
    return { kind: 'ignore' }
  switch (frame.event) {
    case DOUBAO_PROTOCOL.server.connectionStarted:
      return { kind: 'connected' }
    case DOUBAO_PROTOCOL.server.sessionStarted:
      return { kind: 'ready' }
    // First syllable detected — mirrors OpenAI speech_started / Gemini interrupted.
    case DOUBAO_PROTOCOL.server.asrInfo:
      return { kind: 'interrupt' }
    case DOUBAO_PROTOCOL.server.asrResponse: {
      const json = parsePayloadJson(frame.payload)
      const results = Array.isArray(json?.results) ? json.results : []
      const text = results
        .map((r: any) => (typeof r?.text === 'string' ? r.text : ''))
        .join('')
        .trim()
      // Interim results overwrite each other; a final flag marks the settled text.
      return text
        ? { kind: 'asr', text, final: results.some((r: any) => r?.is_interim === false) }
        : { kind: 'ignore' }
    }
    case DOUBAO_PROTOCOL.server.asrEnded:
      return { kind: 'asrEnded' }
    case DOUBAO_PROTOCOL.server.ttsSentenceStart: {
      const json = parsePayloadJson(frame.payload)
      return typeof json?.text === 'string' && json.text
        ? { kind: 'assistantText', text: json.text }
        : { kind: 'ignore' }
    }
    case DOUBAO_PROTOCOL.server.sessionFinished:
    case DOUBAO_PROTOCOL.server.connectionFinished:
      return { kind: 'ended' }
    case DOUBAO_PROTOCOL.server.connectionFailed:
    case DOUBAO_PROTOCOL.server.sessionFailed:
    case DOUBAO_PROTOCOL.server.dialogCommonError: {
      const json = parsePayloadJson(frame.payload)
      return {
        kind: 'error',
        message:
          (typeof json?.message === 'string' && json.message) ||
          (typeof json?.error === 'string' && json.error) ||
          'Doubao ended the call unexpectedly.'
      }
    }
    default:
      return { kind: 'ignore' }
  }
}

// StartSession payload. model/voice are the end-to-end version and timbre ids from
// the settings form; keep_alive input tolerates the renderer's mute button; TTS is
// pinned to pcm_s16le @24 kHz because the renderer plays int16 little-endian and
// the API default would be OGG/Opus (`"pcm"` alone means 32-bit).
export function doubaoSetup(settings: VoiceSettings, instructions: string): { payload: string } {
  const model = settings.model.trim() || '1.2.1.1'
  const speaker = settings.voice.trim() || 'zh_female_vv_jupiter_bigtts'
  return {
    payload: JSON.stringify({
      dialog: {
        bot_name: 'Pi',
        // Prompt budget is 4000 chars on the O series; instructions lead so the
        // shared-context tail is what gets truncated, never the safety rules.
        system_role: instructions.slice(0, 4000),
        extra: { input_mod: 'keep_alive', model }
      },
      tts: { speaker, audio_config: { format: 'pcm_s16le', sample_rate: 24000, channel: 1 } }
    })
  }
}
