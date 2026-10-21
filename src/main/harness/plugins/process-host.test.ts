// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { boundedJson, PluginProcessHost, type PluginTransport } from './process-host'

it('counts UTF-8 bytes when enforcing the process reply limit', () => {
  expect(() => boundedJson({ text: '文'.repeat(100000) })).toThrow('PLUGIN_OUTPUT_LIMIT')
})

it('rejects the in-flight request and removes listeners even if host diagnostics fails', async () => {
  let receive: (message: unknown) => void = () => {}
  const removeMessage = vi.fn(),
    removeExit = vi.fn(),
    kill = vi.fn(),
    fault = vi.fn()
  const transport: PluginTransport = {
    send: vi.fn(),
    onMessage(listener) {
      receive = listener
      return removeMessage
    },
    onExit() {
      return removeExit
    },
    kill
  }
  const process = new PluginProcessHost(transport, fault, () => {
    throw new Error('logger failure')
  })
  const pending = process.request('activate', {})
  const rejected = expect(pending).rejects.toThrow('PLUGIN_OUTPUT_LIMIT')
  receive({ id: 1, ok: true, logs: [{ message: 'hello', metadata: {} }] })
  await rejected
  expect(removeMessage).toHaveBeenCalledTimes(1)
  expect(removeExit).toHaveBeenCalledTimes(1)
  expect(kill).toHaveBeenCalledTimes(1)
  expect(fault).toHaveBeenCalledTimes(1)
  await expect(process.request('event', {})).rejects.toThrow('PLUGIN_PROCESS_STOPPED')
})
