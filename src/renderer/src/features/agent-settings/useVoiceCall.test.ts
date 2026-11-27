import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  get: vi.fn(),
  stop: vi.fn(async () => undefined),
  start: vi.fn<(callId: string, offerSdp?: string) => Promise<void>>(),
  mute: vi.fn<(callId: string, muted: boolean) => Promise<void>>(),
  onEvent: vi.fn(() => () => undefined)
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
    vi.stubGlobal('navigator', {
      language: 'en-US',
      mediaDevices: { getUserMedia: microphone }
    })
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
    vi.stubGlobal('navigator', {
      language: 'en-US',
      mediaDevices: { getUserMedia: microphone }
    })
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
  it('turns mapped provider error codes into localized guidance', async () => {
    vi.resetModules()
    vi.stubGlobal('navigator', { language: 'en-US' })
    const { voiceErrorMessage } = await import('./useVoiceCall')
    const { i18n } = await import('@renderer/i18n')
    const localized = (code?: string, message = 'provider text') =>
      voiceErrorMessage({ callId: 'fixture-call', kind: 'error', message, code })
    expect(localized('45000003')).toContain('microphone stream stopped while unmuted')
    expect(localized('DOUBAO_KEY_REJECTED')).toContain('independent API key')
    expect(localized('DOUBAO_SERVICE_NOT_GRANTED')).toContain('Seed-Realtime')
    expect(localized('SOMETHING_ELSE')).toBe('provider text')
    expect(localized()).toBe('provider text')
    i18n.global.locale.value = 'zh-CN'
    expect(localized('45000003')).toContain('（45000003）')
    expect(localized('DOUBAO_SERVICE_NOT_GRANTED')).toContain('端到端实时音视频通话')
    expect(localized('DOUBAO_KEY_REJECTED')).toContain('API Key')
    i18n.global.locale.value = 'en-US'
  })
  it('commits the protocol mute before the frames stop, and restores frames before unmuting', async () => {
    vi.resetModules()
    mocks.get.mockResolvedValue(settings)
    mocks.prepare.mockResolvedValue('fixture-call')
    mocks.start.mockResolvedValue(undefined)
    const track = { enabled: true, stop: vi.fn() }
    vi.stubGlobal('navigator', {
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })) }
    })
    class FakeAudioContext {
      sampleRate = 24000
      currentTime = 0
      state = 'running'
      destination = {}
      resume = async () => undefined
      close = async () => undefined
      audioWorklet = { addModule: async () => undefined }
      createMediaStreamSource = () => ({ connect: () => undefined, disconnect: () => undefined })
      createBuffer = () => ({ getChannelData: () => new Float32Array(0) })
      createBufferSource = () => ({
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined
      })
    }
    class FakeAudioWorkletNode {
      port = { onmessage: null, postMessage: () => undefined }
      connect = () => undefined
      disconnect = () => undefined
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const { useVoiceCall } = await import('./useVoiceCall')
    const voice = useVoiceCall()
    await voice.start('Microphone denied', { sessionId: 'bound' })
    expect(voice.phase.value).toBe('listening')
    let commitMute!: () => void
    mocks.mute.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          commitMute = resolve
        })
    )
    const muting = voice.toggleMute()
    // Until the protocol mute is committed, the mic and uplink frames keep running.
    expect(mocks.mute).toHaveBeenCalledWith('fixture-call', true)
    expect(voice.muted.value).toBe(false)
    expect(track.enabled).toBe(true)
    commitMute()
    await muting
    expect(voice.muted.value).toBe(true)
    expect(track.enabled).toBe(false)
    // Unmuting is the reverse: frames resume first, the provider unmute follows.
    const unmuting = voice.toggleMute()
    expect(voice.muted.value).toBe(false)
    expect(track.enabled).toBe(true)
    await unmuting
    expect(mocks.mute).toHaveBeenLastCalledWith('fixture-call', false)
    voice.dispose()
  })
  it('keeps the frames flowing when the protocol mute fails', async () => {
    vi.resetModules()
    mocks.get.mockResolvedValue(settings)
    mocks.prepare.mockResolvedValue('fixture-call')
    mocks.start.mockResolvedValue(undefined)
    const track = { enabled: true, stop: vi.fn() }
    vi.stubGlobal('navigator', {
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })) }
    })
    class FakeAudioContext {
      sampleRate = 24000
      currentTime = 0
      state = 'running'
      destination = {}
      resume = async () => undefined
      close = async () => undefined
      audioWorklet = { addModule: async () => undefined }
      createMediaStreamSource = () => ({ connect: () => undefined, disconnect: () => undefined })
      createBuffer = () => ({ getChannelData: () => new Float32Array(0) })
      createBufferSource = () => ({
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined
      })
    }
    class FakeAudioWorkletNode {
      port = { onmessage: null, postMessage: () => undefined }
      connect = () => undefined
      disconnect = () => undefined
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const { useVoiceCall } = await import('./useVoiceCall')
    const voice = useVoiceCall()
    await voice.start('Microphone denied', { sessionId: 'bound' })
    mocks.mute.mockRejectedValueOnce(new Error('bridge down'))
    await voice.toggleMute()
    expect(voice.muted.value).toBe(false)
    expect(track.enabled).toBe(true)
    expect(voice.error.value).toContain('Muting failed')
    voice.dispose()
  })
})
