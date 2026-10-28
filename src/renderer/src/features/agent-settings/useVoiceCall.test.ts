import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  get: vi.fn(),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  onEvent: vi.fn((_listener: unknown) => () => undefined)
}))
vi.mock('@renderer/composables/useApi', () => ({
  getApi: () => ({ agentSettings: { voice: mocks } })
}))
const settings = {
  enabled: true,
  endpoint: 'https://fixture.test/v1',
  model: 'fixture',
  voice: 'fixture',
  profile: 'realtime-ga',
  hasCredential: true
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('voice audio playback resilience', () => {
  // Drives the full non-codex start path with a fake AudioContext whose clock
  // never advances, then feeds events through the captured onEvent listener.
  async function startCall() {
    vi.resetModules()
    mocks.get.mockResolvedValue(settings)
    mocks.prepare.mockResolvedValue('fixture-call')
    mocks.start.mockResolvedValue(undefined)
    let listener!: (event: Record<string, unknown>) => void
    mocks.onEvent.mockImplementation((fn: unknown) => {
      listener = fn as typeof listener
      return () => undefined
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const clock = { now: 0 }
    const scheduled: Array<Record<string, unknown>> = []
    class FakeAudioContext {
      destination = {}
      state = 'running'
      get currentTime() {
        return clock.now
      }
      async resume() {}
      audioWorklet = { addModule: async () => undefined }
      createMediaStreamSource = () => ({ connect() {}, disconnect() {} })
      createBuffer = (_channels: number, length: number, rate: number) => ({
        duration: length / rate,
        getChannelData: () => new Float32Array(length)
      })
      createBufferSource = () => {
        const source: Record<string, unknown> = {
          buffer: null,
          onended: null,
          startedAt: 0,
          connect() {},
          start(when: number) {
            source.startedAt = when
          },
          stop() {
            source.stopped = true
          }
        }
        scheduled.push(source)
        return source
      }
      async close() {}
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port = { onmessage: null }
        connect() {}
        disconnect() {}
      }
    )
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () =>
          ({
            getTracks: () => [{ stop() {} }],
            getAudioTracks: () => [{ enabled: true, stop() {} }]
          }) as unknown as MediaStream
      }
    })
    const { useVoiceCall } = await import('./useVoiceCall')
    const voice = useVoiceCall()
    await voice.start('Microphone denied')
    await vi.waitFor(() => expect(voice.phase.value).toBe('listening'))
    return {
      voice,
      emit: (event: Record<string, unknown>) => listener({ callId: 'fixture-call', ...event }),
      warn,
      scheduled,
      clock,
      dispose: () => voice.dispose()
    }
  }
  it('plays through provider bursts without skipping reply openings', async () => {
    const harness = await startCall()
    try {
      // Each chunk is 240000 bytes = 5 s of 24 kHz int16; with a frozen clock six
      // chunks queue 30 s ahead — a normal Doubao burst that must play in full,
      // because dropping already-arrived audio skips the reply opening.
      const chunk = Buffer.alloc(240000).toString('base64')
      for (let i = 0; i < 6; i++) harness.emit({ kind: 'audio', data: chunk })
      await Promise.resolve()
      expect(harness.voice.error.value).toBe('')
      expect(harness.voice.phase.value).toBe('listening')
      expect(harness.scheduled.length).toBe(6)
      expect(harness.scheduled.filter((source) => source.stopped).length).toBe(0)
    } finally {
      harness.dispose()
    }
  })
  it('still skips when the queue is pathologically far ahead', async () => {
    const harness = await startCall()
    try {
      // 25 s chunks overshoot the 30 s bug-guard on the second chunk.
      const chunk = Buffer.alloc(1200000).toString('base64')
      harness.emit({ kind: 'audio', data: chunk })
      harness.emit({ kind: 'audio', data: chunk })
      harness.emit({ kind: 'audio', data: chunk })
      await Promise.resolve()
      expect(harness.voice.error.value).toBe('')
      expect(harness.voice.phase.value).toBe('listening')
      expect(harness.scheduled.filter((source) => source.stopped).length).toBeGreaterThanOrEqual(1)
    } finally {
      harness.dispose()
    }
  })
  it('drops a single undecodable chunk without killing the call', async () => {
    const harness = await startCall()
    try {
      const chunk = Buffer.alloc(1920).toString('base64')
      harness.emit({ kind: 'audio', data: '!!!not-base64!!!' })
      harness.emit({ kind: 'audio', data: chunk })
      await Promise.resolve()
      expect(harness.voice.error.value).toBe('')
      expect(harness.voice.phase.value).toBe('listening')
      expect(harness.warn).toHaveBeenCalledOnce()
    } finally {
      harness.dispose()
    }
  })
  it('still fails the call after systematic playback failures', async () => {
    const harness = await startCall()
    try {
      for (let i = 0; i < 8; i++) harness.emit({ kind: 'audio', data: '!!!not-base64!!!' })
      await vi.waitFor(() => expect(harness.voice.phase.value).toBe('ended'))
      expect(harness.voice.error.value).toBe('Audio playback failed. Start a new call.')
      expect(mocks.stop).toHaveBeenCalledWith('fixture-call')
    } finally {
      harness.dispose()
    }
  })
})
describe('voice capture ownership', () => {
  it('releases a microphone granted after the user has cancelled the call', async () => {
    vi.resetModules()
    mocks.get.mockResolvedValue(settings)
    mocks.prepare.mockResolvedValue('fixture-call')
    let grant!: (media: MediaStream) => void
    const microphone = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          grant = resolve
        })
    )
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } })
    const { useVoiceCall } = await import('./useVoiceCall')
    const voice = useVoiceCall(),
      trackStop = vi.fn()
    const started = voice.start('Microphone denied', { sessionId: 'bound', shareContext: true })
    await vi.waitFor(() => expect(microphone).toHaveBeenCalledOnce())
    await voice.stop()
    grant({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream)
    await started
    expect(trackStop).toHaveBeenCalledOnce()
    expect(voice.phase.value).toBe('ended')
    expect(mocks.prepare).toHaveBeenCalledWith({ sessionId: 'bound', shareContext: true })
    expect(mocks.stop).toHaveBeenCalledWith('fixture-call')
    voice.dispose()
  })
  it('cancels a late capture lease before asking for microphone access', async () => {
    vi.resetModules()
    mocks.get.mockResolvedValue(settings)
    let prepared!: (id: string) => void
    mocks.prepare.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          prepared = resolve
        })
    )
    const microphone = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } })
    const { useVoiceCall } = await import('./useVoiceCall')
    const voice = useVoiceCall(),
      started = voice.start('Microphone denied')
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
    await voice.stop()
    prepared('late-call')
    await started
    expect(microphone).not.toHaveBeenCalled()
    expect(mocks.stop).toHaveBeenCalledWith('late-call')
    expect(voice.phase.value).toBe('ended')
    voice.dispose()
  })
})
