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
  doubaoAudioEvent,
  doubaoCancelEvent,
  doubaoCloseEvent,
  doubaoHeaders,
  doubaoMuteEvent,
  doubaoSetup,
  mapDoubaoEvent,
  parseDoubaoCredentials
} from './voice-doubao'

// Server-side event builder used to feed the socket handler in tests.
const serverEvent = (type: string, extra: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify({ type, ...extra }))

describe('Doubao JSON event protocol', () => {
  it('builds a session.create locked to the fixed model and 16-bit 24 kHz TTS', () => {
    const settings = {
      ...DEFAULT_VOICE,
      adapter: 'doubao-realtime' as const,
      model: 'stale-value-is-ignored',
      voice: 'zh_female_vv_jupiter_bigtts'
    }
    const instructions = 'You are the voice assistant. No work conversation is bound.'
    const { payload } = doubaoSetup(settings, instructions)
    const json = JSON.parse(payload)
    expect(json.type).toBe('session.create')
    expect(json.session.model).toBe(DOUBAO_PROTOCOL.model)
    expect(json.session.instructions).toContain('No work conversation is bound.')
    expect(json.session.instructions.length).toBeLessThanOrEqual(30000)
    expect(json.session.audio.input.format).toEqual({ type: 'pcm', rate: 16000 })
    expect(json.session.audio.output.format).toEqual({ type: 'pcm_s16le', rate: 24000 })
    expect(json.session.audio.output.voice).toBe('zh_female_vv_jupiter_bigtts')
    expect(JSON.stringify(json)).not.toContain('"tools"')
    // Over-long prompts truncate instead of failing the session.
    const truncated = JSON.parse(doubaoSetup(settings, 'x'.repeat(40000)).payload)
    expect(truncated.session.instructions.length).toBe(30000)
  })

  it('wraps resampled mic audio in input_audio_buffer.append with base64', () => {
    const carry = { remainder: Buffer.alloc(0) }
    let bytes = 0
    for (let i = 0; i < 3; i++) {
      const event = JSON.parse(doubaoAudioEvent(Buffer.alloc(4096, i + 1), carry))
      expect(event.type).toBe('input_audio_buffer.append')
      const pcm = Buffer.from(event.audio, 'base64')
      expect(pcm.length % 2).toBe(0)
      bytes += pcm.length
    }
    // 3 x 4096 bytes of 24 kHz PCM resample to 8192 bytes of 16 kHz PCM total,
    // identical to the Gemini transport budget.
    expect(bytes).toBe(8192)
  })

  it('emits the explicit mute/unmute pair plus cancel and close events', () => {
    expect(JSON.parse(doubaoMuteEvent(true)).type).toBe('input_audio_mute.commit')
    expect(JSON.parse(doubaoMuteEvent(false)).type).toBe('input_audio_unmute.commit')
    expect(JSON.parse(doubaoCancelEvent()).type).toBe('response.cancel')
    expect(JSON.parse(doubaoCloseEvent()).type).toBe('session.close')
  })

  it('parses credential pairs strictly', () => {
    expect(
      parseDoubaoCredentials(JSON.stringify({ appId: '5147266543', accessToken: 'tok' }))
    ).toEqual({
      kind: 'app',
      appId: '5147266543',
      accessToken: 'tok'
    })
    expect(parseDoubaoCredentials(JSON.stringify({ apiKey: 'sk-fixture' }))).toEqual({
      kind: 'apiKey',
      apiKey: 'sk-fixture'
    })
    expect(() => parseDoubaoCredentials('not json')).toThrow()
    expect(() =>
      parseDoubaoCredentials(JSON.stringify({ appId: 'bad id!', accessToken: 't' }))
    ).toThrow()
    expect(() => parseDoubaoCredentials(JSON.stringify({ appId: '5147266543' }))).toThrow()
    // Mixing the two auth shapes is a configuration error, not a silent fallback.
    expect(() =>
      parseDoubaoCredentials(JSON.stringify({ apiKey: 'sk-x', appId: '5147266543' }))
    ).toThrow()
  })

  it('emits the legacy four headers or the new-console key header', () => {
    const app = doubaoHeaders({ kind: 'app', appId: '5147266543', accessToken: 'tok' })
    expect(app['X-Api-App-ID']).toBe('5147266543')
    expect(app['X-Api-Access-Key']).toBe('tok')
    expect(app['X-Api-App-Key']).toBe(DOUBAO_PROTOCOL.gatewayKeyValue)
    expect(app['X-Api-Resource-Id']).toBe('volc.speech.dialog')
    // The Seeduplex docs mention X-Api-Key alone for the new console.
    const key = doubaoHeaders({ kind: 'apiKey', apiKey: 'sk-fixture' })
    expect(key['X-Api-Key']).toBe('sk-fixture')
    expect(key['X-Api-Resource-Id']).toBeUndefined()
    expect(key['X-Api-App-Key']).toBeUndefined()
    expect(key['X-Api-App-ID']).toBeUndefined()
  })

  it('maps every documented server event the service reacts to', () => {
    expect(mapDoubaoEvent({ type: 'session.created', session: { id: 'd1' } })).toEqual({
      kind: 'ready',
      sessionId: 'd1'
    })
    expect(
      mapDoubaoEvent({
        type: 'conversation.item.input_audio_transcription.started',
        item_id: 'i1'
      })
    ).toEqual({ kind: 'interrupt' })
    expect(
      mapDoubaoEvent({
        type: 'conversation.item.input_audio_transcription.delta',
        delta: '你好'
      })
    ).toEqual({ kind: 'asr', text: '你好' })
    expect(
      mapDoubaoEvent({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: '你好世界'
      })
    ).toEqual({ kind: 'asrEnded', text: '你好世界' })
    expect(mapDoubaoEvent({ type: 'response.output_text.delta', delta: '你好呀' })).toEqual({
      kind: 'assistantDelta',
      text: '你好呀'
    })
    expect(mapDoubaoEvent({ type: 'response.output_text.done', text: '你好呀' })).toEqual({
      kind: 'assistantDone',
      text: '你好呀'
    })
    expect(mapDoubaoEvent({ type: 'response.output_audio.delta', delta: 'QUJD' })).toEqual({
      kind: 'audio',
      data: 'QUJD'
    })
    expect(mapDoubaoEvent({ type: 'session.closed' })).toEqual({ kind: 'ended' })
    expect(mapDoubaoEvent({ type: 'error', error: { message: 'boom' } })).toEqual({
      kind: 'error',
      message: 'boom'
    })
    expect(mapDoubaoEvent({ type: 'error', message: 'flat boom' })).toEqual({
      kind: 'error',
      message: 'flat boom'
    })
    // Irrelevant or not-yet-consumed events must collapse into ignore, never throw:
    // context acks, usage, cancellations, FC echoes and ASR failures.
    expect(mapDoubaoEvent({ type: 'response.done' })).toEqual({ kind: 'ignore' })
    expect(mapDoubaoEvent({ type: 'response.canceled' })).toEqual({ kind: 'ignore' })
    expect(mapDoubaoEvent({ type: 'response.output_audio.done' })).toEqual({ kind: 'ignore' })
    expect(mapDoubaoEvent({ type: 'conversation.item.added', items: [] })).toEqual({
      kind: 'ignore'
    })
    expect(
      mapDoubaoEvent({
        type: 'response.function_call_arguments.done',
        items: [{ call_id: 'c1', name: 'get_weather', arguments: '{}' }]
      })
    ).toEqual({ kind: 'ignore' })
    expect(
      mapDoubaoEvent({
        type: 'conversation.item.input_audio_transcription.failed',
        error: { code: 'audio_unintelligible' }
      })
    ).toEqual({ kind: 'ignore' })
    expect(mapDoubaoEvent({ type: 'totally-unknown-event' })).toEqual({ kind: 'ignore' })
    expect(mapDoubaoEvent({})).toEqual({ kind: 'ignore' })
  })
})

