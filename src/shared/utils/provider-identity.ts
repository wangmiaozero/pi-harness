export interface ProviderIdentitySuggestion {
  key: string
  displayName: string
  internalName: string
}

const IGNORED_HOST_PARTS = new Set([
  'api',
  'apis',
  'gateway',
  'generativelanguage',
  'integrate',
  'openapi',
  'platform',
  'service',
  'services',
  'www'
])

const COMMON_PUBLIC_SUFFIX_PARTS = new Set(['com', 'net', 'org', 'io', 'ai', 'co', 'cn', 'dev'])

const PROVIDER_KEY_ALIASES: Record<string, string> = {
  googleapis: 'google',
  volces: 'volcengine'
}

const KNOWN_BRANDS: Record<string, string> = {
  alibabacloud: 'Alibaba Cloud',
  aliyun: 'Alibaba Cloud',
  anthropic: 'Anthropic',
  azure: 'Azure',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks AI',
  google: 'Google',
  googleapis: 'Google',
  groq: 'Groq',
  minimax: 'MiniMax',
  mistral: 'Mistral AI',
  moonshot: 'Moonshot AI',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  perplexity: 'Perplexity',
  siliconflow: 'SiliconFlow',
  stepfun: 'StepFun',
  together: 'Together AI',
  volcengine: 'Volcengine',
  xai: 'xAI'
}

/** Derive a stable identity from an API root without contacting the endpoint. */
export function suggestProviderIdentity(baseUrl: string): ProviderIdentitySuggestion | null {
  let url: URL
  try {
    url = new URL(baseUrl.trim())
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  let candidate: string
  if (hostname === 'localhost' || hostname.includes(':') || /^\d+(\.\d+){3}$/.test(hostname)) {
    candidate = hostname === 'localhost' && url.port ? `localhost-${url.port}` : hostname
  } else {
    const parts = hostname.split('.').filter(Boolean)
    const meaningful = parts.filter((part) => !IGNORED_HOST_PARTS.has(part))
    const registrableIndex =
      meaningful.length >= 3 &&
      COMMON_PUBLIC_SUFFIX_PARTS.has(meaningful.at(-2) ?? '') &&
      (meaningful.at(-1)?.length ?? 0) === 2
        ? meaningful.length - 3
        : meaningful.length - 2
    candidate = meaningful[Math.max(0, registrableIndex)] ?? parts[0] ?? ''
  }

  const rawKey = candidate
    .replace(/[^a-z0-9._+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+|[-.]+$/g, '')
    .slice(0, 128)
  const key = PROVIDER_KEY_ALIASES[rawKey] ?? rawKey
  if (!key) return null

  const displayName =
    KNOWN_BRANDS[key] ??
    key
      .split(/[-_.]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')

  return { key, displayName, internalName: key }
}
