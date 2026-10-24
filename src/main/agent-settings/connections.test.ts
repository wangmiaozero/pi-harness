// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { JsonStore } from '../services/storage'
import { RemoteHostService, type RemoteState } from './remote-service'
import { DEFAULT_VOICE, LiveVoiceService, canUseVoiceMicrophone } from './voice-service'
import type { VoiceEvent } from '@shared/agent-settings/schema'
const secrets = vi.hoisted(() => new Map<string, string>())
vi.mock('../security/secret-store', () => ({
  secretStore: {
    getSecret: vi.fn(async (id: string) => secrets.get(id) ?? null),
    setSecret: vi.fn(async (id: string, value: string) => {
      secrets.set(id, value)
    }),
    removeSecret: vi.fn(async (id: string) => {
      secrets.delete(id)
    })
  }
}))
let temp: string, server: WebSocketServer
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-connection-'))
  secrets.clear()
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
})
afterEach(async () => {
  for (const socket of server.clients) socket.terminate()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(temp, { recursive: true, force: true })
})
const url = () => `ws://127.0.0.1:${(server.address() as { port: number }).port}/v1/racp/ws`

describe('pi-host connection', () => {
  it('pairs, verifies identity, lists projects, reads history, sends and stops a turn', async () => {
    let hostId = 'fixture-host'
    const operations: string[] = [],
      auth: string[] = []
    let prompt: Record<string, unknown> | undefined
    server.on('connection', (socket, request) => {
      auth.push(request.headers.authorization ?? '')
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString())
        operations.push(frame.method)
        if (!frame.id) return
        let result: unknown
        if (frame.method === 'connection/initialize')
          result = { protocolVersion: '1.0', server: { hostId, version: 'fixture-1' } }
        else if (frame.method === 'connection/pair') result = { deviceToken: 'pdt1.fixture-device' }
        else if (frame.method === 'project/list')
          result = { projects: [{ id: '1', label: 'Fixture project', archived: false }] }
        else if (frame.method === 'session/list')
          result = {
            sessions: [
              { id: 's1', title: 'Fixture conversation', workspaceLabel: 'Fixture project' }
            ]
          }
        else if (frame.method === 'session/attach')
          result = {
            snapshot: {
              items: [
                {
                  id: 'i1',
                  itemType: 'message',
                  content: { role: 'assistant', content: 'Remote response' }
                }
              ],
              activeItems: [
                {
                  id: 'i2',
                  itemType: 'message',
                  content: { role: 'assistant', content: 'Streaming reply' }
                }
              ],
              pendingApprovals: [
                {
                  id: 'approval1',
                  sessionId: 's1',
                  kind: 'tool',
                  summary: 'Run fixture tool',
                  expiresAt: new Date(Date.now() + 60000).toISOString(),
                  revision: 1,
                  allowedDecisions: ['allow-once', 'deny']
                }
              ]
            }
          }
        else if (frame.method === 'session/create')
          result = { session: { id: 's2', title: 'New session' } }
        else if (frame.method === 'turn/start') {
          prompt = frame.params
          result = { turn: { id: 't1' } }
        } else if (frame.method === 'session/get') result = { session: { activeTurnId: 't1' } }
        else result = { ok: true }
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }))
      })
    })
    const store = new JsonStore<RemoteState>(path.join(temp, 'hosts.json'), { hosts: [] })
    const service = new RemoteHostService(store)
    try {
      const host = await service.pair({
        label: 'Fixture',
        url: url(),
        token: 'ppt1.fixture-pairing'
      })
      expect(host.status).toBe('disconnected')
      expect(await fs.readFile(path.join(temp, 'hosts.json'), 'utf8')).not.toMatch(/ppt1\.|pdt1\./)
      expect((await service.connect(host.id)).status).toBe('connected')
      expect(auth).toEqual(['Bearer ppt1.fixture-pairing', 'Bearer pdt1.fixture-device'])
      expect(await service.projects(host.id)).toEqual([
        { id: '1', name: 'Fixture project', path: '' }
      ])
      expect((await service.sessions(host.id))[0].title).toBe('Fixture conversation')
      expect(await service.history(host.id, 's1')).toMatchObject({
        messages: [
          { role: 'assistant', text: 'Remote response' },
          { role: 'assistant', text: 'Streaming reply' }
        ],
        approvals: [{ id: 'approval1' }]
      })
      await service.approve({
        id: host.id,
        sessionId: 's1',
        approvalId: 'approval1',
        decision: 'allow-once'
      })
      expect(operations).toContain('approval/respond')
      await expect(
        service.approve({
          id: host.id,
          sessionId: 's1',
          approvalId: 'approval1',
          decision: 'approve'
        })
      ).rejects.toThrow('changed or expired')
      expect((await service.create(host.id, '1')).id).toBe('s2')
      await service.prompt(host.id, 's1', 'Run fixture')
      expect(prompt).toMatchObject({
        sessionId: 's1',
        input: { text: 'Run fixture' },
        context: { requestId: expect.any(String) }
      })
      await service.stop(host.id, 's1')
      expect(operations).toContain('turn/stop')
      service.disconnect(host.id)
      await expect(service.sessions(host.id)).rejects.toThrow('Connect')
      hostId = 'replaced-host'
      await expect(service.connect(host.id)).rejects.toThrow('identity changed')
      expect((await service.list())[0].status).toBe('disconnected')
      await service.remove(host.id)
      expect(await service.list()).toEqual([])
      expect(secrets.size).toBe(0)
    } finally {
      service.dispose()
    }
  })
})

