import net from 'node:net'
import { randomUUID } from 'node:crypto'

/** Uses Pi's public extension API. No upstream patches or duplicated agent loop. */
export default async function desktopExtension(pi) {
  const endpoint = process.env.PI_HARNESS_DESKTOP_SOCKET
  const token = process.env.PI_HARNESS_DESKTOP_TOKEN
  if (!endpoint || !token) throw new Error('Desktop extension requires an authenticated host')
  const socket = net.createConnection(endpoint)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.setEncoding('utf8')
  socket.write(JSON.stringify({ token }) + '\n')
  let buffer = ''
  let disposing = false
  let context
  let forceEmpty = false
  const pending = new Map()
  const send = (value) => socket.write(JSON.stringify(value) + '\n')
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Desktop host request timed out'))
      }, 30_000)
      pending.set(id, { resolve, reject, timer })
      send({ type: 'request', id, method, params })
    })
  socket.on('error', () => {})
  socket.on('close', () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error('Desktop host disconnected'))
    }
    pending.clear()
    if (!disposing) {
      context?.abort()
      context?.shutdown()
    }
  })
  async function handle(method, params) {
    if (!context) throw new Error('Desktop extension is not ready')
    if (method === 'snapshot')
      return {
        tools: pi.getAllTools().map((tool) => ({
          name: tool.name,
          description: tool.description,
          active: pi.getActiveTools().includes(tool.name)
        })),
        contextUsage: context.getContextUsage() ?? null,
        idle: context.isIdle(),
        entries: context.sessionManager.getEntries().map((entry) => ({
          id: entry.id,
          parentId: entry.parentId,
          type: entry.type,
          timestamp: entry.timestamp,
          ...('message' in entry ? { message: { role: entry.message.role } } : {})
        })),
        branch: context.sessionManager.getBranch().map((entry) => ({ id: entry.id })),
        leafId: context.sessionManager.getLeafId(),
        sessionFile: context.sessionManager.getSessionFile(),
        sessionId: context.sessionManager.getSessionId(),
        sessionName: pi.getSessionName()
      }
    if (method === 'set_tools') {
      forceEmpty = params.toolNames.length === 0
      const coding = new Set(['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls'])
      const preserved =
        params.preserveExtensionTools && !forceEmpty
          ? pi.getActiveTools().filter((name) => !coding.has(name))
          : []
      pi.setActiveTools([...new Set([...params.toolNames, ...preserved])])
      return null
    }
    if (method === 'abort_compaction') {
      context.abort()
      return null
    }
    throw new Error('Unsupported desktop extension operation')
  }
  socket.on('data', (chunk) => {
    buffer += chunk
    if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) {
      socket.destroy()
      return
    }
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        socket.destroy()
        return
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        socket.destroy()
        return
      }
      if (msg.type === 'response') {
        const item = pending.get(msg.id)
        if (!item) continue
        clearTimeout(item.timer)
        pending.delete(msg.id)
        if (msg.error) item.reject(new Error(msg.error))
        else item.resolve(msg.data)
      } else if (msg.type === 'request')
        void handle(msg.method, msg.params).then(
          (data) => send({ type: 'response', id: msg.id, data }),
          () => send({ type: 'response', id: msg.id, error: 'Desktop extension operation failed' })
        )
    }
  })
  const definitions = await request('tools')
  for (const tool of definitions)
    pi.registerTool({
      ...tool,
      execute: async (id, params, signal) => {
        signal?.throwIfAborted()
        const result = await request('execute', { name: tool.name, id, input: params })
        signal?.throwIfAborted()
        return result
      }
    })
  pi.on('session_start', async (_event, ctx) => {
    context = ctx
    await request('ready', { sessionId: ctx.sessionManager.getSessionId() })
  })
  pi.on('before_agent_start', async (event) => {
    const data = await request('context')
    return {
      systemPrompt: forceEmpty
        ? ''
        : [event.systemPrompt, data.prompt, data.architectureHint].filter(Boolean).join('\n\n')
    }
  })
  pi.on('tool_call', async (event, ctx) => {
    try {
      ctx.signal?.throwIfAborted()
      await request('guard', { name: event.toolName, input: event.input })
      return undefined
    } catch {
      return { block: true, reason: 'Tool access was denied by the desktop workspace policy' }
    }
  })
  // Lifecycle navigation requires the public command-capable context.
  pi.registerCommand(`desktop-${token.slice(0, 12)}`, {
    description: 'Desktop session navigation',
    handler: async (args, ctx) => {
      const data = JSON.parse(args)
      try {
        if (data.method !== 'navigate_tree') throw new Error('Unsupported operation')
        const result = await ctx.navigateTree(data.targetId, {})
        await request('command_result', { id: data.id, data: result })
      } catch {
        await request('command_result', { id: data.id, error: 'Session navigation failed' })
      }
    }
  })
  pi.on('session_shutdown', () => {
    disposing = true
    socket.end()
  })
}
