// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import type { JsonStore } from '../services/storage'
import type { VoiceEvent } from '@shared/agent-settings/schema'
const mocks = vi.hoisted(() => ({ open: vi.fn(), secret: vi.fn() }))
vi.mock('./socket', () => ({ openSocket: mocks.open }))
vi.mock('../security/secret-store', () => ({ secretStore: { getSecret: mocks.secret } }))
import { DEFAULT_VOICE, LiveVoiceService } from './voice-service'
import {
  DOUBAO_PROTOCOL,
  decodeDoubaoFrame,
  doubaoAudioFrame,
  doubaoSetup,
  encodeDoubaoEvent,
  encodeDoubaoFrame,
  mapDoubaoFrame,
  parseDoubaoCredentials
} from './voice-doubao'

const SESSION_ID = '75a6126e-427f-49a1-a2c1-621143cb9db3'

// Server-side frame builder used to feed the socket handler in tests.
const serverFrame = (
  event: number,
  payload: unknown,
  sessionId?: string,
  msgType = DOUBAO_PROTOCOL.msgType.fullServerResponse
) =>
  encodeDoubaoFrame({
    msgType,
    event,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    sessionId
  })

describe('Doubao binary protocol', () => {
  it('matches the documented StartConnection byte stream', () => {
    // Golden bytes straight from the API document §2.2 notes.
    expect(Array.from(encodeDoubaoEvent(DOUBAO_PROTOCOL.client.startConnection, '{}'))).toEqual([
      17, 20, 16, 0, 0, 0, 0, 1, 0, 0, 0, 2, 123, 125
    ])
  })

  it('frames session events with a 36-byte session id before the payload', () => {
    const payload = JSON.stringify({ dialog: { bot_name: 'Pi' } })
    const frame = encodeDoubaoEvent(DOUBAO_PROTOCOL.client.startSession, payload, SESSION_ID)
    expect(frame[0]).toBe(0x11)
    expect(frame[1]).toBe((DOUBAO_PROTOCOL.msgType.fullClientRequest << 4) | 0b0100)
    const decoded = decodeDoubaoFrame(frame)
    expect(decoded.event).toBe(100)
    expect(decoded.sessionId).toBe(SESSION_ID)
    expect(decoded.payload.toString('utf8')).toBe(payload)
  })

  it('decodes the documented TTSResponse audio frame shape', () => {
    const frame = Buffer.concat([
      Buffer.from([0x11, 0b10110100, 0, 0]),
      (() => {
        const b = Buffer.alloc(4)
        b.writeUInt32BE(DOUBAO_PROTOCOL.server.ttsResponse)
        return b
      })(),
      (() => {
        const b = Buffer.alloc(4)
        b.writeUInt32BE(Buffer.byteLength(SESSION_ID))
        return Buffer.concat([b, Buffer.from(SESSION_ID)])
      })(),
      (() => {
        const b = Buffer.alloc(4)
        b.writeUInt32BE(2044)
        return Buffer.concat([b, Buffer.alloc(2044, 7)])
      })()
    ])
    const decoded = decodeDoubaoFrame(frame)
    expect(decoded.msgType).toBe(DOUBAO_PROTOCOL.msgType.audioOnlyResponse)
    expect(decoded.event).toBe(352)
    expect(decoded.sessionId).toBe(SESSION_ID)
    expect(decoded.payload.length).toBe(2044)
  })

  it('unwraps gzipped error frames with their code', () => {
    const frame = encodeDoubaoFrame({
      msgType: DOUBAO_PROTOCOL.msgType.error,
      code: 45000003,
      payload: JSON.stringify({ error: 'Abnormal silence audio' }),
      gzip: true
    })
    const decoded = decodeDoubaoFrame(frame)
    expect(decoded.code).toBe(45000003)
    expect(decoded.event).toBeNull()
    expect(mapDoubaoFrame(decoded)).toEqual({
      kind: 'error',
      message: 'Abnormal silence audio'
    })
  })

  it('rejects truncated and foreign frames', () => {
    expect(() => decodeDoubaoFrame(Buffer.from([0x11, 20, 16, 0, 0, 0]))).toThrow()
    expect(() => decodeDoubaoFrame(Buffer.from([0x22, 20, 16, 0]))).toThrow()
  })

  it('keeps 24 kHz -> 16 kHz resampling continuous across frames', () => {
    const carry = { remainder: Buffer.alloc(0) }
    let bytes = 0
    for (let i = 0; i < 3; i++) {
      const frame = doubaoAudioFrame(Buffer.alloc(4096, i + 1), carry, SESSION_ID)
      const decoded = decodeDoubaoFrame(frame)
      expect(decoded.event).toBe(DOUBAO_PROTOCOL.client.taskRequest)
      expect(decoded.sessionId).toBe(SESSION_ID)
      bytes += decoded.payload.length
    }
    // 3 x 4096 bytes of 24 kHz PCM resample to 8192 bytes of 16 kHz PCM total,
    // identical to the Gemini transport budget.
    expect(bytes).toBe(8192)
  })

  it('builds a StartSession payload locked to 16-bit 24 kHz TTS without tools', () => {
    const settings = {
      ...DEFAULT_VOICE,
      adapter: 'doubao-realtime' as const,
      model: '1.2.1.1',
      voice: 'zh_female_vv_jupiter_bigtts'
    }
    const instructions = 'You are the voice assistant. No work conversation is bound.'
    const { payload } = doubaoSetup(settings, instructions)
    const json = JSON.parse(payload)
    expect(json.dialog.extra).toEqual({ input_mod: 'keep_alive', model: '1.2.1.1' })
    expect(json.dialog.system_role).toContain('No work conversation is bound.')
    expect(json.dialog.system_role.length).toBeLessThanOrEqual(4000)
    expect(json.tts).toEqual({
      speaker: 'zh_female_vv_jupiter_bigtts',
      audio_config: { format: 'pcm_s16le', sample_rate: 24000, channel: 1 }
    })
    expect(JSON.stringify(json)).not.toContain('function')
    // Over-long prompts truncate instead of failing the session.
    const truncated = JSON.parse(doubaoSetup(settings, 'x'.repeat(5000)).payload)
    expect(truncated.dialog.system_role.length).toBe(4000)
  })

  it('parses credential pairs strictly', () => {
    expect(
      parseDoubaoCredentials(JSON.stringify({ appId: '5147266543', accessToken: 'tok' }))
    ).toEqual({
      appId: '5147266543',
      accessToken: 'tok'
    })
    expect(() => parseDoubaoCredentials('not json')).toThrow()
    expect(() =>
      parseDoubaoCredentials(JSON.stringify({ appId: 'bad id!', accessToken: 't' }))
    ).toThrow()
    expect(() => parseDoubaoCredentials(JSON.stringify({ appId: '5147266543' }))).toThrow()
  })

  it('maps every documented server event the service reacts to', () => {
    const decode = (event: number, payload: unknown) =>
      mapDoubaoFrame(decodeDoubaoFrame(serverFrame(event, payload, SESSION_ID)))
    expect(decode(DOUBAO_PROTOCOL.server.connectionStarted, {})).toEqual({ kind: 'connected' })
    expect(decode(DOUBAO_PROTOCOL.server.sessionStarted, { dialog_id: 'd1' })).toEqual({
      kind: 'ready'
    })
    expect(decode(DOUBAO_PROTOCOL.server.asrInfo, { question_id: 'q1' })).toEqual({
      kind: 'interrupt'
    })
    expect(
      decode(DOUBAO_PROTOCOL.server.asrResponse, {
        results: [{ text: '你好世界', is_interim: false }]
      })
    ).toEqual({ kind: 'asr', text: '你好世界', final: true })
    expect(decode(DOUBAO_PROTOCOL.server.asrEnded, {})).toEqual({ kind: 'asrEnded' })
    expect(
      decode(DOUBAO_PROTOCOL.server.ttsSentenceStart, { text: '你好', tts_type: 'default' })
    ).toEqual({ kind: 'assistantText', text: '你好' })
    const audio = decodeDoubaoFrame(
      encodeDoubaoFrame({
        msgType: DOUBAO_PROTOCOL.msgType.audioOnlyResponse,
        event: DOUBAO_PROTOCOL.server.ttsResponse,
        payload: Buffer.from([1, 2, 3]),
        sessionId: SESSION_ID,
        raw: true
      })
    )
    expect(mapDoubaoFrame(audio)).toEqual({ kind: 'audio', data: Buffer.from([1, 2, 3]) })
    expect(decode(DOUBAO_PROTOCOL.server.sessionFinished, {})).toEqual({ kind: 'ended' })
    expect(decode(DOUBAO_PROTOCOL.server.dialogCommonError, { message: 'boom' })).toEqual({
      kind: 'error',
      message: 'boom'
    })
    // Undocumented or irrelevant events must collapse into ignore, never throw.
    expect(decode(DOUBAO_PROTOCOL.server.chatEnded, {})).toEqual({ kind: 'ignore' })
    expect(decode(9999, {})).toEqual({ kind: 'ignore' })
  })
})

