/** Format algorithms adapted from CCHV acdfaea9 (MIT); see NOTICE. */
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  universalMessageSchema,
  universalSessionSchema,
  type SourceProvider,
  type UniversalMessage,
  type UniversalSession
} from '@shared/universal/schema'
import { array, iso, object, parts, redact, serialized, string, usage } from './normalize'

export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
export interface ParsedSession {
  session: UniversalSession
  messages: UniversalMessage[]
}
export interface ParseInput {
  provider: SourceProvider
  file: string
  root: string
  fingerprint: string
  mtime: string
  records: unknown[]
  recordNumbers?: number[]
  projectPath?: string
  nativeId?: string
  title?: string
  warnings?: string[]
}
export function parseSession(input: ParseInput): ParsedSession {
  const { provider, records } = input
  const recognized = records.some((raw) => {
    const r = object(raw)
    if (provider === 'codex')
      return ['session_meta', 'response_item', 'event_msg', 'turn_context'].includes(
        string(r.type) ?? ''
      )
    if (provider === 'gemini')
      return (
        Boolean(r.sessionId && r.projectHash) ||
        ['user', 'gemini', 'info', 'warning', 'error'].includes(string(r.type) ?? '')
      )
    if (provider === 'pi') return r.type === 'session' || r.type === 'message'
    if (provider === 'cursor') return r.type === 1 || r.type === 2
    if (provider === 'opencode') return Boolean(r.id && r.role)
    return Boolean(r.message && (r.role || r.type))
  })
  if (records.length && !recognized) throw new Error('SOURCE_FORMAT_ERROR')
  const warnings = [...(input.warnings ?? [])]
  let nativeId = input.nativeId ?? path.basename(input.file).replace(/\.(?:jsonl|json|txt)$/, '')
  let projectPath = input.projectPath
  let title = input.title
  let model: string | undefined
  let createdAt: string | undefined
  let recordedUpdated: string | undefined
  const intermediate: Array<Omit<UniversalMessage, 'sessionId'>> = []
  const seen = new Set<string>()
  const sensitiveCalls = new Set<string>()
  const usageByNativeId = new Map<string, UniversalMessage['parts'][number]>()
  const hasCodexResponses = records.some(
    (r) => object(r).type === 'response_item' && object(object(r).payload).type === 'message'
  )
  records.forEach((raw, index) => {
    const r = object(raw)
    let m = r
    let role: UniversalMessage['role'] = 'system'
    let content: unknown
    let supplemental: unknown[] = []
    let isMessage = false
    if (provider === 'claude' || provider === 'cursor-agent' || provider === 'pi') {
      if (r.cwd) projectPath ??= string(r.cwd)
      if (r.sessionId || r.type === 'session') nativeId = string(r.sessionId ?? r.id) ?? nativeId
      if (r.type === 'session') createdAt = iso(r.timestamp)
      if (r.type === 'session_info') title = string(r.name)
      if (r.type === 'model_change') model = string(r.modelId)
      m = object(r.message)
      const rawRole = string(m.role ?? r.role ?? r.type)
      if (['user', 'assistant', 'toolResult', 'tool', 'system'].includes(rawRole ?? '')) {
        role = rawRole === 'toolResult' ? 'tool' : (rawRole as UniversalMessage['role'])
        content = m.content ?? r.content
        if (provider === 'cursor-agent' && Array.isArray(content)) {
          const cleaned = content.flatMap((block) => {
            const b = object(block)
            if (b.type === 'redacted' || b.text === '[REDACTED]') return []
            if (role === 'user' && typeof b.text === 'string') {
              const query = b.text.match(/<user_query>([\s\S]*?)(?:<\/user_query>|$)/)
              if (query) return [{ ...b, text: query[1]!.trim() }]
            }
            return [block]
          })
          if (!cleaned.length) return
          content = cleaned
        }
        if (role === 'tool')
          content = { type: 'toolResult', toolCallId: m.toolCallId, content, isError: m.isError }
        model = string(m.model) ?? model
        isMessage = true
      }
      if (r.type === 'summary') {
        content = string(r.summary)
        isMessage = true
      }
    } else if (provider === 'codex') {
      m = object(r.payload)
      if (r.type === 'session_meta') {
        nativeId = string(m.id) ?? nativeId
        projectPath = string(m.cwd) ?? projectPath
        createdAt = iso(m.timestamp ?? r.timestamp)
      }
      if (r.type === 'turn_context') {
        model = string(m.model) ?? model
        projectPath ??= string(m.cwd)
      }
      if (r.type === 'response_item') {
        const t = string(m.type)
        if (t === 'message') {
          role = ['user', 'assistant', 'system'].includes(string(m.role) ?? '')
            ? (m.role as UniversalMessage['role'])
            : 'system'
          content = m.content
        } else if (t === 'reasoning')
          content = {
            type: 'thinking',
            thinking: array(m.summary)
              .concat(array(m.content))
              .map((x) => string(object(x).text) ?? '')
              .join('\n')
          }
        else content = m
        if (t?.endsWith('_output')) role = 'tool'
        else if (t !== 'message') role = 'assistant'
        isMessage = true
      } else if (r.type === 'event_msg') {
        if (['user_message', 'agent_message'].includes(string(m.type) ?? '')) {
          if (hasCodexResponses) return
          role = m.type === 'user_message' ? 'user' : 'assistant'
          content = m.message
          isMessage = true
        } else if (m.type === 'token_count') {
          // These are cumulative totals, handled once below to avoid double counting.
          return
        } else {
          content = m
          isMessage = true
        }
      }
    } else if (provider === 'gemini') {
      if (r.$set) {
        recordedUpdated = iso(object(r.$set).lastUpdated) ?? recordedUpdated
        return
      }
      if (r.sessionId && r.projectHash) {
        nativeId = string(r.sessionId) ?? nativeId
        title = string(r.summary) ?? title
        createdAt = iso(r.startTime)
        recordedUpdated = iso(r.lastUpdated)
        return
      }
      const t = string(r.type)
      role = t === 'gemini' ? 'assistant' : t === 'user' ? 'user' : 'system'
      content = t === 'error' ? { type: 'error', content: r.content } : r.content
      model = string(r.model) ?? model
      supplemental = array(r.thoughts).map((t) => ({
        type: 'thinking',
        thinking: [object(t).subject, object(t).description].filter(Boolean).join('\n')
      }))
      for (const call of array(r.toolCalls)) {
        const c = object(call)
        supplemental.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args })
        if (c.result !== undefined)
          supplemental.push({
            type: 'tool_result',
            tool_use_id: c.id,
            content: c.result,
            is_error: c.status === 'error'
          })
        if (c.resultDisplay !== undefined) supplemental.push(c.resultDisplay)
      }
      isMessage = Boolean(r.id)
    } else if (provider === 'opencode') {
      role = r.role === 'assistant' ? 'assistant' : r.role === 'user' ? 'user' : 'system'
      content = r.parts ?? r.content
      model = string(r.modelID ?? object(r.model).modelID) ?? model
      isMessage = true
    } else if (provider === 'cursor') {
      role = r.type === 1 ? 'user' : 'assistant'
      const t = object(r.toolFormerData)
      if (Object.keys(t).length) {
        content = [
          { type: 'tool_use', id: t.toolCallId ?? r.bubbleId, name: t.name, input: t.rawArgs },
          {
            type: 'tool_result',
            tool_use_id: t.toolCallId ?? r.bubbleId,
            content: r.text,
            is_error: ['error', 'rejected'].includes(string(t.status) ?? '')
          }
        ]
      } else content = { type: r.isThought ? 'thinking' : 'text', text: r.text ?? r.content }
      supplemental = array(r.images).map((reference) => ({
        type: 'input_image',
        image_url: reference
      }))
      model = string(r.model) ?? model
      isMessage = true
    }
    if (!isMessage) {
      // Preserve unknown native events by reference instead of silently discarding them.
      if (
        Object.keys(r).length &&
        !['session_meta', 'turn_context', 'session', 'model_change'].includes(string(r.type) ?? '')
      ) {
        content = r
        isMessage = true
      }
    }
    if (!isMessage) return
    const nativeMessageId = string(r.uuid ?? r.id ?? r.bubbleId ?? m.id)
    const messageId = nativeMessageId ?? `record-${index}`
    if (seen.has(messageId)) return
    seen.add(messageId)
    const timestamp = iso(r.timestamp ?? m.timestamp ?? r.createdAt ?? object(r.time).created)
    const normalized = [
      ...parts(content),
      ...parts(supplemental),
      ...usage(m.usage ?? r.usage ?? r.tokens)
    ]
    for (const p of normalized) {
      if (
        p.type === 'tool-call' &&
        /(?:\.env\b|\bprintenv\b|\benv\b|credentials|oauth|id_rsa|id_ed25519|\.pem\b|private.?key)/i.test(
          p.input
        )
      )
        sensitiveCalls.add(p.callId)
      if (p.type === 'tool-result' && sensitiveCalls.has(p.callId))
        p.text = '[REDACTED SENSITIVE TOOL OUTPUT]'
    }
    if (provider === 'claude' && typeof m.id === 'string') {
      const currentUsage = normalized.find((p) => p.type === 'usage')
      if (currentUsage) {
        const previousUsage = usageByNativeId.get(m.id)
        if (previousUsage && previousUsage.type === 'usage')
          Object.assign(previousUsage, currentUsage)
        else usageByNativeId.set(m.id, currentUsage)
        if (previousUsage) normalized.splice(normalized.indexOf(currentUsage), 1)
      }
    }
    if (!normalized.length)
      normalized.push({
        type: 'native-event',
        eventType: string(r.type) ?? 'unknown',
        text: serialized(r).slice(0, 8000)
      })
    intermediate.push({
      id: messageId,
      role,
      timestamp,
      parts: normalized,
      nativeMessageId,
      sourceRef: `${input.file}#record=${input.recordNumbers?.[index] ?? index + 1}`
    })
  })
  if (provider === 'codex') {
    const tokenRecord = [...records]
      .reverse()
      .find((r) => object(object(r).payload).type === 'token_count')
    if (tokenRecord && intermediate.length) {
      const info = object(object(object(tokenRecord).payload).info)
      intermediate[intermediate.length - 1]!.parts.push(
        ...usage(info.total_token_usage ?? info.last_token_usage)
      )
    }
  }
  // Logs may be out of order: redact results after collecting every sensitive call.
  for (const m of intermediate)
    for (const p of m.parts)
      if (p.type === 'tool-result' && sensitiveCalls.has(p.callId))
        p.text = '[REDACTED SENSITIVE TOOL OUTPUT]'
  const id = hash(`${provider}\0${nativeId}\0${projectPath ?? input.root}`)
  // Sorting is stable; mixed/undated logs retain their original event order.
  if (intermediate.every((m) => m.timestamp))
    intermediate.sort((a, b) => a.timestamp!.localeCompare(b.timestamp!))
  const messages = intermediate.map((m) => universalMessageSchema.parse({ ...m, sessionId: id }))
  const firstUserText = messages
    .find((m) => m.role === 'user')
    ?.parts.find((p) => p.type === 'text')
  title ??= firstUserText?.type === 'text' ? firstUserText.text.trim().slice(0, 100) : nativeId
  const usages = messages.flatMap((m) => m.parts).filter((p) => p.type === 'usage')
  const tokens = usages.reduce((sum, u) => sum + (u.total ?? (u.input ?? 0) + (u.output ?? 0)), 0)
  const costs = usages.filter((u) => u.cost !== undefined)
  const timestamps = messages.flatMap((m) => (m.timestamp ? [m.timestamp] : [])).sort()
  if (messages.some((m) => m.parts.some((p) => p.type === 'native-event')))
    warnings.push('NATIVE_EVENTS_RETAINED')
  const session = universalSessionSchema.parse({
    id,
    schemaVersion: 1,
    provider,
    nativeSessionId: nativeId,
    title: redact(title),
    projectPath,
    createdAt: createdAt ?? timestamps[0] ?? input.mtime,
    updatedAt: recordedUpdated ?? timestamps.at(-1) ?? input.mtime,
    model,
    messageCount: messages.length,
    source: {
      path: input.file,
      root: input.root,
      format: path.extname(input.file).slice(1) || 'sqlite',
      fingerprint: input.fingerprint,
      status: 'available',
      syncedAt: new Date().toISOString()
    },
    metadata: {
      tokens: usages.length ? tokens : undefined,
      cost: costs.length ? costs.reduce((sum, u) => sum + (u.cost ?? 0), 0) : undefined,
      hasToolCalls: messages.some((m) => m.parts.some((p) => p.type === 'tool-call'))
    },
    warnings: [...new Set(warnings)],
    blob: hash(JSON.stringify(messages))
  })
  return { session, messages }
}
