import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import WebSocket from 'ws'
import type { VoiceEvent, VoicePublicSettings, VoiceSettings } from '@shared/agent-settings/schema'
import { voiceSettingsSchema } from '@shared/agent-settings/schema'
import { JsonStore } from '../services/storage'
import { secretStore } from '../security/secret-store'
import { ConfigError } from '../services/errors'
import { openSocket } from './socket'
import {
  normalizeSdp,
  voiceSetup,
  voiceInput,
  voiceInstructions,
  workArguments
} from './voice-protocol'
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
import type { DoubaoEvent } from './voice-doubao'
import type { VoicePreparation, VoiceWorkOperation } from '@shared/agent-settings/schema'

export const DEFAULT_VOICE: VoiceSettings = {
  enabled: false,
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-realtime',
  voice: 'marin',
  profile: 'realtime-ga'
}

let captureLease: { contents: WebContents; url: string; expires: number } | null = null
export function canUseVoiceMicrophone(
  contents: WebContents | null,
  permission: string,
  details: unknown
): boolean {
  const d = details as {
    isMainFrame?: boolean
    mediaTypes?: string[]
    mediaType?: string
    requestingUrl?: string
    securityOrigin?: string
  }
  if (
    permission !== 'media' ||
    !contents ||
    !captureLease ||
    captureLease.contents !== contents ||
    captureLease.expires < Date.now() ||
    contents.isDestroyed() ||
    d.isMainFrame !== true
  )
    return false
  // The grant is audio-only and bound to the current trusted renderer document.
  if (contents.getURL().split('#')[0] !== captureLease.url.split('#')[0]) return false
  if (d.requestingUrl && d.requestingUrl.split('#')[0] !== captureLease.url.split('#')[0])
    return false
  if (d.mediaTypes) return d.mediaTypes.length === 1 && d.mediaTypes[0] === 'audio'
  return d.mediaType === 'audio'
}