describe('realtime voice', () => {
  it('requires an audio-only permission lease, confirms setup and releases the call', async () => {
    let socket: WebSocket | undefined
    const received: Record<string, unknown>[] = []
    server.on('connection', (ws) => {
      socket = ws
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString())
        received.push(message)
        if (message.type === 'session.update')
          ws.send(JSON.stringify({ type: 'session.updated', session: message.session }))
      })
    })
    const store = new JsonStore(path.join(temp, 'voice.json'), {
      ...DEFAULT_VOICE,
      enabled: true,
      endpoint: url().replace('ws:', 'http:').replace('/v1/racp/ws', '/v1')
    })
    secrets.set('live-voice', 'fixture-voice-key')
    const events: VoiceEvent[] = [],
      service = new LiveVoiceService(store, (event) => events.push(event))
    const contents = Object.assign(new EventEmitter(), {
      getURL: () => 'file:///app/index.html#/settings/voice',
      isDestroyed: () => false
    }) as unknown as WebContents
    expect(
      canUseVoiceMicrophone(contents, 'media', { isMainFrame: true, mediaType: 'audio' })
    ).toBe(false)
    const id = await service.prepare(contents)
    expect(
      canUseVoiceMicrophone(contents, 'media', { isMainFrame: true, mediaType: 'audio' })
    ).toBe(true)
    expect(
      canUseVoiceMicrophone(contents, 'media', { isMainFrame: false, mediaType: 'audio' })
    ).toBe(false)
    expect(
      canUseVoiceMicrophone(contents, 'media', {
        isMainFrame: true,
        mediaTypes: ['audio', 'video']
      })
    ).toBe(false)
    expect(
      canUseVoiceMicrophone(contents, 'media', {
        isMainFrame: true,
        mediaTypes: ['audio'],
        requestingUrl: 'https://outside.test'
      })
    ).toBe(false)
    try {
      await service.start(id)
      expect(events).toContainEqual({ callId: id, kind: 'ready' })
      service.audio(id, Buffer.alloc(4096).toString('base64'))
      await vi.waitFor(() =>
        expect(received.some((m) => m.type === 'input_audio_buffer.append')).toBe(true)
      )
      socket!.send(
        JSON.stringify({
          type: 'response.output_audio_transcript.done',
          transcript: 'Fixture reply'
        })
      )
      await vi.waitFor(() =>
        expect(events).toContainEqual({
          callId: id,
          kind: 'transcript',
          role: 'assistant',
          text: 'Fixture reply'
        })
      )
      socket!.send(JSON.stringify({ type: 'response.created', response: { id: 'old-response' } }))
      socket!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
      socket!.send(
        JSON.stringify({
          type: 'response.output_audio.delta',
          response_id: 'old-response',
          delta: 'AAAA'
        })
      )
      socket!.send(JSON.stringify({ type: 'response.created', response: { id: 'new-response' } }))
      socket!.send(
        JSON.stringify({
          type: 'response.output_audio.delta',
          response_id: 'old-response',
          delta: 'AAAA'
        })
      )
      socket!.send(
        JSON.stringify({
          type: 'response.output_audio.delta',
          response_id: 'new-response',
          delta: 'AgACAA=='
        })
      )
      await vi.waitFor(() =>
        expect(events.filter((event) => event.kind === 'audio')).toEqual([
          { callId: id, kind: 'audio', data: 'AgACAA==' }
        ])
      )
      contents.emit('destroyed')
      expect(events.at(-1)).toEqual({ callId: id, kind: 'ended' })
      expect(
        canUseVoiceMicrophone(contents, 'media', { isMainFrame: true, mediaType: 'audio' })
      ).toBe(false)
      expect(() => service.audio(id, 'AAAA')).toThrow('not ready')
      const saved = await service.save({ ...DEFAULT_VOICE, apiKey: 'fixture-new-voice-key' })
      expect(saved.hasCredential).toBe(true)
      expect(JSON.stringify(saved)).not.toContain('fixture-new-voice-key')
      expect(
        await fs.readFile(path.join(temp, 'voice.json'), 'utf8').catch(() => '')
      ).not.toContain('fixture-voice-key')
    } finally {
      service.dispose()
    }
  })
  it('binds context and work to one call, deduplicates requests and requires a single desktop review', async () => {
    let socket: WebSocket | undefined
    const received: Record<string, any>[] = []
    server.on('connection', (ws) => {
      socket = ws
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString())
        received.push(message)
        if (message.type === 'session.update')
          ws.send(JSON.stringify({ type: 'session.updated', session: message.session }))
      })
    })
    const events: VoiceEvent[] = [],
      deliver = vi.fn(),
      context = vi.fn(async () => 'approved limited history')
    const service = new LiveVoiceService(
      new JsonStore(path.join(temp, 'voice.json'), {
        ...DEFAULT_VOICE,
        enabled: true,
        endpoint: url().replace('ws:', 'http:').replace('/v1/racp/ws', '/v1')
      }),
      (event) => events.push(structuredClone(event)),
      'live-voice',
      { hasCredential: vi.fn(), resolve: vi.fn(), context, deliver }
    )
    secrets.set('live-voice', 'fixture')
    const owner = Object.assign(new EventEmitter(), {
      getURL: () => 'file:///app/index.html#/workspace',
      isDestroyed: () => false
    }) as unknown as WebContents
    try {
      const id = await service.prepare(owner, { sessionId: 'known-session', shareContext: true })
      await expect(service.prepare(owner)).rejects.toThrow('current voice call')
      await service.start(id)
      expect(context).toHaveBeenCalledWith({ sessionId: 'known-session', shareContext: true })
      expect(received[0].session.instructions).toContain('approved limited history')
      const candidate = {
        type: 'response.function_call_arguments.done',
        call_id: 'request-1',
        name: 'delegate_to_work_session',
        arguments: JSON.stringify({ instruction: 'Review this change without editing' })
      }
      socket!.send(JSON.stringify(candidate))
      socket!.send(JSON.stringify(candidate))
      await vi.waitFor(() => expect(events.filter((e) => e.kind === 'work')).toHaveLength(1))
      expect(deliver).not.toHaveBeenCalled()
      const operation = events.find((e) => e.kind === 'work')!
      if (operation.kind !== 'work') throw new Error()
      expect(operation.operation.sessionId).toBe('known-session')
      await service.review(id, operation.operation.id, true)
      expect(deliver).toHaveBeenCalledWith('known-session', 'Review this change without editing')
      await expect(service.review(id, operation.operation.id, true)).rejects.toThrow('expired')
      expect(deliver).toHaveBeenCalledOnce()
      service.stop(id)
      await expect(service.review(id, operation.operation.id, true)).rejects.toThrow('expired')
      expect(canUseVoiceMicrophone(owner, 'media', { isMainFrame: true, mediaType: 'audio' })).toBe(
        false
      )
    } finally {
      service.dispose()
    }
  })
  it('fails a rejected voice setup without reporting a ready call', async () => {
    server.on('connection', (socket) =>
      socket.on('message', () =>
        socket.send(
          JSON.stringify({ type: 'error', error: { message: 'private credential details' } })
        )
      )
    )
    const service = new LiveVoiceService(
      new JsonStore(path.join(temp, 'voice.json'), {
        ...DEFAULT_VOICE,
        enabled: true,
        endpoint: url().replace('ws:', 'http:').replace('/v1/racp/ws', '/v1')
      }),
      () => undefined
    )
    secrets.set('live-voice', 'fixture')
    const contents = Object.assign(new EventEmitter(), {
      getURL: () => 'file:///app/index.html',
      isDestroyed: () => false
    }) as unknown as WebContents
    try {
      await expect(service.start(await service.prepare(contents))).rejects.toThrow('during setup')
    } finally {
      service.dispose()
    }
  })
})
