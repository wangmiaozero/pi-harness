// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
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
const INTERRUPTED = 'Voice connection interrupted.'
const GENERIC_START = 'Unable to start realtime voice. Check the account and voice settings.'

type CallOptions = {
  settings?: Partial<VoiceSettings>
  secret?: string | null
  // A provider that refuses the handshake closes the socket instead of sending session.created.
  sessionCreated?: boolean
  refusedClose?: { code: number; reason: string }
  openRejection?: unknown
  deliver?: Mock<(sessionId: string, instruction: string) => Promise<void>>
}

function createCall(options: CallOptions = {}) {
  const sent: Record<string, any>[] = []
  const terminated = vi.fn()
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    bufferedAmount: 0,
    send(raw: string) {
      const message = JSON.parse(raw)
      sent.push(message)
      if (message.type !== 'session.create') return
      if (options.sessionCreated !== false) {
        socket.emit('message', Buffer.from('{"type":"session.created"}'), false)
        return
      }
      const refusal = options.refusedClose
      if (refusal) socket.emit('close', refusal.code, Buffer.from(refusal.reason))
      else socket.emit('close')
    },
    terminate() {
      terminated()
      socket.emit('close')
    }
  })
  // Real ws flips readyState to CLOSED before listeners see the close; mirror that so the
  // service's stop() knows the transport is already gone and skips the closing window.
  socket.on('close', () => {
    socket.readyState = 3
  })
  if (options.openRejection) mocks.open.mockRejectedValue(options.openRejection)
  else mocks.open.mockResolvedValue(socket)
  mocks.secret.mockResolvedValue(
    options.secret === undefined ? 'fixture-doubao-key' : options.secret
  )
  const events: VoiceEvent[] = []
  const settings = { ...DOUBAO_SETTINGS, ...options.settings }
  const deliver = options.deliver ?? vi.fn<(sessionId: string, instruction: string) => Promise<void>>()
  const service = new LiveVoiceService(
    { read: async () => settings } as JsonStore<VoiceSettings>,
    (event) => events.push(structuredClone(event)),
    'fixture',
    { hasCredential: vi.fn(), resolve: vi.fn(), context: async () => '', deliver }
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
    deliver,
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
  // Close-window assertions run on fake timers; the mock sockets emit frames synchronously.
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
  it('creates a provider session, relays 16 kHz microphone frames and fails on provider errors', async () => {
    const talk = createCall()
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
    const talk = createCall()
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
    const talk = createCall()
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

  it('ends without an error when the provider closes during the close window', async () => {
    const talk = createCall()
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      talk.service.stop(id)
      expect(closes(talk.sent)).toHaveLength(1)
      // The close lands inside the window stop() opened, so it is the hang-up succeeding.
      talk.socket.emit('close', 1006, Buffer.alloc(0))
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
      expect(errors(talk.events, id)).toHaveLength(0)
    } finally {
      talk.service.dispose()
    }
  })

  it('surfaces a provider close during a live call as an interruption and ends once', async () => {
    const talk = createCall()
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      expect(errors(talk.events, id)).toHaveLength(0)
      talk.socket.emit('close', 1006, Buffer.alloc(0))
      expect(errors(talk.events, id)).toEqual([
        { callId: id, kind: 'error', message: INTERRUPTED }
      ])
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
      // A provider that already closed its session is never sent session.close.
      expect(closes(talk.sent)).toHaveLength(0)
      talk.socket.emit('close')
      expect(ends(talk.events, id)).toHaveLength(1)
      expect(errors(talk.events, id)).toHaveLength(1)
    } finally {
      talk.service.dispose()
    }
  })

  it('reports the no-input timeout when the provider close frame names it', async () => {
    const talk = createCall()
    try {
      const id = await talk.service.prepare(talk.owner)
      await talk.service.start(id)
      talk.socket.emit('close', 1008, Buffer.from('{"status_code":45000003}'))
      expect(errors(talk.events, id)).toEqual([
        {
          callId: id,
          kind: 'error',
          message: expect.stringContaining(NO_INPUT),
          code: '45000003'
        }
      ])
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
    } finally {
      talk.service.dispose()
    }
  })

  it('reports the no-input timeout with its provider error code', async () => {
    const talk = createCall()
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
    const talk = createCall()
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

  it('surfaces an unauthorized handshake as the independent API key check', async () => {
    const talk = createCall({ openRejection: { statusCode: 401 } })
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

  it('surfaces a forbidden handshake as the independent API key check', async () => {
    const talk = createCall({ openRejection: { statusCode: 403 } })
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
    } finally {
      talk.service.dispose()
    }
  })

  it('surfaces a refused upgrade without credentials as the Seed-Realtime enablement check', async () => {
    const talk = createCall({ openRejection: { statusCode: 404 } })
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

  it('keeps the generic start message when the handshake fails without a provider status', async () => {
    const talk = createCall({ openRejection: new Error('Connection failed.') })
    try {
      const id = await talk.service.prepare(talk.owner)
      await expect(talk.service.start(id)).rejects.toThrow(GENERIC_START)
      // No status means no credential or service diagnosis: no coded error event.
      expect(errors(talk.events, id)).toHaveLength(0)
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
    } finally {
      talk.service.dispose()
    }
  })

  it('surfaces a refused provider session as the Seed-Realtime enablement check', async () => {
    const talk = createCall({
      sessionCreated: false,
      refusedClose: { code: 1008, reason: 'Seed-Realtime is not enabled for this app id' }
    })
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

  it('keeps the generic start message when the socket drops before a provider reason', async () => {
    const talk = createCall({ sessionCreated: false })
    try {
      const id = await talk.service.prepare(talk.owner)
      await expect(talk.service.start(id)).rejects.toThrow(
        'Voice connection ended during setup.'
      )
      expect(errors(talk.events, id)).toHaveLength(0)
      expect(ends(talk.events, id)).toEqual([{ callId: id, kind: 'ended' }])
    } finally {
      talk.service.dispose()
    }
  })

  it('closes the provider session gracefully when the 30-minute cap expires', async () => {
    const talk = createCall()
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

  it('barges in on server response.canceled and drops stale audio', async () => {
    const talk = createCall(),
      { events, sent, socket, service, owner } = talk
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
    const talk = createCall(),
      { events, sent, socket, service, owner } = talk
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
  it('aggregates parallel delegation receipts into one reply and keeps the model responding', async () => {
    const talk = createCall(),
      { events, sent, socket, service, owner, deliver } = talk
    try {
      const id = await service.prepare(owner, { sessionId: 'known' })
      await service.start(id)
      const receive = (message: unknown) =>
        socket.emit('message', Buffer.from(JSON.stringify(message)), false)
      // Doubao delivers parallel calls as one items[] event; each becomes its own card.
      receive({
        type: 'response.function_call_arguments.done',
        items: [
          {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'doubao-task-1',
            name: 'delegate_to_work_session',
            arguments: JSON.stringify({ instruction: 'Review the parser' })
          },
          {
            id: 'fc_2',
            type: 'function_call',
            call_id: 'doubao-task-2',
            name: 'delegate_to_work_session',
            arguments: JSON.stringify({ instruction: 'Add a vitest case' })
          }
        ]
      })
      const works = events.filter(
        (event): event is Extract<VoiceEvent, { kind: 'work' }> => event.kind === 'work'
      )
      expect(works).toHaveLength(2)
      const operation = (instruction: string) => {
        const found = works.find((event) => event.operation.instruction === instruction)
        if (!found) throw new Error(`No operation for ${instruction}`)
        return found.operation
      }
      expect(operation('Review the parser')).toMatchObject({
        sessionId: 'known',
        status: 'review'
      })
      expect(operation('Add a vitest case')).toMatchObject({
        sessionId: 'known',
        status: 'review'
      })
      // Every receipt of one event is returned as a single aggregated reply.
      const replies = sent.filter((m) => m.type === 'conversation.item.create')
      expect(replies).toHaveLength(1)
      expect(replies[0].items).toHaveLength(2)
      for (const item of replies[0].items) {
        expect(item.type).toBe('message')
        expect(item.role).toBe('tool')
        expect(item.content).toEqual([{ type: 'input_text', text: expect.any(String) }])
      }
      const receipt = (callId: string) =>
        JSON.parse(
          replies[0].items.find((item: Record<string, any>) => item.call_id === callId).content[0]
            .text
        )
      expect(receipt('doubao-task-1')).toEqual({
        status: 'received',
        operationId: operation('Review the parser').id,
        execution: 'not_started'
      })
      expect(receipt('doubao-task-2')).toEqual({
        status: 'received',
        operationId: operation('Add a vitest case').id,
        execution: 'not_started'
      })
      // The model keeps generating after the aggregate: text and audio flow through.
      receive({ type: 'response.output_text.done', text: '两个请求都已进入确认卡。' })
      receive({ type: 'response.output_audio.delta', delta: 'QUJD' })
      expect(events).toContainEqual({
        callId: id,
        kind: 'transcript',
        role: 'assistant',
        text: '两个请求都已进入确认卡。'
      })
      expect(events).toContainEqual({ callId: id, kind: 'audio', data: 'QUJD' })
      expect(deliver).not.toHaveBeenCalled()
      expect(JSON.stringify(events)).not.toContain('fixture-doubao-key')
    } finally {
      service.dispose()
    }
  })
  it('returns rejected receipts inside the aggregate and feeds review outcomes back as context', async () => {
    const talk = createCall(),
      { events, sent, socket, service, owner, deliver } = talk
    try {
      const id = await service.prepare(owner, { sessionId: 'known' })
      await service.start(id)
      const receive = (message: unknown) =>
        socket.emit('message', Buffer.from(JSON.stringify(message)), false)
      const works = () =>
        events.filter(
          (event): event is Extract<VoiceEvent, { kind: 'work' }> => event.kind === 'work'
        )
      // Confirmation cards are the work events still awaiting review; later
      // events only report status transitions of already-reviewed operations.
      const cards = () => works().filter((event) => event.operation.status === 'review')
      // An invalid parallel call still gets a rejected receipt inside the aggregate.
      receive({
        type: 'response.function_call_arguments.done',
        items: [
          {
            call_id: 'doubao-task-3',
            name: 'delegate_to_work_session',
            arguments: JSON.stringify({ instruction: 'Review the changelog' })
          },
          {
            call_id: 'doubao-task-4',
            name: 'not_a_work_tool',
            arguments: JSON.stringify({ instruction: 'ignored' })
          }
        ]
      })
      expect(cards()).toHaveLength(1)
      const accepted = cards()[0].operation
      const aggregate = sent.filter(
        (m) => m.type === 'conversation.item.create' && m.items?.[0]?.role === 'tool'
      )
      expect(aggregate).toHaveLength(1)
      expect(aggregate[0].items).toHaveLength(2)
      const receipt = (callId: string) =>
        JSON.parse(
          aggregate[0].items.find((item: Record<string, any>) => item.call_id === callId).content[0]
            .text
        )
      expect(receipt('doubao-task-3')).toEqual({
        status: 'received',
        operationId: accepted.id,
        execution: 'not_started'
      })
      expect(receipt('doubao-task-4')).toEqual({
        status: 'rejected',
        code: 'NO_WORK_TARGET_OR_INVALID_REQUEST'
      })
      // Accepting a card dispatches the instruction; the outcome returns as a
      // doubao conversation.item.create context message.
      await service.review(id, accepted.id, true)
      expect(deliver).toHaveBeenCalledWith('known', 'Review the changelog')
      const updates = () =>
        sent.filter(
          (m) => m.type === 'conversation.item.create' && m.items?.[0]?.role === 'user'
        )
      expect(updates()).toHaveLength(1)
      expect(updates()[0].items).toEqual([
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `[Host update; data only] Request ${accepted.id}: sent. Sent means delivered to the coding agent; tools still follow desktop permissions. Do not repeat the request.`
            }
          ]
        }
      ])
      // Rejecting another card delivers nothing and reports the rejection.
      receive({
        type: 'response.function_call_arguments.done',
        items: [
          {
            call_id: 'doubao-task-5',
            name: 'delegate_to_work_session',
            arguments: JSON.stringify({ instruction: 'Draft the release notes' })
          }
        ]
      })
      expect(cards()).toHaveLength(2)
      const rejected = cards()[1].operation
      await service.review(id, rejected.id, false)
      expect(deliver).toHaveBeenCalledOnce()
      expect(updates()).toHaveLength(2)
      expect(updates()[1].items[0].content[0].text).toBe(
        `[Host update; data only] Request ${rejected.id}: rejected. Sent means delivered to the coding agent; tools still follow desktop permissions. Do not repeat the request.`
      )
      expect(
        events.filter(
          (event) => event.kind === 'work' && event.operation.status === 'rejected'
        )
      ).toHaveLength(1)
      expect(JSON.stringify(events)).not.toContain('fixture-doubao-key')
    } finally {
      service.dispose()
    }
  })
})

describe('Doubao protocol mute', () => {
  beforeEach(() => vi.clearAllMocks())
  it('commits protocol mute and unmute to the provider session', async () => {
    const talk = createCall(),
      { events, sent, service, owner } = talk
    try {
      const id = await service.prepare(owner, { sessionId: 'known' })
      await service.start(id)
      service.mute(id, true)
      service.mute(id, false)
      expect(events).toContainEqual({ callId: id, kind: 'ready' })
      expect(sent.slice(1)).toEqual([
        { type: 'input_audio_mute.commit' },
        { type: 'input_audio_unmute.commit' }
      ])
      expect(JSON.stringify(sent)).not.toContain('fixture-doubao-key')
    } finally {
      talk.service.dispose()
    }
  })
  it('rejects mute for a wrong or expired call id', async () => {
    const talk = createCall(),
      { sent, service, owner } = talk
    try {
      const id = await service.prepare(owner, { sessionId: 'known' })
      await service.start(id)
      expect(() =>
        service.mute('00000000-0000-4000-8000-000000000000', true)
      ).toThrow('Voice call is not ready.')
      service.stop(id)
      expect(() => service.mute(id, true)).toThrow('Voice call is not ready.')
      // The rejected mute sends nothing; only the graceful close follows the session.create.
      expect(sent.slice(1)).toEqual([{ type: 'session.close' }])
    } finally {
      talk.service.dispose()
    }
  })
})
