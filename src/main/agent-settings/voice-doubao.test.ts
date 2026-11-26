// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import type { JsonStore } from '../services/storage'
import type { VoiceEvent, VoiceSettings } from '@shared/agent-settings/schema'
const mocks = vi.hoisted(() => ({ open: vi.fn(), secret: vi.fn() }))
vi.mock('./socket', () => ({ openSocket: mocks.open }))
vi.mock('../security/secret-store', () => ({ secretStore: { getSecret: mocks.secret } }))
import { DEFAULT_VOICE, LiveVoiceService } from './voice-service'

const DOUBAO_SETTINGS = {
  ...DEFAULT_VOICE,
  enabled: true,
  adapter: 'doubao-realtime' as const,
  profile: undefined,
  endpoint: 'https://openspeech.bytedance.com/api/v3',
  model: '1.3.0.0',
  voice: 'zh_female_vv_jupiter_bigtts'
}
const REJECTED_CALL = 'Voice provider rejected or ended the call. Check the account and model.'
const KEY_REJECTED = 'The voice key was rejected.'
const NOT_GRANTED = 'Seed-Realtime'
const NO_INPUT = 'microphone stream stopped while unmuted'

beforeEach(() => {
  vi.useFakeTimers()
  mocks.open.mockReset()
  mocks.secret.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function createTalk(
  options: { sessionCreated?: boolean; openFails?: boolean; secret?: string | null } = {}
) {
  const sent: Record<string, any>[] = []
  const terminated = vi.fn()
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    bufferedAmount: 0,
    send(raw: string) {
      const message = JSON.parse(raw)
      sent.push(message)
      if (message.type !== 'session.create') return
      if (options.sessionCreated === false) socket.emit('close')
      else socket.emit('message', Buffer.from('{"type":"session.created"}'), false)
    },
    terminate() {
      terminated()
      socket.emit('close')
    }
  })
  if (options.openFails) mocks.open.mockRejectedValue(new Error('Connection failed.'))
  else mocks.open.mockResolvedValue(socket)
  mocks.secret.mockResolvedValue(
    options.secret === undefined ? 'fixture-doubao-key' : options.secret
  )
  const events: VoiceEvent[] = []
  const service = new LiveVoiceService(
    { read: async () => DOUBAO_SETTINGS } as JsonStore<VoiceSettings>,
    (event) => events.push(structuredClone(event)),
    'fixture',
    {
      hasCredential: vi.fn(),
      resolve: vi.fn(),
      context: async () => '',
      deliver: vi.fn()
    }
  )
  const owner = Object.assign(new EventEmitter(), {
    getURL: () => 'file:///app/index.html',
    isDestroyed: () => false
  }) as unknown as WebContents
  return {
    service,
    events,
    sent,
    socket,
    owner,
    terminated,
    receive: (message: unknown) =>
      socket.emit('message', Buffer.from(JSON.stringify(message)), false)
  }
}

const ends = (events: VoiceEvent[], id: string) =>
  events.filter((event) => event.kind === 'ended' && event.callId === id)
const errors = (events: VoiceEvent[], id: string) =>
  events.filter((event) => event.kind === 'error' && event.callId === id)
const closes = (sent: Record<string, any>[]) =>
  sent.filter((message) => message.type === 'session.close')

