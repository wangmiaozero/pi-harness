import type { UniversalPart } from '@shared/universal/schema'

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
export function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
export function serialized(value: unknown): string {
  if (typeof value === 'string') return redact(value)
  return JSON.stringify(protectValue(value ?? null))
}
function protectValue(value: unknown, depth = 0): unknown {
  if (depth > 30) return '[DEPTH LIMIT]'
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map((v) => protectValue(v, depth + 1))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        /api.?key|access.?token|refresh.?token|(?:^|[_-])token(?:$|[_-])|authorization|password|secret|credential|cookie|oauth/i.test(
          key
        )
          ? '[REDACTED]'
          : protectValue(v, depth + 1)
      ])
    )
  return value
}

/** Applied before persistence, search, rendering and handing any context to Pi. */
export function redact(value: string): string {
  return value
    .replace(/```(?:env|dotenv|\.env)[^\n]*\n[\s\S]*?```/gi, '[REDACTED ENV]')
    .replace(/^[^\n]*\.env[^\n]*\n```[^\n]*\n[\s\S]*?```/gim, '[REDACTED ENV]')
    .replace(
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]'
    )
    .replace(
      /\b(?:sk-(?:proj-|ant-)?[\w-]{16,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|AIza[\w-]{20,})\b/g,
      '[REDACTED]'
    )
    .replace(/\bBearer\s+[\w.+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /(?<![\w-])((?:[\w-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|password|secret|credential|cookie|oauth[_-]?token)[\w-]*)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}\n]+)/gi,
      '$1[REDACTED]'
    )
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED JWT]')
    .replace(/(<(?:env|environment)>)[\s\S]*?(<\/(?:env|environment)>)/gi, '$1[REDACTED ENV]$2')
}
export function iso(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}
function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
export function usage(value: unknown): UniversalPart[] {
  const u = object(value)
  const p: UniversalPart = {
    type: 'usage',
    input: number(u.input_tokens ?? u.inputTokens ?? u.input),
    output: number(u.output_tokens ?? u.outputTokens ?? u.output),
    cached: number(
      u.cache_read_input_tokens ??
        u.cached_input_tokens ??
        u.cacheRead ??
        u.cached ??
        object(u.cache).read
    ),
    cacheWrite: number(u.cache_creation_input_tokens ?? u.cacheWrite ?? object(u.cache).write),
    reasoning: number(u.reasoning_tokens ?? u.thoughts ?? u.reasoning),
    total: number(u.total_tokens ?? u.totalTokens ?? u.total),
    cost: number(object(u.cost).total ?? u.cost)
  }
  return Object.entries(p).some(([key, v]) => key !== 'type' && v !== undefined) ? [p] : []
}
/** Known CLI-injected context is retained in history, but is not a user's task title/goal. */
export function userTaskText(value: string): string {
  return value
    .replace(
      /^\s*<external_codex_apps_open_page>([\s\S]*?)<\/external_codex_apps_open_page>\s*/,
      (block, payload: string) => {
        try {
          const data = object(JSON.parse(payload))
          return Object.keys(data).length === 1 &&
            (data.page_id === null || typeof data.page_id === 'string')
            ? ''
            : block
        } catch {
          return block
        }
      }
    )
    .replace(/^# AGENTS\.md instructions for[^\n]*\n\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/i, '')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, '')
    .trim()
}
export function parts(value: unknown): UniversalPart[] {
  if (typeof value === 'string') return value ? [{ type: 'text', text: redact(value) }] : []
  if (Array.isArray(value)) return value.flatMap(parts)
  const b = object(value)
  const type = string(b.type) ?? ''
  if (b.functionCall) {
    const f = object(b.functionCall)
    return [
      {
        type: 'tool-call',
        callId: string(f.id) ?? '',
        name: string(f.name) ?? 'unknown',
        input: serialized(f.args)
      }
    ]
  }
  if (b.functionResponse) {
    const f = object(b.functionResponse)
    return [
      {
        type: 'tool-result',
        callId: string(f.id) ?? '',
        text: serialized(f.response),
        isError: false
      }
    ]
  }
  if (['thinking', 'reasoning', 'reasoning_text'].includes(type) || b.thought === true) {
    return [
      { type: 'thinking', text: serialized(b.thinking ?? b.text ?? b.reasoning ?? b.content ?? '') }
    ]
  }
  if (
    [
      'tool_use',
      'toolCall',
      'function_call',
      'custom_tool_call',
      'local_shell_call',
      'web_search_call'
    ].includes(type)
  ) {
    return [
      {
        type: 'tool-call',
        callId: string(b.call_id ?? b.id) ?? '',
        name: string(b.name) ?? type,
        input: serialized(b.input ?? b.arguments ?? b.action)
      }
    ]
  }
  if (
    ['tool_result', 'toolResult', 'function_call_output', 'custom_tool_call_output'].includes(type)
  ) {
    return [
      {
        type: 'tool-result',
        callId: string(b.tool_use_id ?? b.toolCallId ?? b.call_id ?? b.id) ?? '',
        text: serialized(b.content ?? b.output),
        isError: b.is_error === true || b.isError === true
      }
    ]
  }
  if (type === 'tool') {
    const state = object(b.state)
    const result: UniversalPart[] = [
      {
        type: 'tool-call',
        callId: string(b.callID ?? b.id) ?? '',
        name: string(b.tool) ?? 'unknown',
        input: serialized(state.input)
      }
    ]
    if (state.output !== undefined || state.error !== undefined)
      result.push({
        type: 'tool-result',
        callId: string(b.callID ?? b.id) ?? '',
        text: serialized(state.output ?? state.error),
        isError: state.status === 'error'
      })
    return result
  }
  if (['image', 'input_image'].includes(type) || b.inlineData || b.fileData) {
    const source = object(b.source ?? b.inlineData ?? b.fileData)
    const reference =
      string(b.image_url ?? source.url ?? source.fileUri) ??
      (b.data || source.data ? '[embedded image]' : '[image]')
    return [
      {
        type: 'image-reference',
        reference: redact(reference.startsWith('data:') ? '[embedded image]' : reference),
        mimeType: string(b.mimeType ?? source.mimeType ?? source.media_type)
      }
    ]
  }
  if (type === 'file' || type === 'file-reference')
    return [{ type: 'file-reference', path: redact(string(b.path ?? b.filename ?? b.url) ?? '') }]
  if (type === 'code')
    return [{ type: 'code', text: serialized(b.text ?? b.code), language: string(b.language) }]
  if (type === 'error')
    return [{ type: 'error', text: serialized(b.message ?? b.text ?? b.content) }]
  if (type === 'step-finish' || type === 'usage')
    return [
      ...usage(b.tokens ? { ...object(b.tokens), cost: b.cost } : b),
      { type: 'native-event', eventType: type, text: serialized(b) }
    ]
  if (
    typeof b.text === 'string' ||
    ['text', 'input_text', 'output_text', 'command_output'].includes(type)
  ) {
    return parts(b.text ?? b.output ?? b.content ?? '')
  }
  if (!Object.keys(b).length) return []
  return [
    { type: 'native-event', eventType: type || 'unknown', text: serialized(b).slice(0, 8000) }
  ]
}
