import { ref } from 'vue'
import type {
  VoicePreparation,
  VoicePublicSettings,
  VoiceWorkOperation
} from '@shared/agent-settings/schema'
import { getApi } from '@renderer/composables/useApi'
import captureUrl from './pcm-capture.js?url&no-inline'

function createVoiceCall() {
  const phase = ref<'ended' | 'connecting' | 'listening'>('ended'),
    muted = ref(false),
    error = ref('')
  const transcript = ref<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const settings = ref<VoicePublicSettings | null>(null)
  const preparation = ref<VoicePreparation>({})
  const operations = ref<VoiceWorkOperation[]>([])
  const detailsOpen = ref(false),
    userSpeaking = ref(false),
    assistantSpeaking = ref(false)
  let peer: RTCPeerConnection | null = null,
    channel: RTCDataChannel | null = null,
    output: HTMLAudioElement | null = null
  async function loadSettings() {
    settings.value = await getApi().agentSettings.voice.get()
  }
  let callId: string | null = null,
    generation = 0,
    stream: MediaStream | null = null,
    context: AudioContext | null = null
  let processor: AudioWorkletNode | null = null,
    input: MediaStreamAudioSourceNode | null = null,
    nextAudio = 0,
    queuedFrames = 0
  const sources = new Set<AudioBufferSourceNode>()
  function clearAudio() {
    for (const source of sources) {
      source.onended = null
      try {
        source.stop()
      } catch {
        /* already ended */
      }
    }
    sources.clear()
    nextAudio = 0
  }
  async function stop() {
    generation++
    const id = callId
    callId = null
    channel?.close()
    channel = null
    peer?.close()
    peer = null
    if (output) {
      output.pause()
      output.srcObject = null
      output = null
    }
    userSpeaking.value = false
    assistantSpeaking.value = false
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    processor?.disconnect()
    processor = null
    input?.disconnect()
    input = null
    clearAudio()
    const ctx = context
    context = null
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined)
    phase.value = 'ended'
    muted.value = false
    if (id)
      await getApi()
        .agentSettings.voice.stop(id)
        .catch(() => undefined)
  }
  const unsubscribe = getApi().agentSettings.voice.onEvent((event) => {
    if (event.callId !== callId) return
    if (event.kind === 'error') {
      error.value = event.message
      void stop()
    } else if (event.kind === 'ended') void stop()
    else if (event.kind === 'interrupted') {
      clearAudio()
      assistantSpeaking.value = false
    } else if (event.kind === 'activity') {
      if (event.userSpeaking !== undefined) userSpeaking.value = event.userSpeaking
      if (event.assistantSpeaking !== undefined) assistantSpeaking.value = event.assistantSpeaking
    } else if (event.kind === 'work') {
      const index = operations.value.findIndex((operation) => operation.id === event.operation.id)
      if (index < 0) {
        operations.value.push(event.operation)
        detailsOpen.value = true
      } else operations.value[index] = event.operation
    } else if (event.kind === 'signal') {
      if (channel?.readyState === 'open' && channel.bufferedAmount < 262144)
        channel.send(event.message)
    } else if (event.kind === 'transcript')
      transcript.value = [...transcript.value.slice(-99), { role: event.role, text: event.text }]
    else if (event.kind === 'audio' && context) {
      try {
        const raw = atob(event.data)
        if (!raw.length || raw.length % 2) return
        const ctx = context
        if (nextAudio - ctx.currentTime > 5)
          throw new Error('Audio playback is too far behind. Start a new call.')
        const view = new DataView(new ArrayBuffer(raw.length))
        for (let i = 0; i < raw.length; i++) view.setUint8(i, raw.charCodeAt(i))
        const buffer = ctx.createBuffer(1, raw.length / 2, 24000),
          samples = buffer.getChannelData(0)
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)
        sources.add(source)
        assistantSpeaking.value = true
        source.onended = () => {
          sources.delete(source)
          if (!sources.size) assistantSpeaking.value = false
        }
        nextAudio = Math.max(ctx.currentTime + 0.02, nextAudio)
        source.start(nextAudio)
        nextAudio += buffer.duration
      } catch {
        error.value = 'Audio playback failed. Start a new call.'
        void stop()
      }
    }
  })
  async function start(microphoneError: string, prepInput: VoicePreparation = {}) {
    if (phase.value !== 'ended') return
    const ticket = ++generation
    phase.value = 'connecting'
    error.value = ''
    transcript.value = []
    operations.value = []
    preparation.value = { ...prepInput }
    queuedFrames = 0
    try {
      await loadSettings()
      const prepared = await getApi().agentSettings.voice.prepare(prepInput)
      if (ticket !== generation) {
        await getApi().agentSettings.voice.stop(prepared)
        return
      }
      callId = prepared
      let media: MediaStream
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        })
      } catch {
        throw new Error(microphoneError)
      }
      if (ticket !== generation) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      stream = media
      if (settings.value?.adapter === 'codex-live') {
        const pc = new RTCPeerConnection()
        peer = pc
        const audio = new Audio()
        audio.autoplay = true
        output = audio
        pc.ontrack = (event) => {
          if (ticket !== generation) return
          audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
          void audio.play().catch(() => {
            if (ticket === generation) error.value = 'Click Resume audio to hear the call.'
          })
        }
        for (const track of media.getTracks()) pc.addTrack(track, media)
        const dc = pc.createDataChannel('oai-events')
        channel = dc
        dc.onmessage = (event) => {
          if (
            ticket !== generation ||
            typeof event.data !== 'string' ||
            event.data.length > 65536 ||
            !callId
          )
            return
          void getApi()
            .agentSettings.voice.signal(callId, event.data)
            .catch(() => {
              if (ticket === generation) void stop()
            })
        }
        dc.onclose = () => {
          if (ticket === generation) void stop()
        }
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        if (ticket !== generation) return
        const result = await getApi().agentSettings.voice.start(prepared, offer.sdp)
        if (ticket !== generation) return
        if (!result?.answerSdp) throw new Error('Voice connection ended during setup.')
        await pc.setRemoteDescription({ type: 'answer', sdp: result.answerSdp })
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            pc.onconnectionstatechange = null
            reject(new Error('Voice connection timed out.'))
          }, 15000)
          const check = () => {
            if (pc.connectionState === 'connected' && dc.readyState === 'open') {
              clearTimeout(timer)
              resolve()
            } else if (['failed', 'closed'].includes(pc.connectionState)) {
              clearTimeout(timer)
              reject(new Error('Voice connection ended.'))
            }
          }
          pc.onconnectionstatechange = check
          dc.onopen = check
          check()
        })
        pc.onconnectionstatechange = () => {
          if (
            ticket === generation &&
            ['failed', 'disconnected', 'closed'].includes(pc.connectionState)
          ) {
            error.value = 'Voice connection interrupted.'
            void stop()
          }
        }
        if (ticket === generation) phase.value = 'listening'
        return
      }
      const ctx = new AudioContext({ sampleRate: 24000 })
      context = ctx
      await ctx.resume()
      await ctx.audioWorklet.addModule(captureUrl)
      if (ticket !== generation) return
      processor = new AudioWorkletNode(ctx, 'harness-pcm-capture')
      input = ctx.createMediaStreamSource(media)
      processor.port.onmessage = (event) => {
        if (muted.value || phase.value !== 'listening' || ticket !== generation || !callId) return
        if (queuedFrames > 4) {
          error.value = 'Voice connection cannot keep up. Start a new call.'
          void stop()
          return
        }
        const bytes = new Uint8Array(event.data as ArrayBuffer)
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        queuedFrames++
        void getApi()
          .agentSettings.voice.audio(callId, btoa(binary))
          .catch((cause) => {
            if (ticket !== generation) return
            error.value = (cause as { message?: string }).message ?? microphoneError
            void stop()
          })
          .finally(() => {
            if (ticket === generation) queuedFrames--
          })
      }
      input.connect(processor)
      processor.connect(ctx.destination)
      await getApi().agentSettings.voice.start(prepared)
      if (ticket === generation) phase.value = 'listening'
    } catch (cause) {
      if (ticket !== generation) return
      error.value = (cause as { message?: string }).message ?? microphoneError
      await stop()
    }
  }
  function toggleMute() {
    muted.value = !muted.value
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted.value
    })
  }
  async function review(operationId: string, accept: boolean) {
    if (!callId) return
    try {
      await getApi().agentSettings.voice.review(callId, operationId, accept)
    } catch {
      error.value = 'Voice request expired. Start a new call.'
    }
  }
  function resumeAudio() {
    const ticket = generation
    const failed = () => {
      if (ticket === generation)
        error.value = 'Audio playback is blocked. Check your audio device and try again.'
    }
    void output
      ?.play()
      .then(() => {
        if (ticket === generation) error.value = ''
      })
      .catch(failed)
    void context?.resume().catch(failed)
  }
  function dismiss() {
    error.value = ''
    detailsOpen.value = false
    transcript.value = []
    operations.value = []
  }
  function dispose() {
    unsubscribe()
    void stop()
  }
  return {
    phase,
    muted,
    error,
    transcript,
    settings,
    preparation,
    operations,
    detailsOpen,
    userSpeaking,
    assistantSpeaking,
    start,
    stop,
    toggleMute,
    loadSettings,
    review,
    resumeAudio,
    dismiss,
    dispose
  }
}

let shared: ReturnType<typeof createVoiceCall> | undefined
export function useVoiceCall() {
  return (shared ??= createVoiceCall())
}