describe('Doubao voice transport', () => {
  it('creates a session, relays 16 kHz microphone frames and fails on provider errors', async () => {
    const talk = createTalk()
    try {
      const id = await talk.service.prepare(talk.owner, { sessionId: 'known' })
      await talk.service.start(id)
      expect(mocks.open.mock.calls[0][0]).toBe('wss://openspeech.bytedance.com/api/v3/realtime')
      expect(mocks.open.mock.calls[0][0]).not.toContain('model=')
      expect(mocks.open.mock.calls[0][1]).toEqual({ Authorization: 'Bearer fixture-doubao-key' })
      expect(mocks.secret).toHaveBeenCalledWith('fixture-doubao', { strict: true })
      expect(talk.events).toContainEqual({ callId: id, kind: 'ready' })
      expect(talk.sent[0]).toMatchObject({
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
      expect(talk.sent[0].session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
      for (let i = 0; i < 3; i++) talk.service.audio(id, Buffer.alloc(4096).toString('base64'))
      const uplink = talk.sent.slice(1)
      expect(uplink).toHaveLength(3)
      for (const message of uplink) expect(message.type).toBe('input_audio_buffer.append')
      // Three 4096-byte 24 kHz frames resample 3:2 into 8192 bytes of 16 kHz PCM in total.
      expect(
        uplink.reduce((total, message) => total + Buffer.from(message.audio, 'base64').length, 0)
      ).toBe(8192)
      expect(Buffer.from(uplink[0].audio, 'base64').length).toBe(2728)
      talk.receive({ type: 'error' })
      expect(talk.events).toContainEqual({ callId: id, kind: 'error', message: REJECTED_CALL })
      vi.advanceTimersByTime(3000)
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
      expect(closes(talk.sent)).toHaveLength(1)
      expect(JSON.stringify(talk.events)).not.toContain('fixture-doubao-key')
    } finally {
      talk.service.dispose()
    }
  })

  it('closes the provider session once and ends cleanly on session.closed', async () => {
    const talk = createTalk()
    try {
      const id = await talk.service.prepare(talk.owner, { sessionId: 'known' })
      await talk.service.start(id)
      talk.service.stop(id)
      expect(closes(talk.sent)).toEqual([{ type: 'session.close' }])
      expect(ends(talk.events, id)).toHaveLength(0)
      // Re-entrant stop from a second hang-up, owner teardown or the 30-minute cap sends nothing more.
      talk.service.stop(id)
      expect(closes(talk.sent)).toHaveLength(1)
      talk.receive({ type: 'session.closed' })
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
      expect(errors(talk.events, id)).toHaveLength(0)
      // The server closes the transport itself after session.closed; that close is still a success.
      talk.socket.emit('close')
      expect(ends(talk.events, id)).toHaveLength(1)
      expect(closes(talk.sent)).toHaveLength(1)
    } finally {
      talk.service.dispose()
    }
  })

  it('ends cleanly when session.closed never arrives within the close window', async () => {
    const talk = createTalk()
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      talk.service.stop(id)
      expect(closes(talk.sent)).toHaveLength(1)
      vi.advanceTimersByTime(2999)
      expect(ends(talk.events, id)).toHaveLength(0)
      vi.advanceTimersByTime(1)
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
      expect(errors(talk.events, id)).toHaveLength(0)
      expect(talk.terminated).toHaveBeenCalledOnce()
    } finally {
      talk.service.dispose()
    }
  })

  it('ends cleanly when the provider closes the socket without a hang-up', async () => {
    const talk = createTalk()
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      talk.socket.emit('close')
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
      expect(errors(talk.events, id)).toHaveLength(0)
      expect(closes(talk.sent)).toHaveLength(0)
      talk.socket.emit('close')
      expect(ends(talk.events, id)).toHaveLength(1)
    } finally {
      talk.service.dispose()
    }
  })

  it('reports the no-input timeout with its provider error code', async () => {
    const talk = createTalk()
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      talk.receive({
        type: 'error',
        error: { status_code: 45000003, message: 'Abnormal silence audio' }
      })
      expect(errors(talk.events, id)).toEqual([
        { callId: id, kind: 'error', message: expect.stringContaining(NO_INPUT), code: '45000003' }
      ])
      vi.advanceTimersByTime(3000)
      expect(ends(talk.events, id)).toHaveLength(1)
    } finally {
      talk.service.dispose()
    }
  })

  it('reads the no-input error code from a flat provider payload', async () => {
    const talk = createTalk()
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      talk.receive({ type: 'error', status_code: '45000003', message: 'Abnormal silence audio' })
      const error = errors(talk.events, id)
      expect(error).toHaveLength(1)
      expect(error[0]).toMatchObject({ code: '45000003' })
      expect(JSON.stringify(error)).toContain(NO_INPUT)
    } finally {
      talk.service.dispose()
    }
  })

  it('surfaces a rejected handshake as the independent API key check', async () => {
    const talk = createTalk({ openFails: true })
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      expect(errors(talk.events, id)).toEqual([
        {
          callId: id,
          kind: 'error',
          message: expect.stringContaining(KEY_REJECTED),
          code: 'DOUBAO_KEY_REJECTED'
        }
      ])
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
      expect(closes(talk.sent)).toHaveLength(0)
    } finally {
      talk.service.dispose()
    }
  })

  it('surfaces a refused provider session as the Seed-Realtime enablement check', async () => {
    const talk = createTalk({ sessionCreated: false })
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      const error = errors(talk.events, id)
      expect(error).toHaveLength(1)
      expect(error[0]).toMatchObject({ code: 'DOUBAO_SERVICE_NOT_GRANTED' })
      expect(JSON.stringify(error)).toContain(NOT_GRANTED)
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
    } finally {
      talk.service.dispose()
    }
  })

  it('closes the provider session gracefully when the 30-minute cap expires', async () => {
    const talk = createTalk()
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      vi.advanceTimersByTime(30 * 60 * 1000)
      expect(closes(talk.sent)).toEqual([{ type: 'session.close' }])
      expect(errors(talk.events, id)).toHaveLength(0)
      vi.advanceTimersByTime(3000)
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
    } finally {
      talk.service.dispose()
    }
  })
})