describe('Doubao voice transport', () => {
  it('handshakes with session.create, streams JSON audio, transcribes, interrupts and closes', async () => {
    const sent: string[] = []
    const socket = Object.assign(new EventEmitter(), {
      readyState: 1,
      bufferedAmount: 0,
      send(raw: string | Buffer) {
        sent.push(typeof raw === 'string' ? raw : raw.toString('utf8'))
        let event: { type?: string }
        try {
          event = JSON.parse(sent.at(-1)!)
        } catch {
          return
        }
        if (event.type === 'session.create')
          queueMicrotask(() =>
            socket.emit('message', serverEvent('session.created', { session: { id: 'd1' } }))
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
      model: '1.2.6.1',
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
      expect(url).toBe('wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue')
      expect(headers['X-Api-App-ID']).toBe('5147266543')
      expect(headers['X-Api-Access-Key']).toBe('fixture-doubao-token')
      expect(events).toContainEqual({ callId: id, kind: 'ready' })

      // One-shot handshake: the first outbound frame is session.create with setup.
      const setup = JSON.parse(sent[0])
      expect(setup.type).toBe('session.create')
      expect(setup.session.model).toBe('1.2.6.1')
      expect(setup.session.audio.output.format.type).toBe('pcm_s16le')
      expect(setup.session.instructions).toContain('No work conversation is bound.')

      // Uplink audio is resampled PCM base64 inside a JSON append event.
      service.audio(id, Buffer.alloc(4096).toString('base64'))
      const append = JSON.parse(sent.at(-1)!)
      expect(append.type).toBe('input_audio_buffer.append')
      expect(Buffer.from(append.audio, 'base64').length).toBe(2728)

      // Mute announcements ride the same socket.
      service.mute(id, true)
      expect(JSON.parse(sent.at(-1)!).type).toBe('input_audio_mute.commit')
      service.mute(id, false)
      expect(JSON.parse(sent.at(-1)!).type).toBe('input_audio_unmute.commit')

      // Transcripts: deltas accumulate, transcription.completed flushes the user text.
      socket.emit(
        'message',
        serverEvent('conversation.item.input_audio_transcription.delta', { delta: '你好' })
      )
      expect(events).not.toContainEqual(
        expect.objectContaining({ kind: 'transcript', role: 'user' })
      )
      socket.emit(
        'message',
        serverEvent('conversation.item.input_audio_transcription.completed', {
          transcript: '你好世界'
        })
      )
      expect(events).toContainEqual({
        callId: id,
        kind: 'transcript',
        role: 'user',
        text: '你好世界'
      })

      // Assistant text arrives as deltas too; output_text.done flushes it.
      socket.emit('message', serverEvent('response.output_text.delta', { delta: '你好呀' }))
      expect(events).not.toContainEqual(
        expect.objectContaining({ kind: 'transcript', role: 'assistant' })
      )
      socket.emit('message', serverEvent('response.output_text.done', { text: '你好呀' }))
      expect(events).toContainEqual({
        callId: id,
        kind: 'transcript',
        role: 'assistant',
        text: '你好呀'
      })

      // Downstream audio deltas are base64 PCM, passed straight through.
      socket.emit('message', serverEvent('response.output_audio.delta', { delta: 'AQIDBA==' }))
      expect(events).toContainEqual({ callId: id, kind: 'audio', data: 'AQIDBA==' })

      // First recognized syllable interrupts playback and confirms with response.cancel.
      socket.emit(
        'message',
        serverEvent('conversation.item.input_audio_transcription.started', { item_id: 'i1' })
      )
      expect(events).toContainEqual({ callId: id, kind: 'interrupted' })
      expect(JSON.parse(sent.at(-1)!).type).toBe('response.cancel')

      // Server-side session close stops the call cleanly with a graceful close.
      socket.emit('message', serverEvent('session.closed'))
      expect(events).toContainEqual({ callId: id, kind: 'ended' })
      expect(sent.some((raw) => JSON.parse(raw).type === 'session.close')).toBe(true)
      expect(JSON.stringify(events)).not.toContain('fixture-doubao-token')
    } finally {
      service.dispose()
    }
  })

  it('fails closed on malformed events and rejects invalid credentials', async () => {
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

      // Exercise the full handshake with the new-console API key shape, then a
      // garbage frame — a fail-closed, not a crash.
      mocks.secret.mockResolvedValue(JSON.stringify({ apiKey: 'sk-fixture-key' }))
      const id2 = await service.prepare(owner)
      const pending = service.start(id2)
      await new Promise((resolve) => setImmediate(resolve))
      const [url2, headers2] = mocks.open.mock.calls.at(-1)! as [string, Record<string, string>]
      expect(url2).toContain('/api/v3/duplex/realtime/dialogue')
      expect(headers2['X-Api-Key']).toBe('sk-fixture-key')
      expect(headers2['X-Api-App-ID']).toBeUndefined()
      expect(headers2['X-Api-Resource-Id']).toBeUndefined()
      await new Promise((resolve) => setImmediate(resolve))
      socket.emit('message', Buffer.from('garbage frame'))
      await expect(pending).rejects.toThrow()
      expect(events.some((e) => e.kind === 'error')).toBe(true)

      // A server error event fails the call with the server's message.
      const id3 = await service.prepare(owner)
      const pending3 = service.start(id3)
      await new Promise((resolve) => setImmediate(resolve))
      socket.emit('message', serverEvent('error', { error: { message: 'invalid session' } }))
      await expect(pending3).rejects.toThrow()
      expect(events.some((e) => e.kind === 'error' && e.message === 'invalid session')).toBe(true)
    } finally {
      service.dispose()
    }
  })
})
