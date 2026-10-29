// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { PiRpcClient } from './pi-rpc-client'

const transport = vi.hoisted(() => ({ child: null as unknown }))
vi.mock('node:child_process', () => ({ spawn: () => transport.child }))
afterEach(() => {
  vi.useRealTimers()
})
it('releases request timers after a synchronous transport write failure without retrying', async () => {
  vi.useFakeTimers()
  const write = vi.fn(() => {
    throw new Error('write failed')
  })
  transport.child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { writable: true, write })
  })
  const client = new PiRpcClient()
  client.start('fixture', [], '/tmp', {})
  await expect(client.request({ type: 'prompt', message: 'side effect' })).rejects.toThrow(
    'write failed'
  )
  expect(vi.getTimerCount()).toBe(0)
  expect(write).toHaveBeenCalledTimes(1)
})

it('delivers a large fragmented RPC event exactly once', () => {
  const client = new PiRpcClient()
  const listener = vi.fn()
  client.onEvent(listener)
  const read = (client as unknown as { read: (chunk: string) => void }).read.bind(client)
  const line = JSON.stringify({ type: 'message_end', text: '图'.repeat(1_000_000) }) + '\n'
  const times: number[] = []
  for (let round = 0; round < 5; round++) {
    const start = performance.now()
    for (let offset = 0; offset < line.length; offset += 1024)
      read(line.slice(offset, offset + 1024))
    times.push(performance.now() - start)
  }
  expect(listener).toHaveBeenCalledTimes(5)
  expect(listener.mock.calls[0][0].text).toHaveLength(1_000_000)
  if (process.env.PI_HARNESS_RPC_BENCHMARK)
    process.stdout.write('RPC fragmented event milliseconds ' + JSON.stringify(times) + '\n')
})
