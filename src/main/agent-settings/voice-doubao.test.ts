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

describe('Doubao voice transport', () => {
  it('creates a session, relays 16 kHz microphone frames and fails on provider errors', async () => {
    const sent: Record<string, any>[] = []
    const socket = Object.assign(new EventEmitter(), {
      readyState: 1,
      bufferedAmount: 0,
      send(raw: string) {
        const m = JSON.parse(raw)
        sent.push(m)
        if (m.type === 'session.create')
          queueMicrotask(() =>
            socket.emit('message', Buffer.from('{"type":"session.created"}'), false)
          )
      },
      terminate() {
        socket.emit('close')
      }
    })
    mocks.open.mockResolvedValue(socket)
    mocks.secret.mockResolvedValue('fixture-doubao-key')
    const events: VoiceEvent[] = [],
      deliver = vi.fn(),
      settings = {
        ...DEFAULT_VOICE,
        enabled: true,
        adapter: 'doubao-realtime' as const,
        profile: undefined,
        endpoint: 'https://openspeech.bytedance.com/api/v3',
        model: '1.3.0.0',
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
      const id = await service.prepare(owner, { sessionId: 'known' })
      await service.start(id)
      expect(mocks.open.mock.calls[0][0]).toBe('wss://openspeech.bytedance.com/api/v3/realtime')
      expect(mocks.open.mock.calls[0][0]).not.toContain('model=')
      expect(mocks.open.mock.calls[0][1]).toEqual({ Authorization: 'Bearer fixture-doubao-key' })
      expect(mocks.secret).toHaveBeenCalledWith('fixture-doubao', { strict: true })
      expect(events).toContainEqual({ callId: id, kind: 'ready' })
      expect(sent[0]).toMatchObject({
        type: 'session.create',
        session: {
          model: '1.3.0.0',
          instructions: expect.stringContaining('delegate_to_work_session'),
          audio: {
            input: { format: { type: 'pcm', rate: 16000 } },
            output: {
              format: { type: 'pcm_s16le', rate: 24000 },
              voice: 'zh_female_vv_jupiter_bigtts'
            }
          },
          tools: [expect.objectContaining({ name: 'delegate_to_work_session' })]
        }
      })
      expect(sent[0].session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
      for (let i = 0; i < 3; i++) service.audio(id, Buffer.alloc(4096).toString('base64'))
      const uplink = sent.slice(1)
      expect(uplink).toHaveLength(3)
      for (const m of uplink) expect(m.type).toBe('input_audio_buffer.append')
      // Three 4096-byte 24 kHz frames resample 3:2 into 8192 bytes of 16 kHz PCM in total.
      expect(uplink.reduce((n, m) => n + Buffer.from(m.audio, 'base64').length, 0)).toBe(8192)
      expect(Buffer.from(uplink[0].audio, 'base64').length).toBe(2728)
      socket.emit('message', Buffer.from('{"type":"error"}'), false)
      expect(events).toContainEqual({
        callId: id,
        kind: 'error',
        message: 'Voice provider rejected or ended the call. Check the account and model.'
      })
      expect(events).toContainEqual({ callId: id, kind: 'ended' })
      expect(JSON.stringify(events)).not.toContain('fixture-doubao-key')
    } finally {
      service.dispose()
    }
  })
  it('barges in on server response.canceled and drops stale audio', async () => {
    const sent: Record<string, any>[] = []
    const socket = Object.assign(new EventEmitter(), {
      readyState: 1,
      bufferedAmount: 0,
      send(raw: string) {
        const m = JSON.parse(raw)
        sent.push(m)
        if (m.type === 'session.create')
          queueMicrotask(() =>
            socket.emit('message', Buffer.from('{"type":"session.created"}'), false)
          )
      },
      terminate() {
        socket.emit('close')
      }
    })
    mocks.open.mockResolvedValue(socket)
    mocks.secret.mockResolvedValue('fixture-doubao-key')
    const events: VoiceEvent[] = [],
      settings = {
        ...DEFAULT_VOICE,
        enabled: true,
        adapter: 'doubao-realtime' as const,
        profile: undefined,
        endpoint: 'https://openspeech.bytedance.com/api/v3',
        model: '1.3.0.0',
        voice: 'zh_female_vv_jupiter_bigtts'
      }
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
      const id = await service.prepare(owner, { sessionId: 'known' })
      await service.start(id)
      expect(events).toContainEqual({ callId: id, kind: 'ready' })
      const receive = (message: unknown) =>
        socket.emit('message', Buffer.from(JSON.stringify(message)), false)
      // A new assistant turn starts speaking and streams one audio delta.
      receive({ type: 'response.created', question_id: 'q1', response_id: 'resp_1' })
      expect(events).toContainEqual({ callId: id, kind: 'activity', assistantSpeaking: true })
      receive({ type: 'response.output_audio.delta', question_id: 'q1', response_id: 'resp_1', delta: 'QUJD' })
      expect(events).toContainEqual({ callId: id, kind: 'audio', data: 'QUJD' })
      // The user speaks over the assistant; the server cancels the turn as barge-in.
      receive({ type: 'response.canceled', event_id: 'e1', question_id: 'q1' })
      expect(events).toContainEqual({ callId: id, kind: 'interrupted' })
      expect(events).toContainEqual({
        callId: id,
        kind: 'activity',
        userSpeaking: true,
        assistantSpeaking: false
      })
      // Late audio and text from the canceled response never reach the renderer.
      receive({ type: 'response.output_audio.delta', question_id: 'q1', response_id: 'resp_1', delta: 'REVG' })
      receive({ type: 'response.output_text.done', question_id: 'q1', response_id: 'resp_1', text: 'stale tail' })
      expect(events.filter((event) => event.kind === 'audio')).toEqual([
        { callId: id, kind: 'audio', data: 'QUJD' }
      ])
      expect(events.filter((event) => event.kind === 'transcript')).toEqual([])
      expect(events.filter((event) => event.kind === 'activity')).toEqual([
        { callId: id, kind: 'activity', assistantSpeaking: true },
        { callId: id, kind: 'activity', userSpeaking: true, assistantSpeaking: false }
      ])
      // Barge-in is entirely server-driven: the client never sends response.cancel.
      expect(JSON.stringify(sent)).not.toContain('response.cancel')
      expect(JSON.stringify(events)).not.toContain('fixture-doubao-key')
    } finally {
      service.dispose()
    }
  })
  it('transcribes both call sides and returns to listening when turns finish', async () => {
    const sent: Record<string, any>[] = []
    const socket = Object.assign(new EventEmitter(), {
      readyState: 1,
      bufferedAmount: 0,
      send(raw: string) {
        const m = JSON.parse(raw)
        sent.push(m)
        if (m.type === 'session.create')
          queueMicrotask(() =>
            socket.emit('message', Buffer.from('{"type":"session.created"}'), false)
          )
      },
      terminate() {
        socket.emit('close')
      }
    })
    mocks.open.mockResolvedValue(socket)
    mocks.secret.mockResolvedValue('fixture-doubao-key')
    const events: VoiceEvent[] = [],
      settings = {
        ...DEFAULT_VOICE,
        enabled: true,
        adapter: 'doubao-realtime' as const,
        profile: undefined,
        endpoint: 'https://openspeech.bytedance.com/api/v3',
        model: '1.3.0.0',
        voice: 'zh_female_vv_jupiter_bigtts'
      }
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
      const id = await service.prepare(owner, { sessionId: 'known' })
      await service.start(id)
      expect(events).toContainEqual({ callId: id, kind: 'ready' })
      const receive = (message: unknown) =>
        socket.emit('message', Buffer.from(JSON.stringify(message)), false)
      // The user's query is transcribed as a subtitle without driving the turn state.
      receive({
        type: 'conversation.item.input_audio_transcription.completed',
        question_id: 'q2',
        transcript: '帮我整理一下日志'
      })
      expect(events).toContainEqual({
        callId: id,
        kind: 'transcript',
        role: 'user',
        text: '帮我整理一下日志'
      })
      // The reply turn speaks, transcribes its text, and finishes back into listening.
      receive({ type: 'response.created', question_id: 'q2', response_id: 'resp_2' })
      receive({
        type: 'response.output_text.done',
        question_id: 'q2',
        response_id: 'resp_2',
        text: '好的，马上处理'
      })
      receive({ type: 'response.output_audio.done', question_id: 'q2', response_id: 'resp_2' })
      receive({ type: 'response.done', question_id: 'q2', response_id: 'resp_2' })
      expect(events).toContainEqual({
        callId: id,
        kind: 'transcript',
        role: 'assistant',
        text: '好的，马上处理'
      })
      expect(events.filter((event) => event.kind === 'activity')).toEqual([
        { callId: id, kind: 'activity', assistantSpeaking: true },
        { callId: id, kind: 'activity', assistantSpeaking: false },
        { callId: id, kind: 'activity', assistantSpeaking: false }
      ])
      expect(JSON.stringify(sent)).not.toContain('response.cancel')
      expect(JSON.stringify(events)).not.toContain('fixture-doubao-key')
    } finally {
      service.dispose()
    }
  })
})
