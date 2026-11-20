import net from 'node:net'
import http from 'node:http'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { installCompactionPolicy } from './compaction.mjs'
import { installProviderSettings } from './provider-settings.mjs'
import { chatGptProviderSync } from './chatgpt-provider.mjs'
import { createToolSelection, listTools, ToolSelectionError } from './tool-selection.mjs'
import { compact } from '@earendil-works/pi-coding-agent'

function postToHost(url, token, headers, init) {
  const body = Buffer.from(init?.body ?? '')
  // Use a direct socket to the authenticated desktop host.
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      url,
      {
        method: 'POST',
        agent: false,
        signal: init?.signal,
        headers: { ...headers, authorization: `Bearer ${token}`, 'content-length': body.length }
      },
      (incoming) => {
        const status = incoming.statusCode
        const empty = status === 204 || status === 205 || status === 304
        if (empty) incoming.resume()
        resolve(
          new Response(empty ? null : Readable.toWeb(incoming), {
            status,
            headers: incoming.headers
          })
        )
      }
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}

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
  const toolSelection = createToolSelection(pi)
  const pending = new Map()
  const send = (value) => socket.write(JSON.stringify(value) + '\n')
  const request = (method, params = {}, options = {}) =>
    new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Desktop host request timed out'))
      }, options.timeoutMs ?? 30_000)
      pending.set(id, { resolve, reject, timer })
      send({ type: 'request', id, method, params })
    })
  installCompactionPolicy(
    pi,
    (model) =>
      request('summary_defaults', {
        provider: model.provider,
        id: model.id,
        baseUrl: model.baseUrl
      }),
    compact
  )
  let providerTransport
  const startProviderSettings = installProviderSettings(
    pi,
    (provider, baseUrl) => request('provider_settings', { provider, baseUrl }),
    {
      googleBaseUrl: (provider, baseUrl) => request('provider_google_base', { provider, baseUrl }),
      async list() {
        const [providers, keys] = await Promise.all([
          request('provider_list'),
          request('managed_provider_keys')
        ])
        return providers.map((provider) => {
          const entry = keys.find((item) => item.provider === provider.key && item.apiKey)
          if (!entry) return provider
          const apiKey = entry.apiKey.replaceAll('$', () => '$$').replace(/^!/, () => '$!')
          return { ...provider, apiKey, baseUrl: entry.baseUrl }
        })
      },
      async fetch(provider, baseUrl, input, init) {
        providerTransport ??= await request('chatgpt_transport')
        const url = new URL('/provider', providerTransport.url)
        const headers = {
          'x-provider-key': provider,
          'x-provider-base': baseUrl,
          'x-provider-target': String(input),
          'x-provider-headers': Buffer.from(
            JSON.stringify([...new Headers(init?.headers)])
          ).toString('base64url')
        }
        return postToHost(url, providerTransport.token, headers, init)
      },
      async acquire(provider, baseUrl, signal) {
        signal?.throwIfAborted()
        const id = randomUUID()
        const release = () => request('provider_release', { id }).catch(() => {})
        const cancel = () => void release()
        signal?.addEventListener('abort', cancel, { once: true })
        try {
          await request('provider_acquire', { provider, baseUrl, id }, { timeoutMs: 3_601_000 })
          signal?.throwIfAborted()
          return async () => {
            signal?.removeEventListener('abort', cancel)
            await release()
          }
        } catch (error) {
          signal?.removeEventListener('abort', cancel)
          await release()
          throw error
        }
      }
    }
  )
  let chatGptTransport
  const syncChatGpt = chatGptProviderSync(
    (provider) => pi.registerProvider(provider),
    (id) => pi.unregisterProvider(id),
    async () => (await request('chatgpt_accounts')) ?? [],
    async (id, modelId, init) => {
      chatGptTransport ??= await request('chatgpt_transport')
      const { url, token } = chatGptTransport
      return postToHost(url, token, { 'x-chatgpt-account': id, 'x-chatgpt-model': modelId }, init)
    }
  )
  let freeModelsStamp
  async function syncFreeModels() {
    const definition = await request('free_models')
    const stamp = JSON.stringify(definition)
    if (definition && stamp !== freeModelsStamp) {
      pi.registerProvider('pi-harness-free', definition)
      freeModelsStamp = stamp
    }
  }
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
    if (method === 'free_models_sync') return syncFreeModels()
    if (method === 'chatgpt_sync') return syncChatGpt()
    if (method === 'tools' || method === 'snapshot') {
      if (context.isIdle()) toolSelection.refresh()
      if (method === 'tools') return listTools(pi)
    }
    if (method === 'snapshot') {
      const settings = pi.getSettings?.() ?? {}
      const model = context.model
      const modelKey = model ? `${model.provider}/${model.id}` : undefined
      const override = modelKey ? settings.compaction?.modelOverrides?.[modelKey] : undefined
      const reserveTokens =
        override?.reserveTokens ??
        settings.compaction?.reserveTokens ??
        16_384
      return {
        tools: listTools(pi),
        contextUsage: context.getContextUsage() ?? null,
        reserveTokens,
        contextWindow: model?.contextWindow ?? null,
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
    }
    if (method === 'set_tools') {
      if (!context.isIdle())
        throw new ToolSelectionError('Wait for the current run to finish before changing tools')
      toolSelection.apply(params.toolNames, params)
      forceEmpty = params.toolNames.length === 0
      return {
        ...(params.custom ? { tools: listTools(pi) } : {}),
        suspension: toolSelection.suspension()
      }
    }
    if (method === 'abort_compaction') {
      context.abort()
      return null
    }
    if (method === 'set_permission_mode') {
      // Permission decisions are made by the host guard using the live session mode.
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
          (error) =>
            send({
              type: 'response',
              id: msg.id,
              error:
                error instanceof ToolSelectionError
                  ? error.message
                  : 'Desktop extension operation failed'
            })
        )
    }
  })
  await syncChatGpt()
  await syncFreeModels()
  for (const { provider, baseUrl, apiKey } of await request('managed_provider_keys')) {
    if (!apiKey || !baseUrl) continue
    // Pi's config values interpolate dollar signs and treat a leading ! as a command.
    const literal = apiKey.replaceAll('$', () => '$$').replace(/^!/, () => '$!')
    pi.registerProvider(provider, { apiKey: literal, baseUrl })
  }
  await startProviderSettings()
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
    const saved = await request('ready', { sessionId: ctx.sessionManager.getSessionId() })
    if (saved) {
      toolSelection.apply(saved.toolNames, { ...saved.options, restore: true })
      forceEmpty = saved.toolNames.length === 0
    }
  })
  pi.on('turn_end', () => toolSelection.refresh())
  pi.on('before_agent_start', async (event) => {
    toolSelection.refresh()
    const data = await request('context')
    return {
      systemPrompt: forceEmpty
        ? ''
        : [event.systemPrompt, data.prompt, data.architectureHint].filter(Boolean).join('\n\n')
    }
  })
  pi.on('tool_call', async (event, ctx) => {
    if (!toolSelection.allows(event.toolName))
      return { block: true, reason: 'Tool is disabled for this session' }
    try {
      ctx.signal?.throwIfAborted()
      await request('guard', { name: event.toolName, input: event.input }, { timeoutMs: 600_000 })
      ctx.signal?.throwIfAborted()
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
  pi.on('session_shutdown', async (event) => {
    disposing = true
    if (event.reason === 'reload' && !socket.destroyed) {
      // Pi loads the replacement extension immediately after this hook.
      await new Promise((resolve) => {
        socket.once('close', resolve)
        socket.end()
      })
    } else {
      socket.end()
    }
  })
}