export interface VoiceHost {
  hasCredential(settings: VoiceSettings): Promise<boolean>
  resolve(settings: VoiceSettings): Promise<{ key: string; endpoint?: string; accountId?: string }>
  context(input: VoicePreparation): Promise<string>
  deliver(sessionId: string, instruction: string): Promise<void>
}
type Call = {
  id: string
  owner: WebContents
  socket: WebSocket | null
  ready: boolean
  starting: boolean
  expires: ReturnType<typeof setTimeout>
  bytes: number
  window: number
  cleanupOwner: () => void
  settings: VoiceSettings
  preparation: VoicePreparation
  instructions: string
  controller: AbortController
  activeResponse?: string
  interruptedResponses: Set<string>
  interrupted: boolean
  turnTranscript: { user: string; assistant: string }
  pcmCarry: { remainder: Buffer }
  requests: Set<string>
  operations: Map<string, VoiceWorkOperation>
  feedback: Map<string, string>
}
export class LiveVoiceService {
  private call: Call | null = null
  constructor(
    private store: JsonStore<VoiceSettings>,
    private emit: (event: VoiceEvent) => void,
    private credentialSlot = 'live-voice',
    private host?: VoiceHost
  ) {}
  private credential(settings: VoiceSettings): string {
    return settings.adapter === 'gemini-live'
      ? `${this.credentialSlot}-gemini`
      : settings.adapter === 'doubao-realtime'
        ? `${this.credentialSlot}-doubao`
        : this.credentialSlot
  }
  async settings(): Promise<VoicePublicSettings> {
    const settings = voiceSettingsSchema.parse(await this.store.read())
    return {
      ...settings,
      hasCredential:
        settings.providerKey || settings.adapter === 'codex-live'
          ? Boolean(await this.host?.hasCredential(settings))
          : Boolean(await secretStore.getSecret(this.credential(settings), { strict: true }))
    }
  }
  async save(settings: VoiceSettings & { apiKey?: string }): Promise<VoicePublicSettings> {
    if (this.call) throw new ConfigError('End the voice call before changing its settings.')
    if (settings.apiKey)
      await secretStore.setSecret(this.credential(settings), settings.apiKey, { strict: true })
    const { apiKey: _apiKey, ...publicSettings } = settings
    void _apiKey
    await this.store.write(voiceSettingsSchema.parse(publicSettings))
    return this.settings()
  }
  async prepare(owner: WebContents, preparation: VoicePreparation = {}): Promise<string> {
    if (this.call) throw new ConfigError('End the current voice call first.')
    const settings = voiceSettingsSchema.parse(await this.store.read())
    if (!settings.enabled) throw new ConfigError('Enable realtime voice in Settings first.')
    const context = this.host ? await this.host.context(preparation) : ''
    // Async reads above must not let concurrent prepares replace the microphone owner.
    if (this.call) throw new ConfigError('A voice call is already active.')
    const id = randomUUID()
    captureLease = { contents: owner, url: owner.getURL(), expires: Date.now() + 30000 }
    const onDestroyed = () => this.stop(id)
    const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) this.stop(id)
    }
    owner.once('destroyed', onDestroyed)
    owner.once('render-process-gone', onDestroyed)
    owner.on('did-start-navigation', onNavigate)
    this.call = {
      id,
      owner,
      socket: null,
      ready: false,
      starting: false,
      expires: setTimeout(() => this.stop(id), 30000),
      bytes: 0,
      window: Date.now(),
      settings,
      preparation,
      // Doubao has no function calling, so its instructions never promise delegation.
      instructions: voiceInstructions(
        context,
        settings.adapter === 'doubao-realtime' ? undefined : preparation.sessionId
      ),
      controller: new AbortController(),
      interruptedResponses: new Set(),
      interrupted: false,
      turnTranscript: { user: '', assistant: '' },
      pcmCarry: { remainder: Buffer.alloc(0) },
      requests: new Set(),
      operations: new Map(),
      feedback: new Map(),
      cleanupOwner: () => {
        owner.off('destroyed', onDestroyed)
        owner.off('render-process-gone', onDestroyed)
        owner.off('did-start-navigation', onNavigate)
      }
    }
    return id
  }
  async start(id: string, offerSdp?: string): Promise<{ answerSdp: string } | void> {
    const call = this.call
    if (!call || call.id !== id || call.starting)
      throw new ConfigError('Voice call expired. Start a new call.')
    call.starting = true
    try {
      const settings = call.settings
      const auth: { key: string | null; endpoint?: string; accountId?: string } | undefined =
        settings.providerKey || settings.adapter === 'codex-live'
          ? await this.host?.resolve(settings)
          : { key: await secretStore.getSecret(this.credential(settings), { strict: true }) }
      if (!auth?.key) throw new ConfigError('Add a realtime voice account or API key first.')
      if (this.call !== call) return
      if (settings.adapter === 'codex-live') {
        if (!offerSdp || !auth.accountId) throw new ConfigError('Sign in to Codex in Pi first.')
        const timeout = setTimeout(() => call.controller.abort(), 15000)
        try {
          const response = await fetch(
            'https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas',
            {
              method: 'POST',
              redirect: 'error',
              signal: call.controller.signal,
              headers: {
                Authorization: `Bearer ${auth.key}`,
                'chatgpt-account-id': auth.accountId,
                originator: 'pi',
                'x-session-id': randomUUID(),
                'user-agent': 'pi-codex-conversion',
                'openai-alpha': 'quicksilver=v2',
                'content-type': 'application/json'
              },
              body: JSON.stringify({
                sdp: normalizeSdp(offerSdp),
                session: {
                  model: 'gpt-live-1-codex',
                  instructions: call.instructions,
                  audio: { output: { voice: settings.voice } },
                  delegation: { type: 'client', ack_filler: false }
                }
              })
            }
          )
          if (response.status !== 201) {
            await response.body?.cancel()
            throw new Error()
          }
          const reader = response.body?.getReader()
          if (!reader) throw new Error()
          let raw = '',
            size = 0
          const decoder = new TextDecoder()
          try {
            for (;;) {
              const part = await reader.read()
              if (part.done) break
              size += part.value.length
              if (size > 262144) {
                await reader.cancel()
                throw new Error()
              }
              raw += decoder.decode(part.value, { stream: true })
            }
            raw += decoder.decode()
          } finally {
            reader.releaseLock()
          }
          const answerSdp = normalizeSdp(raw)
          if (this.call !== call) return
          this.ready(call)
          return { answerSdp }
        } finally {
          clearTimeout(timeout)
        }
      }
      if (settings.adapter === 'doubao-realtime') {
        const credentials = parseDoubaoCredentials(auth.key)
        if (this.call !== call) return
        const socket = await openSocket(DOUBAO_PROTOCOL.url, doubaoHeaders(credentials))
        if (this.call !== call || call.owner.isDestroyed()) {
          socket.terminate()
          return
        }
        call.socket = socket
        socket.on('message', (data) => {
          if (this.call !== call) return
          try {
            this.doubaoMessage(
              call,
              Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
            )
          } catch {
            this.fail(call, 'Invalid voice response.')
          }
        })
        socket.on('close', () => {
          if (this.call === call) this.stop(id)
        })
        socket.on('error', () => this.fail(call, 'Voice connection interrupted.'))
        // One-shot handshake: session.create doubles as connection setup;
        // readiness arrives with session.created through doubaoMessage below.
        const confirmed = this.confirmSetup(call, socket)
        socket.send(doubaoSetup(call.settings, call.instructions).payload)
        await confirmed
        return
      }
      const endpoint =
        settings.adapter === 'gemini-live'
          ? new URL(
              'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
            )
          : new URL((auth.endpoint ?? settings.endpoint).replace(/\/$/, '') + '/realtime')
      endpoint.protocol = ['https:', 'wss:'].includes(endpoint.protocol) ? 'wss:' : 'ws:'
      if (settings.adapter === 'gemini-live') endpoint.searchParams.set('key', auth.key)
      else endpoint.searchParams.set('model', settings.model)
      const socket = await openSocket(
        endpoint.toString(),
        settings.adapter === 'gemini-live'
          ? {}
          : {
              Authorization: `Bearer ${auth.key}`,
              ...(settings.profile === 'realtime-compat-v1' ? { 'OpenAI-Beta': 'realtime=v1' } : {})
            }
      )
      if (this.call !== call || call.owner.isDestroyed()) {
        socket.terminate()
        return
      }
      call.socket = socket
      socket.on('message', (data, binary) => {
        if (this.call !== call) return
        try {
          if (binary && settings.adapter !== 'gemini-live') throw new Error()
          this.message(call, JSON.parse(data.toString()))
        } catch {
          this.fail(call, 'Invalid voice response.')
        }
      })
      socket.on('close', () => {
        if (this.call === call) this.stop(id)
      })
      socket.on('error', () => this.fail(call, 'Voice connection interrupted.'))
      // Install readiness listeners before sending setup; no socket-open success shortcut.
      const confirmed = this.confirmSetup(call, socket)
      socket.send(
        JSON.stringify(voiceSetup(settings, call.instructions, Boolean(call.preparation.sessionId)))
      )
      await confirmed
    } catch (e) {
      this.stop(id)
      throw e instanceof ConfigError
        ? e
        : new ConfigError('Unable to start realtime voice. Check the account and voice settings.')
    }
  }
  // Readiness wait shared by the WS transports: resolve on the first message after
  // ready flips, reject on timeout or early close.
  private confirmSetup(call: Call, socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new ConfigError('Voice setup timed out.'))
      }, 15000)
      const check = () => {
        if (call.ready) {
          cleanup()
          resolve()
        }
      }
      const closed = () => {
        cleanup()
        reject(new ConfigError('Voice connection ended during setup.'))
      }
      const cleanup = () => {
        clearTimeout(timer)
        socket.off('message', check)
        socket.off('close', closed)
      }
      socket.on('message', check)
      socket.once('close', closed)
    })
  }
  private ready(call: Call): void {
    if (call.ready || this.call !== call) return
    call.ready = true
    clearTimeout(call.expires)
    call.expires = setTimeout(() => this.stop(call.id), 30 * 60 * 1000)
    this.emit({ callId: call.id, kind: 'ready' })
  }
  private fail(call: Call, message: string): void {
    if (this.call !== call) return
    this.emit({ callId: call.id, kind: 'error', message })
    this.stop(call.id)
  }
  // All peer data is bounded by the socket/data-channel limits and parsed here in Main.
  private message(call: Call, m: Record<string, any>): void {
    if (!m || typeof m !== 'object') throw new Error()
    const send = (event: Omit<VoiceEvent, 'callId'>) =>
      this.emit({ callId: call.id, ...event } as VoiceEvent)
    const transcript = (role: 'user' | 'assistant', text: unknown) => {
      if (typeof text === 'string' && text.length)
        this.emit({ callId: call.id, kind: 'transcript', role, text: text.slice(0, 20000) })
    }
    const audio = (data: unknown) => {
      if (
        call.ready &&
        typeof data === 'string' &&
        data.length <= 512000 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(data)
      )
        this.emit({ callId: call.id, kind: 'audio', data })
    }
    if (m.error || m.type === 'error' || m.goAway)
      return this.fail(
        call,
        'Voice provider rejected or ended the call. Check the account and model.'
      )
    if (m.setupComplete !== undefined && call.settings.adapter === 'gemini-live') this.ready(call)
    if (m.type === 'session.updated' && call.settings.adapter !== 'codex-live') {
      const s = m.session
      const valid =
        call.settings.profile === 'realtime-ga'
          ? s?.type === 'realtime' &&
            s.audio?.input?.format?.rate === 24000 &&
            s.audio?.output?.format?.rate === 24000 &&
            s.audio?.output?.voice === call.settings.voice
          : s?.input_audio_format === 'pcm16' &&
            s.output_audio_format === 'pcm16' &&
            s.voice === call.settings.voice
      if (!valid) throw new Error()
      this.ready(call)
    }
    if (m.type === 'response.created' && typeof m.response?.id === 'string') {
      call.activeResponse = m.response.id
      call.interrupted = false
    }
    const staleResponse =
      typeof m.response_id === 'string' && call.interruptedResponses.has(m.response_id)
    if (
      ['response.audio.delta', 'response.output_audio.delta'].includes(m.type) &&
      !call.interrupted &&
      !staleResponse
    )
      audio(m.delta)
    if (m.type === 'input_audio_buffer.speech_started' || m.serverContent?.interrupted) {
      if (call.activeResponse) {
        call.interruptedResponses.add(call.activeResponse)
        if (call.interruptedResponses.size > 256)
          call.interruptedResponses.delete(call.interruptedResponses.values().next().value!)
      }
      call.interrupted = true
      send({ kind: 'interrupted' })
      this.emit({ callId: call.id, kind: 'activity', userSpeaking: true, assistantSpeaking: false })
    }
    if (m.type === 'input_audio_buffer.speech_stopped')
      this.emit({ callId: call.id, kind: 'activity', userSpeaking: false })
    if (m.type === 'conversation.item.input_audio_transcription.completed')
      transcript('user', m.transcript)
    if (
      !staleResponse &&
      ['response.audio_transcript.done', 'response.output_audio_transcript.done'].includes(m.type)
    )
      transcript('assistant', m.transcript)
    if (m.type === 'input_transcript.added') transcript('user', m.text)
    if (m.type === 'output_transcript.added') transcript('assistant', m.text)
    if (m.type === 'response.function_call_arguments.done') {
      let args: unknown
      try {
        args =
          typeof m.arguments === 'string' && m.arguments.length <= 10000
            ? JSON.parse(m.arguments)
            : null
      } catch {
        args = null
      }
      this.candidate(call, m.call_id, m.name, args)
    }
    if (
      m.type === 'delegation.created' &&
      m.item?.type === 'delegation' &&
      m.item.target === 'client'
    ) {
      const text = Array.isArray(m.item.content)
        ? m.item.content
            .filter((p: any) => p.type === 'input_text' && typeof p.text === 'string')
            .map((p: any) => p.text)
            .join('')
        : ''
      this.candidate(call, m.item.id, 'delegate_to_work_session', { instruction: text })
    }
    if (call.settings.adapter === 'gemini-live') {
      const c = m.serverContent
      if (c) {
        for (const part of (c.modelTurn?.parts ?? []).slice(0, 32)) {
          if (part.inlineData) {
            if (part.inlineData.mimeType !== 'audio/pcm;rate=24000') throw new Error()
            audio(part.inlineData.data)
          }
        }
        if (typeof c.inputTranscription?.text === 'string')
          call.turnTranscript.user = (call.turnTranscript.user + c.inputTranscription.text).slice(
            0,
            20000
          )
        if (typeof c.outputTranscription?.text === 'string')
          call.turnTranscript.assistant = (
            call.turnTranscript.assistant + c.outputTranscription.text
          ).slice(0, 20000)
        if (c.turnComplete || c.interrupted) {
          transcript('user', call.turnTranscript.user)
          transcript('assistant', call.turnTranscript.assistant)
          call.turnTranscript = { user: '', assistant: '' }
        }
      }
      for (const fn of (m.toolCall?.functionCalls ?? []).slice(0, 16))
        this.candidate(call, fn.id, fn.name, fn.args)
    }
  }
  // Doubao transport: every inbound WebSocket message is one JSON event frame.
  private doubaoMessage(call: Call, data: string | Buffer): void {
    let event: DoubaoEvent
    try {
      event = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'))
    } catch {
      throw new Error()
    }
    if (!event || typeof event !== 'object') throw new Error()
    const incoming = mapDoubaoEvent(event)
    const emit = (event: Record<string, unknown>) =>
      this.emit({ callId: call.id, ...event } as VoiceEvent)
    switch (incoming.kind) {
      case 'ready':
        return this.ready(call)
      case 'interrupt':
        // Server barge-in on the first recognized syllable; 3.0 asks the client to
        // confirm with response.cancel so the in-flight response stops generating.
        call.interrupted = true
        if (call.socket?.readyState === WebSocket.OPEN) call.socket.send(doubaoCancelEvent())
        emit({ kind: 'interrupted' })
        emit({ kind: 'activity', userSpeaking: true, assistantSpeaking: false })
        return
      case 'asr':
        // Streaming deltas accumulate; transcription.completed carries the settled
        // full text and is what gets flushed to the UI.
        call.turnTranscript.user = (call.turnTranscript.user + incoming.text).slice(0, 20000)
        return
      case 'asrEnded': {
        const text = incoming.text || call.turnTranscript.user
        call.turnTranscript.user = ''
        if (text) emit({ kind: 'transcript', role: 'user', text: text.slice(0, 20000) })
        return
      }
      case 'assistantDelta':
        call.turnTranscript.assistant = (call.turnTranscript.assistant + incoming.text).slice(
          0,
          20000
        )
        return
      case 'assistantDone': {
        const text = incoming.text || call.turnTranscript.assistant
        call.turnTranscript.assistant = ''
        if (text) emit({ kind: 'transcript', role: 'assistant', text: text.slice(0, 20000) })
        return
      }
      case 'audio': {
        // The delta payload is already base64 PCM @24 kHz; straight passthrough.
        if (call.ready && incoming.data.length <= 512000)
          emit({ kind: 'audio', data: incoming.data })
        return
      }
      case 'ended':
        return this.stop(call.id)
      case 'error':
        return this.fail(call, incoming.message)
      default:
        return
    }
  }
  private send(call: Call, message: unknown): void {
    if (this.call !== call || !call.ready) return
    if (call.settings.adapter === 'codex-live')
      this.emit({ callId: call.id, kind: 'signal', message: JSON.stringify(message) })
    else if (call.socket?.readyState === WebSocket.OPEN) call.socket.send(JSON.stringify(message))
  }
  private candidate(call: Call, request: unknown, name: unknown, args: unknown): void {
    if (
      !call.ready ||
      typeof request !== 'string' ||
      !request ||
      request.length > 256 ||
      call.requests.has(request)
    )
      return
    if (call.requests.size >= 256)
      return this.fail(call, 'Voice call reached its request limit. Start a new call.')
    call.requests.add(request)
    const parsed = workArguments.safeParse(args)
    const sessionId = call.preparation.sessionId
    const valid = name === 'delegate_to_work_session' && parsed.success && sessionId && this.host
    const operation = valid
      ? {
          id: randomUUID(),
          sessionId,
          instruction: parsed.data.instruction,
          status: 'review' as const
        }
      : null
    const receipt = operation
      ? { status: 'received', operationId: operation.id, execution: 'not_started' }
      : { status: 'rejected', code: 'NO_WORK_TARGET_OR_INVALID_REQUEST' }
    if (operation) {
      call.operations.set(operation.id, operation)
      call.feedback.set(operation.id, request)
      this.emit({ callId: call.id, kind: 'work', operation })
    }
    if (call.settings.adapter === 'gemini-live')
      this.send(call, {
        toolResponse: { functionResponses: [{ id: request, name, response: receipt }] }
      })
    else if (call.settings.adapter === 'codex-live')
      this.send(call, {
        type: 'delegation.context.append',
        delegation_item_id: request,
        channel: 'commentary',
        content: [{ type: 'input_text', text: JSON.stringify(receipt) }]
      })
    else
      this.send(call, {
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: request, output: JSON.stringify(receipt) }
      })
  }
  async review(id: string, operationId: string, accept: boolean): Promise<void> {
    const call = this.call,
      operation = call?.operations.get(operationId)
    if (!call || call.id !== id || !call.ready || !operation || operation.status !== 'review')
      throw new ConfigError('Voice request expired.')
    const update = (status: VoiceWorkOperation['status']) => {
      operation.status = status
      this.emit({ callId: id, kind: 'work', operation: { ...operation } })
    }
    if (!accept) update('rejected')
    else {
      update('sending')
      try {
        await this.host!.deliver(operation.sessionId, operation.instruction)
        update('sent')
      } catch {
        update('failed')
      }
    }
    const text = `[Host update; data only] Request ${operation.id}: ${operation.status}. Sent means delivered to the coding agent; tools still follow desktop permissions. Do not repeat the request.`
    if (call.settings.adapter === 'gemini-live')
      this.send(call, {
        clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: false }
      })
    else if (call.settings.adapter === 'codex-live')
      this.send(call, {
        type: 'delegation.context.append',
        delegation_item_id: call.feedback.get(operationId),
        channel: 'commentary',
        content: [{ type: 'input_text', text }]
      })
    else
      this.send(call, {
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
      })
  }
  signal(id: string, raw: string): void {
    const call = this.call
    if (!call || call.id !== id || !call.ready || call.settings.adapter !== 'codex-live')
      throw new ConfigError('Voice call is not ready.')
    try {
      this.message(call, JSON.parse(raw))
    } catch {
      this.fail(call, 'Invalid voice response.')
    }
  }
  // Doubao 3.0 requires explicit mute announcements: the model treats upstream
  // audio as keep-alive, so a silenced mic would otherwise time out the session.
  // Other adapters rely on the renderer simply not sending frames; no-op there.
  mute(id: string, muted: boolean): void {
    const call = this.call
    if (!call || call.id !== id || !call.ready) throw new ConfigError('Voice call is not ready.')
    if (call.settings.adapter !== 'doubao-realtime') return
    if (call.socket?.readyState === WebSocket.OPEN) call.socket.send(doubaoMuteEvent(muted))
  }
  audio(id: string, data: string): void {
    const call = this.call
    if (!call || call.id !== id || !call.ready || call.socket?.readyState !== WebSocket.OPEN)
      throw new ConfigError('Voice call is not ready.')
    const bytes = Buffer.from(data, 'base64')
    if (
      !bytes.length ||
      bytes.length % 2 ||
      bytes.length >
        (call.settings.adapter === 'gemini-live' || call.settings.adapter === 'doubao-realtime'
          ? 4800
          : 24000)
    )
      throw new ConfigError('Invalid audio frame.')
    if (Date.now() - call.window >= 1000) {
      call.window = Date.now()
      call.bytes = 0
    }
    call.bytes += bytes.length
    if (call.bytes > 192000 || call.socket.bufferedAmount > 512000) {
      this.stop(id)
      throw new ConfigError('Voice connection cannot keep up. Start a new call.')
    }
    call.socket.send(
      call.settings.adapter === 'doubao-realtime'
        ? doubaoAudioEvent(bytes, call.pcmCarry)
        : JSON.stringify(voiceInput(call.settings, bytes, call.pcmCarry))
    )
  }
  stop(id: string): void {
    if (this.call?.id !== id) return
    const call = this.call
    this.call = null
    captureLease = null
    clearTimeout(call.expires)
    call.controller.abort()
    call.cleanupOwner()
    // Doubao expects a graceful session close; best-effort only, because terminate
    // does not guarantee a flush.
    if (call.settings.adapter === 'doubao-realtime' && call.socket) {
      try {
        call.socket.send(doubaoCloseEvent())
      } catch {
        // Socket already dead; terminate below is the real teardown.
      }
    }
    call.socket?.terminate()
    this.emit({ callId: id, kind: 'ended' })
  }
  dispose(): void {
    if (this.call) this.stop(this.call.id)
    captureLease = null
  }
}