describe('Doubao voice transport', () => {
  it('handshakes, streams resampled audio, transcribes and finishes gracefully', async () => {
    const sent: Buffer[] = []
    const socket = Object.assign(new EventEmitter(), {
      readyState: 1,
      bufferedAmount: 0,
      send(raw: string | Buffer) {
        const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
        sent.push(buffer)
        const frame = (() => {
          try {
            return decodeDoubaoFrame(buffer)
          } catch {
            return null
          }
        })()
        if (frame?.event === DOUBAO_PROTOCOL.client.startConnection)
          queueMicrotask(() =>
            socket.emit('message', serverFrame(DOUBAO_PROTOCOL.server.connectionStarted, {}))
          )
        if (frame?.event === DOUBAO_PROTOCOL.client.startSession)
          queueMicrotask(() =>
            socket.emit(
              'message',
              serverFrame(
                DOUBAO_PROTOCOL.server.sessionStarted,
                { dialog_id: 'd1' },
                frame.sessionId ?? undefined
              )
            )
          )
      },
      terminate() {
        socket.emit('close')
      }
    })
    mocks.open.mockResolvedValue(socket)
    mocks.secret.mockResolvedValue(
      JSON.stringify({ appId: '5147266543', accessToken: 'fixture-doubao-token' })
    )
    const events: VoiceEvent[] = []
    const deliver = vi.fn()
    const settings = {
      ...DEFAULT_VOICE,
      enabled: true,
      adapter: 'doubao-realtime' as const,
      model: '1.2.1.1',
      voice: 'zh_female_vv_jupiter_bigtts'
    }
    const service = new LiveVoiceService(
      { read: async () => settings } as JsonStore<typeof settings>,
      (event) => events.push(structuredClone(event)),
      'fixture',
      { hasCredential: vi.fn(), resolve: vi.fn(), context: async () => '', deliver }
    )
    const owner = Object.assign(new EventEmitter(), {
      getURL: () => 'file:///app/index.html',
      isDestroyed: () => false
    }) as unknown as WebContents
    try {
      const id = await service.prepare(owner, { sessionId: 'known', shareContext: true })
      await service.start(id)
      const [url, headers] = mocks.open.mock.calls.at(-1)! as [string, Record<string, string>]
      expect(url).toContain('openspeech.bytedance.com/api/v3/realtime/dialogue')
      expect(headers['X-Api-App-ID']).toBe('5147266543')
      expect(headers['X-Api-Access-Key']).toBe('fixture-doubao-token')
      expect(headers['X-Api-Resource-Id']).toBe('volc.speech.dialog')
      expect(headers['X-Api-App-Key']).toBeTypeOf('string')
      expect(events).toContainEqual({ callId: id, kind: 'ready' })

      // Handshake continued with StartSession; its payload carries setup, never tools.
      const startSession = sent.map((b) => decodeDoubaoFrame(b)).find((f) => f.event === 100)!
      const setup = JSON.parse(startSession.payload.toString('utf8'))
      expect(setup.dialog.extra.model).toBe('1.2.1.1')
      expect(setup.tts.audio_config.format).toBe('pcm_s16le')
      expect(setup.dialog.system_role).toContain('No work conversation is bound.')

      // Uplink audio is resampled PCM inside a TaskRequest frame.
      service.audio(id, Buffer.alloc(4096).toString('base64'))
      const task = sent.map((b) => decodeDoubaoFrame(b)).find((f) => f.event === 200)!
      expect(task.payload.length).toBe(2728)

      // Transcripts: interim overwrite, ASREnded flushes the user text.
      const emitServer = (event: number, payload: unknown) =>
        socket.emit('message', serverFrame(event, payload, startSession.sessionId!))
      emitServer(DOUBAO_PROTOCOL.server.asrResponse, {
        results: [{ text: '你', is_interim: true }]
      })
      emitServer(DOUBAO_PROTOCOL.server.asrResponse, {
        results: [{ text: '你好世界', is_interim: false }]
      })
      expect(events).not.toContainEqual(
        expect.objectContaining({ kind: 'transcript', role: 'user' })
      )
      emitServer(DOUBAO_PROTOCOL.server.asrEnded, {})
      expect(events).toContainEqual({
        callId: id,
        kind: 'transcript',
        role: 'user',
        text: '你好世界'
      })

      emitServer(DOUBAO_PROTOCOL.server.ttsSentenceStart, { text: '你好呀' })
      expect(events).toContainEqual({
        callId: id,
        kind: 'transcript',
        role: 'assistant',
        text: '你好呀'
      })
      socket.emit(
        'message',
        encodeDoubaoFrame({
          msgType: DOUBAO_PROTOCOL.msgType.audioOnlyResponse,
          event: DOUBAO_PROTOCOL.server.ttsResponse,
          payload: Buffer.from([1, 2, 3, 4]),
          sessionId: startSession.sessionId!,
          raw: true
        })
      )
      expect(events.filter((e) => e.kind === 'audio').length).toBeGreaterThan(0)

      // First detected syllable interrupts the assistant playback.
      emitServer(DOUBAO_PROTOCOL.server.asrInfo, { question_id: 'q1' })
      expect(events).toContainEqual({ callId: id, kind: 'interrupted' })

      // Server-side session end stops the call cleanly.
      emitServer(DOUBAO_PROTOCOL.server.sessionFinished, {})
      expect(events).toContainEqual({ callId: id, kind: 'ended' })
      expect(
        sent
          .map((b) => decodeDoubaoFrame(b))
          .some((f) => f.event === DOUBAO_PROTOCOL.client.finishSession)
      ).toBe(true)
      expect(JSON.stringify(events)).not.toContain('fixture-doubao-token')
    } finally {
      service.dispose()
    }
  })

  it('fails closed on malformed frames and rejects invalid credentials', async () => {
    mocks.open.mockClear()
    mocks.secret.mockClear()
    const socket = Object.assign(new EventEmitter(), {
      readyState: 1,
      bufferedAmount: 0,
      send() {},
      terminate() {
        socket.emit('close')
      }
    })
    mocks.open.mockResolvedValue(socket)
    const events: VoiceEvent[] = []
    const settings = { ...DEFAULT_VOICE, enabled: true, adapter: 'doubao-realtime' as const }
    const service = new LiveVoiceService(
      { read: async () => settings } as JsonStore<typeof settings>,
      (event) => events.push(structuredClone(event)),
      'fixture',
      { hasCredential: vi.fn(), resolve: vi.fn(), context: async () => '', deliver: vi.fn() }
    )
    const owner = Object.assign(new EventEmitter(), {
      getURL: () => 'file:///app/index.html',
      isDestroyed: () => false
    }) as unknown as WebContents
    try {
      // Bad secret JSON never reaches the socket.
      mocks.secret.mockResolvedValue('not json')
      const id = await service.prepare(owner)
      await expect(service.start(id)).rejects.toThrow()
      expect(mocks.open).not.toHaveBeenCalled()

      // A garbage binary frame is a fail-closed, not a crash.
      const id2 = await service.prepare(owner)
      mocks.secret.mockResolvedValue(JSON.stringify({ appId: '1', accessToken: 't' }))
      const pending = service.start(id2)
      await new Promise((resolve) => setImmediate(resolve))
      socket.emit('message', Buffer.from('garbage frame'))
      await expect(pending).rejects.toThrow()
      expect(events.some((e) => e.kind === 'error')).toBe(true)
    } finally {
      service.dispose()
    }
  })
})
