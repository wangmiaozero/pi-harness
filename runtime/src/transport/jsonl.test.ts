import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { createLineReader, createStdoutWriter, logDiagnostic } from './jsonl.js'

describe('createLineReader', () => {
  it('yields non-empty lines and skips blank ones', async () => {
    const input = new PassThrough()
    input.write('{"id":"1"}\n\n')
    input.write('{"id":"2"}\r\n')
    input.end()
    const lines: string[] = []
    for await (const item of createLineReader(input).read()) {
      if (item.kind === 'line') lines.push(item.line)
    }
    expect(lines).toEqual(['{"id":"1"}', '{"id":"2"}'])
  })

  it('emits a violation for oversized lines', async () => {
    const input = new PassThrough()
    input.write(`${'x'.repeat(5 * 1024 * 1024)}\n`)
    input.write('ok\n')
    input.end()
    const kinds: string[] = []
    for await (const item of createLineReader(input).read()) {
      kinds.push(item.kind)
    }
    expect(kinds).toEqual(['violation', 'line'])
  })

  it('ends cleanly when the stream closes without a trailing newline', async () => {
    const input = new PassThrough()
    input.write('partial')
    input.end()
    const lines: string[] = []
    for await (const item of createLineReader(input).read()) {
      if (item.kind === 'line') lines.push(item.line)
    }
    expect(lines).toEqual(['partial'])
  })
})

describe('createStdoutWriter', () => {
  it('frames each message with a newline', () => {
    const output = new PassThrough()
    const chunks: string[] = []
    output.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
    const writer = createStdoutWriter(output)
    writer.write('{"id":"1","result":{}}')
    writer.write('{"id":"2","result":{}}')
    expect(chunks).toEqual(['{"id":"1","result":{}}\n', '{"id":"2","result":{}}\n'])
  })
})

describe('logDiagnostic', () => {
  it('writes to stderr with a prefix', () => {
    const original = process.stderr.write.bind(process.stderr)
    const captured: string[] = []
    process.stderr.write = ((chunk: unknown) => {
      captured.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      logDiagnostic('hello')
    } finally {
      process.stderr.write = original
    }
    expect(captured).toEqual(['[pi-harness-runtime] hello\n'])
  })
})
