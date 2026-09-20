import { describe, expect, it } from 'vitest'
import {
  parseHostRequest,
  parseRuntimeMessage,
  serializeEvent,
  serializeRequest,
  serializeResponse
} from './messages.js'

describe('parseHostRequest', () => {
  it('parses a valid request', () => {
    const parsed = parseHostRequest('{"id":"req_1","method":"runtime.ping","params":{}}')
    expect(parsed).toEqual({
      ok: true,
      request: { id: 'req_1', method: 'runtime.ping', params: {} }
    })
  })

  it('accepts a request without params', () => {
    const parsed = parseHostRequest('{"id":"req_1","method":"runtime.version"}')
    expect(parsed.ok).toBe(true)
  })

  it('rejects non-JSON lines without an id', () => {
    const parsed = parseHostRequest('not json')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.id).toBeNull()
      expect(parsed.error.code).toBe('INVALID_REQUEST')
    }
  })

  it('rejects an invalid method but keeps the id', () => {
    const parsed = parseHostRequest('{"id":"req_2","method":"nope"}')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.id).toBe('req_2')
      expect(parsed.error.code).toBe('INVALID_REQUEST')
    }
  })

  it('rejects non-object params', () => {
    const parsed = parseHostRequest('{"id":"req_3","method":"runtime.ping","params":[1]}')
    expect(parsed.ok).toBe(false)
  })

  it('rejects an empty id', () => {
    const parsed = parseHostRequest('{"id":"","method":"runtime.ping"}')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.id).toBeNull()
  })

  it('accepts namespaced method names with dashes and underscores', () => {
    const parsed = parseHostRequest('{"id":"a","method":"agent.command-fork"}')
    expect(parsed.ok).toBe(true)
  })
})

describe('parseRuntimeMessage', () => {
  it('parses a success response', () => {
    const message = parseRuntimeMessage('{"id":"req_1","result":{"pong":true}}')
    expect(message).toEqual({ id: 'req_1', result: { pong: true } })
  })

  it('parses an error response', () => {
    const message = parseRuntimeMessage(
      '{"id":"req_1","error":{"code":"METHOD_NOT_FOUND","message":"Unknown method"}}'
    )
    expect(message).toEqual({
      id: 'req_1',
      error: { code: 'METHOD_NOT_FOUND', message: 'Unknown method' }
    })
  })

  it('parses an event envelope', () => {
    const message = parseRuntimeMessage('{"type":"event","event":"runtime.ready","payload":{}}')
    expect(message).toEqual({ type: 'event', event: 'runtime.ready', payload: {} })
  })

  it('rejects a message carrying both result and error', () => {
    expect(parseRuntimeMessage('{"id":"req_1","result":{},"error":{}}')).toBeNull()
  })

  it('rejects garbage and non-objects', () => {
    expect(parseRuntimeMessage('garbage')).toBeNull()
    expect(parseRuntimeMessage('[1,2]')).toBeNull()
    expect(parseRuntimeMessage('42')).toBeNull()
  })

  it('rejects an unknown error code', () => {
    expect(parseRuntimeMessage('{"id":"x","error":{"code":"WEIRD","message":"m"}}')).toBeNull()
  })
})

describe('serialisers round-trip', () => {
  it('serialises and parses a request', () => {
    const line = serializeRequest({ id: 'r1', method: 'runtime.ping', params: { a: 1 } })
    expect(JSON.parse(line)).toEqual({ id: 'r1', method: 'runtime.ping', params: { a: 1 } })
  })

  it('serialises success and failure responses', () => {
    expect(JSON.parse(serializeResponse('r1', { ok: true, result: 7 }))).toEqual({
      id: 'r1',
      result: 7
    })
    expect(
      JSON.parse(
        serializeResponse('r1', { ok: false, error: { code: 'INTERNAL_ERROR', message: 'x' } })
      )
    ).toEqual({ id: 'r1', error: { code: 'INTERNAL_ERROR', message: 'x' } })
  })

  it('serialises events with and without payload', () => {
    expect(JSON.parse(serializeEvent('runtime.ready'))).toEqual({
      type: 'event',
      event: 'runtime.ready'
    })
    expect(JSON.parse(serializeEvent('runtime.ready', { a: 1 }))).toEqual({
      type: 'event',
      event: 'runtime.ready',
      payload: { a: 1 }
    })
  })
})
