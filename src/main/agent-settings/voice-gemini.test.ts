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

describe('Gemini voice transport', () => {
  it('negotiates audio, merges transcripts and returns reviewed task receipts', async () => {
    const sent: Record<string, any>[] = []
    const socket = Object.assign(new EventEmitter(), {
      readyState: 1,
      bufferedAmount: 0,
      send(raw: string) {
        const m = JSON.parse(raw)
        sent.push(m)
        if (m.setup)
          queueMicrotask(() => socket.emit('message', Buffer.from('{"setupComplete":{}}'), true))
      },
      terminate() {
        socket.emit('close')
      }
    })
    mocks.open.mockResolvedValue(socket)
    mocks.secret.mockResolvedValue('fixture-gemini-key')
    const events: VoiceEvent[] = [],
      deliver = vi.fn(),
      settings = { ...DEFAULT_VOICE, enabled: true, adapter: 'gemini-live' as const, voice: 'Kore' }
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
      expect(mocks.open.mock.calls[0][0]).toContain('generativelanguage.googleapis.com/')
      expect(mocks.secret).toHaveBeenCalledWith('fixture-gemini', { strict: true })
      service.audio(id, Buffer.alloc(4096).toString('base64'))
      expect(sent[1]).toMatchObject({
        realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000' } }
      })
      const receive = (message: unknown) =>
        socket.emit('message', Buffer.from(JSON.stringify(message)), true)
      receive({
        serverContent: {
          inputTranscription: { text: 'Hello ' },
          outputTranscription: { text: 'Good ' },
          modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAA' } }] }
        }
      })
      receive({
        serverContent: {
          inputTranscription: { text: 'there' },
          outputTranscription: { text: 'morning' },
          turnComplete: true
        }
      })
      expect(events).toContainEqual({
        callId: id,
        kind: 'transcript',
        role: 'user',
        text: 'Hello there'
      })
      expect(events).toContainEqual({
        callId: id,
        kind: 'transcript',
        role: 'assistant',
        text: 'Good morning'
      })
      expect(events).toContainEqual({ callId: id, kind: 'audio', data: 'AAAA' })
      receive({
        toolCall: {
          functionCalls: [
            {
              id: 'gemini-task',
              name: 'delegate_to_work_session',
              args: { instruction: 'Review changes' }
            }
          ]
        }
      })
      const candidate = events.find((event) => event.kind === 'work')
      expect(deliver).not.toHaveBeenCalled()
      if (candidate?.kind !== 'work') throw new Error('No work request')
      await service.review(id, candidate.operation.id, true)
      expect(deliver).toHaveBeenCalledWith('known', 'Review changes')
      receive({ serverContent: { interrupted: true } })
      expect(events).toContainEqual({ callId: id, kind: 'interrupted' })
      expect(JSON.stringify(events)).not.toContain('fixture-gemini-key')
    } finally {
      service.dispose()
    }
  })
})
