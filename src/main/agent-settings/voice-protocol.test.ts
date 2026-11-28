import { describe, expect, it } from 'vitest'
import { voiceSetup, voiceInput, normalizeSdp, voiceInstructions } from './voice-protocol'
import { DEFAULT_VOICE } from './voice-service'

describe('live voice protocols', () => {
  it('configures GA, compatibility and Gemini with review-only work delegation', () => {
    expect(voiceSetup(DEFAULT_VOICE, 'instructions', true)).toMatchObject({
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        tools: [{ name: 'delegate_to_work_session' }]
      }
    })
    expect(
      voiceSetup({ ...DEFAULT_VOICE, profile: 'realtime-compat-v1' }, 'instructions', false)
    ).toMatchObject({ session: { modalities: ['text', 'audio'], input_audio_format: 'pcm16' } })
    const gemini = voiceSetup(
      { ...DEFAULT_VOICE, adapter: 'gemini-live', model: 'fixture', voice: 'Kore' },
      'instructions',
      true
    )
    expect(gemini).toMatchObject({
      setup: {
        model: 'models/fixture',
        tools: [{ functionDeclarations: [{ name: 'delegate_to_work_session' }] }]
      }
    })
    expect(JSON.stringify(gemini)).not.toContain('additionalProperties')
    expect(voiceInstructions('quoted history', 'known')).toContain(
      'received does not mean execution started'
    )
    expect(voiceInstructions('', undefined)).toContain('No conversation history was shared.')
  })
  it('keeps continuous PCM duration when resampling microphone frames for Gemini', () => {
    const settings = { ...DEFAULT_VOICE, adapter: 'gemini-live' as const },
      carry = { remainder: Buffer.alloc(0) }
    let size = 0
    for (let i = 0; i < 3; i++) {
      const message = voiceInput(settings, Buffer.alloc(4096), carry) as {
        realtimeInput: { audio: { data: string; mimeType: string } }
      }
      size += Buffer.from(message.realtimeInput.audio.data, 'base64').length
      expect(message.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000')
    }
    expect(size).toBe(8192)
    expect(carry.remainder.length).toBe(0)
  })
  it('creates a Doubao session with a client session id, 16 kHz input and 24 kHz output', () => {
    const settings = {
      ...DEFAULT_VOICE,
      adapter: 'doubao-realtime' as const,
      profile: undefined,
      model: '1.3.0.0',
      voice: 'zh_female_vv_jupiter_bigtts'
    }
    const setup = voiceSetup(settings, 'instructions', true) as {
      type: string
      session: Record<string, any>
    }
    expect(setup.type).toBe('session.create')
    expect(setup.session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(setup.session.model).toBe('1.3.0.0')
    expect(setup.session.instructions).toBe('instructions')
    expect(setup.session.audio.input.format).toEqual({ type: 'pcm', rate: 16000 })
    expect(setup.session.audio.output.format).toEqual({ type: 'pcm_s16le', rate: 24000 })
    expect(setup.session.audio.output.voice).toBe('zh_female_vv_jupiter_bigtts')
    expect(setup.session.tools).toMatchObject([{ name: 'delegate_to_work_session' }])
    const bare = voiceSetup(settings, 'instructions', false) as {
      session: Record<string, any>
    }
    expect(bare.session.tools).toBeUndefined()
    const again = voiceSetup(settings, 'instructions', true) as { session: Record<string, any> }
    expect(again.session.id).not.toBe(setup.session.id)
    expect(JSON.stringify(setup)).not.toMatch(/speed|loudness/)
  })
  it('keeps continuous PCM duration when resampling microphone frames for Doubao', () => {
    const settings = {
        ...DEFAULT_VOICE,
        adapter: 'doubao-realtime' as const,
        profile: undefined
      },
      carry = { remainder: Buffer.alloc(0) }
    let size = 0
    for (let i = 0; i < 3; i++) {
      const message = voiceInput(settings, Buffer.alloc(4096), carry) as {
        type: string
        audio: string
      }
      expect(message.type).toBe('input_audio_buffer.append')
      size += Buffer.from(message.audio, 'base64').length
    }
    expect(size).toBe(8192)
    expect(carry.remainder.length).toBe(0)
  })
  it('bounds SDP answers and accepts both raw and JSON provider responses', () => {
    expect(normalizeSdp('v=0\no=fixture\n')).toBe('v=0\r\no=fixture\r\n')
    expect(normalizeSdp(JSON.stringify({ sdp: 'v=0\r\no=fixture\r\n' }))).toContain('v=0\r\n')
    expect(() => normalizeSdp('not SDP')).toThrow()
    expect(() => normalizeSdp('v=0\n' + 'a'.repeat(262144))).toThrow()
    expect(() => normalizeSdp('v=0\n\0')).toThrow()
  })
})
