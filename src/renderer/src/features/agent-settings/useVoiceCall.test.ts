import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  get: vi.fn(),
  stop: vi.fn(async () => undefined),
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
