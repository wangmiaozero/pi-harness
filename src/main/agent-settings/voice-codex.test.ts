// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import type { VoiceEvent } from '@shared/agent-settings/schema'
import type { JsonStore } from '../services/storage'
import { DEFAULT_VOICE, LiveVoiceService } from './voice-service'
vi.mock('../security/secret-store', () => ({ secretStore: { getSecret: vi.fn() } }))
afterEach(() => vi.unstubAllGlobals())
describe('Codex voice bridge', () => {
  it('keeps authentication in Main and bounds delegation events to a reviewed work conversation', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ sdp: 'v=0\no=fixture\n' }), { status: 201 })
    )
    vi.stubGlobal('fetch', fetcher)
    const events: VoiceEvent[] = [],
      deliver = vi.fn()
    const settings = {
      ...DEFAULT_VOICE,
      enabled: true,
      adapter: 'codex-live' as const,
      voice: 'cove'
    }
    const service = new LiveVoiceService(
      { read: async () => settings } as JsonStore<typeof settings>,
      (event) => events.push(structuredClone(event)),
      'fixture',
      {
        hasCredential: async () => true,
        resolve: async () => ({ key: 'fixture-main-only-token', accountId: 'fixture-account' }),
        context: async () => '',
        deliver
      }
    )
    const owner = Object.assign(new EventEmitter(), {
      getURL: () => 'file:///app/index.html',
      isDestroyed: () => false
    }) as unknown as WebContents
    try {
      const id = await service.prepare(owner, { sessionId: 'known' })
      expect(await service.start(id, 'v=0\no=offer\n')).toEqual({
        answerSdp: 'v=0\r\no=fixture\r\n'
      })
      expect(String(fetcher.mock.calls[0][0])).toContain(
        'https://chatgpt.com/backend-api/codex/realtime/calls'
      )
      const request = fetcher.mock.calls[0][1]
      expect((request.headers as Record<string, string>).Authorization).toBe(
        'Bearer fixture-main-only-token'
      )
      service.signal(id, JSON.stringify({ type: 'input_transcript.added', text: 'hello' }))
      service.signal(
        id,
        JSON.stringify({
          type: 'delegation.created',
          item: {
            id: 'delegation-fixture',
            type: 'delegation',
            target: 'client',
            content: [{ type: 'input_text', text: 'Review the project' }]
          }
        })
      )
      const candidate = events.find((e) => e.kind === 'work')
      if (candidate?.kind !== 'work') throw new Error('No candidate')
      expect(deliver).not.toHaveBeenCalled()
      expect(events).toContainEqual({ callId: id, kind: 'transcript', role: 'user', text: 'hello' })
      await service.review(id, candidate.operation.id, false)
      expect(deliver).not.toHaveBeenCalled()
      expect(JSON.stringify(events)).not.toContain('fixture-main-only-token')
      expect(events.filter((e) => e.kind === 'signal')).not.toHaveLength(0)
      service.stop(id)
      expect(() => service.signal(id, '{}')).toThrow('not ready')
    } finally {
      service.dispose()
    }
  })
  it('cancels an in-flight call when its owner closes', async () => {
    let pendingSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            pendingSignal = init.signal as AbortSignal
            pendingSignal.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true
            })
          })
      )
    )
    const settings = { ...DEFAULT_VOICE, enabled: true, adapter: 'codex-live' as const }
    const service = new LiveVoiceService(
      { read: async () => settings } as JsonStore<typeof settings>,
      () => undefined,
      'fixture',
      {
        hasCredential: async () => true,
        resolve: async () => ({ key: 'fixture-token', accountId: 'fixture-account' }),
        context: async () => '',
        deliver: vi.fn()
      }
    )
    const owner = Object.assign(new EventEmitter(), {
      getURL: () => 'file:///app/index.html',
      isDestroyed: () => false
    }) as unknown as WebContents
    const id = await service.prepare(owner)
    const start = service.start(id, 'v=0\no=fixture\n')
    const rejected = expect(start).rejects.toThrow('Unable to start')
    await vi.waitFor(() => expect(pendingSignal).toBeDefined())
    owner.emit('destroyed')
    await rejected
    expect(pendingSignal?.aborted).toBe(true)
    service.dispose()
  })
})
