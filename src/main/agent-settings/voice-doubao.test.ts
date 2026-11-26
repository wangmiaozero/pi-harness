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
})
