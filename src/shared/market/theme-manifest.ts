import { marketFileUrl, type MarketUrlKind } from './urls'

const PACK_ID = /^[a-z0-9][a-z0-9-]*$/
const STYLE_ID = /^[A-Za-z][A-Za-z0-9]*$/
const SKIN_ID = /^[a-z0-9][a-z0-9-]*$/
const ASSET = /^(?:[\w][\w.-]*)(?:\/[\w][\w.-]*)*$/
const CSS_VAR = /^--[a-z0-9-]+$/

export interface ThemePackVariant {
  id: string
  skinId: string
  name: string
  appearance: 'dark' | 'light'
  portrait: boolean
  accent: string
  frameWidth: number
  frameHeight: number
  portraitAsset?: string
  startup?: boolean
  cssImages?: Record<string, string>
}

export interface ThemePackManifest {
  formatVersion: 1
  id: string
  name: string
  version: string
  author: string
  description: string
  license: string
  compatiblePiHarness: string
  preview: string
  variants: ThemePackVariant[]
  startup?: Record<string, string>
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asset(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ASSET.test(value)) throw new Error(`Unsafe theme asset: ${label}`)
  return value
}

export function validateThemePackManifest(value: unknown): ThemePackManifest {
  if (!plain(value)) throw new Error('Theme pack manifest must be an object')
  if (value['formatVersion'] !== 1) throw new Error('Unsupported theme pack format')
  const id = value['id']
  if (typeof id !== 'string' || !PACK_ID.test(id)) throw new Error('Invalid theme pack id')
  for (const key of ['name', 'version', 'author', 'description', 'license', 'compatiblePiHarness'] as const) {
    const field = value[key]
    if (typeof field !== 'string' || !field.trim() || field.length > 400) {
      throw new Error(`Invalid theme pack ${key}`)
    }
  }
  const preview = asset(value['preview'], 'preview')
  const rawVariants = value['variants']
  if (!Array.isArray(rawVariants) || rawVariants.length < 1 || rawVariants.length > 16) {
    throw new Error('Theme pack variants are invalid')
  }
  const variants: ThemePackVariant[] = rawVariants.map((raw) => {
    if (!plain(raw)) throw new Error('Theme variant must be an object')
    if (typeof raw['id'] !== 'string' || !STYLE_ID.test(raw['id'])) throw new Error('Invalid theme variant id')
    if (typeof raw['skinId'] !== 'string' || !SKIN_ID.test(raw['skinId'])) {
      throw new Error('Invalid theme skin id')
    }
    if (typeof raw['name'] !== 'string' || !raw['name'].trim()) throw new Error('Invalid theme variant name')
    if (raw['appearance'] !== 'dark' && raw['appearance'] !== 'light') {
      throw new Error('Invalid theme appearance')
    }
    if (typeof raw['portrait'] !== 'boolean') throw new Error('Invalid theme portrait flag')
    if (typeof raw['accent'] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw['accent'])) {
      throw new Error('Invalid theme accent')
    }
    for (const dimension of ['frameWidth', 'frameHeight'] as const) {
      const size = raw[dimension]
      if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 8192) {
        throw new Error('Invalid theme frame size')
      }
    }
    const variant: ThemePackVariant = {
      id: raw['id'],
      skinId: raw['skinId'],
      name: raw['name'],
      appearance: raw['appearance'],
      portrait: raw['portrait'],
      accent: raw['accent'],
      frameWidth: raw['frameWidth'] as number,
      frameHeight: raw['frameHeight'] as number
    }
    if (raw['portraitAsset'] !== undefined) variant.portraitAsset = asset(raw['portraitAsset'], 'portrait')
    if (raw['startup'] !== undefined) {
      if (typeof raw['startup'] !== 'boolean') throw new Error('Invalid theme startup flag')
      variant.startup = raw['startup']
    }
    if (raw['cssImages'] !== undefined) {
      if (!plain(raw['cssImages'])) throw new Error('Invalid theme image map')
      variant.cssImages = {}
      for (const [key, file] of Object.entries(raw['cssImages'])) {
        if (!CSS_VAR.test(key)) throw new Error('Invalid theme CSS variable')
        variant.cssImages[key] = asset(file, key)
      }
    }
    return variant
  })
  let startup: Record<string, string> | undefined
  if (value['startup'] !== undefined) {
    if (!plain(value['startup'])) throw new Error('Invalid theme startup map')
    startup = {}
    for (const [key, file] of Object.entries(value['startup'])) {
      if (!/^[\w][\w.-]*$/.test(key)) throw new Error('Invalid startup asset key')
      startup[key] = asset(file, key)
    }
  }
  return {
    formatVersion: 1,
    id,
    name: value['name'] as string,
    version: value['version'] as string,
    author: value['author'] as string,
    description: value['description'] as string,
    license: value['license'] as string,
    compatiblePiHarness: value['compatiblePiHarness'] as string,
    preview,
    variants,
    startup
  }
}

export function themeAssetUrl(manifest: ThemePackManifest, assetPath: string): string {
  return marketFileUrl('theme' satisfies MarketUrlKind, manifest.id, assetPath)
}
