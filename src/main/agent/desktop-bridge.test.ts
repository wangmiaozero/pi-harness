// @vitest-environment node
import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import { DesktopBridge } from './desktop-bridge'

it('shares concurrent bridge cleanup after rejecting pending extension requests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-close-'))
  let ready!: () => void
  const authenticated = new Promise<void>((resolve) => {
    ready = resolve
  })
  const bridge = new DesktopBridge(async () => {
    ready()
    return null
  })
  const remove = vi.spyOn(fs, 'rm')
  let socket: net.Socket | undefined
  try {
    const env = await bridge.start(root)
    socket = net.createConnection(env.PI_HARNESS_DESKTOP_SOCKET!)
    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', resolve)
      socket!.once('error', reject)
    })
    socket.write(JSON.stringify({ token: env.PI_HARNESS_DESKTOP_TOKEN }) + '\n')
    socket.write(JSON.stringify({ type: 'request', id: 'ready', method: 'ready' }) + '\n')
    await authenticated
    const pending = expect(bridge.request('snapshot')).rejects.toThrow('Desktop bridge closed')
    await Promise.all([bridge.close(), bridge.close()])
    await pending
    expect(remove).toHaveBeenCalledTimes(1)
    expect(await fs.readdir(root)).toEqual([])
    await bridge.close()
    expect(remove).toHaveBeenCalledTimes(1)
  } finally {
    socket?.destroy()
    await bridge.close()
    remove.mockRestore()
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
