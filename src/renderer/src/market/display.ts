import { parseMarketPackageName } from '@shared/market/package-name'

const BRAND_WORDS: Record<string, string> = {
  deepseek: 'DeepSeek',
  gpt: 'GPT',
  glm: 'GLM',
  bigfish: 'BigFish',
  qwen: 'Qwen',
  kimi: 'Kimi',
  grok: 'Grok',
  claude: 'Claude',
  gemini: 'Gemini'
}

const ACTION_PACK = /^([a-z0-9][a-z0-9-]*?)-(\d+)$/

/** Turns a slug such as `noir-scholar` into `Noir Scholar`, keeping known brand casing. */
export function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => BRAND_WORDS[word] ?? word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

export interface ActionPackInfo {
  /** Package name of the pet the action pack extends. */
  parent: string
  index: number
}

/** Pet action packs are published as `pet-<base>-<n>` parts of `pet-<base>`. */
export function actionPackInfo(name: string): ActionPackInfo | null {
  const parsed = parseMarketPackageName(name)
  if (!parsed || parsed.kind !== 'pet') return null
  const match = ACTION_PACK.exec(parsed.slug)
  if (!match) return null
  return { parent: `@piharness/pet-${match[1]}`, index: Number(match[2]) }
}

/** Catalog text is written as `中文 / English`; pick the half matching the UI language. */
export function localizedText(value: string, locale: string): string {
  const parts = value.split(' / ')
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return value
  return locale.toLowerCase().startsWith('zh') ? parts[0].trim() : parts[1].trim()
}

export function packageDisplayName(
  name: string,
  locale: string,
  translate: (key: string, values: Record<string, unknown>) => string,
  manifestName?: string | null
): string {
  const action = actionPackInfo(name)
  if (action) {
    const parent = parseMarketPackageName(action.parent)!
    return translate('settings.marketActionPackName', {
      name: humanizeSlug(parent.slug),
      index: action.index
    })
  }
  if (manifestName?.trim()) return localizedText(manifestName.trim(), locale)
  const parsed = parseMarketPackageName(name)
  return parsed ? humanizeSlug(parsed.slug) : name
}

const NATURAL = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Orders `pet-bigfish`, `pet-bigfish-2`, … `pet-bigfish-10` instead of plain string order. */
export function compareMarketPackageNames(a: string, b: string): number {
  return NATURAL.compare(a, b)
}
