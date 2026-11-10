import { parseMarketPackageName } from './package-name'

export const OFFICIAL_CATALOG_URL =
  'https://raw.githubusercontent.com/wangmiaozero/pi-Harness-packages/market-index/catalog.json'

export const OFFICIAL_RELEASE_PREFIX =
  'https://github.com/wangmiaozero/pi-Harness-packages/releases/download/'

export interface CatalogPackage {
  name: string
  kind: 'theme' | 'pet'
  version: string
  description: string
  author: string
  license: string
  compatible: string
  partOf: string | null
  parts: string[]
  downloadUrl: string
  sha256: string
  compressedSize: number
  unpackedSize: number
  previewUrl: string | null
}

export interface MarketCatalog {
  schemaVersion: 1
  packages: CatalogPackage[]
}

const VERSION = /^\d+\.\d+\.\d+$/
const SHA256 = /^[a-f0-9]{64}$/

export function parseMarketCatalog(value: unknown): MarketCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Market catalog is invalid')
  const body = value as { schemaVersion?: unknown; packages?: unknown }
  if (body.schemaVersion !== 1 || !Array.isArray(body.packages)) throw new Error('Market catalog is invalid')
  const packages: CatalogPackage[] = []
  const names = new Set<string>()
  for (const item of body.packages) packages.push(parsePackage(item, names))
  const byName = new Map(packages.map((item) => [item.name, item]))
  for (const item of packages) {
    if (item.partOf && !byName.has(item.partOf)) throw new Error(`Market catalog is missing ${item.partOf}`)
    for (const part of item.parts) {
      const resolved = byName.get(part)
      if (!resolved || resolved.partOf !== item.name) throw new Error(`Market catalog part ${part} is invalid`)
    }
  }
  return { schemaVersion: 1, packages }
}

function parsePackage(value: unknown, names: Set<string>): CatalogPackage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Market catalog package is invalid')
  const body = value as Record<string, unknown>
  const keys = [
    'name',
    'kind',
    'version',
    'description',
    'author',
    'license',
    'compatible',
    'partOf',
    'parts',
    'downloadUrl',
    'sha256',
    'compressedSize',
    'unpackedSize',
    'previewUrl'
  ]
  if (Object.keys(body).some((key) => !keys.includes(key)) || keys.some((key) => !(key in body))) {
    throw new Error('Market catalog package is invalid')
  }
  const parsed = typeof body.name === 'string' ? parseMarketPackageName(body.name) : null
  if (!parsed || (body.kind !== 'theme' && body.kind !== 'pet') || parsed.kind !== body.kind) {
    throw new Error('Market catalog package is invalid')
  }
  if (names.has(parsed.name)) throw new Error(`Market catalog lists ${parsed.name} twice`)
  names.add(parsed.name)
  if (typeof body.version !== 'string' || !VERSION.test(body.version)) throw new Error('Market catalog package is invalid')
  if (typeof body.description !== 'string' || typeof body.author !== 'string') {
    throw new Error('Market catalog package is invalid')
  }
  if (typeof body.license !== 'string' || !body.license || typeof body.compatible !== 'string' || !body.compatible) {
    throw new Error('Market catalog package is invalid')
  }
  if (typeof body.sha256 !== 'string' || !SHA256.test(body.sha256)) throw new Error('Market catalog package is invalid')
  if (!integer(body.compressedSize) || !integer(body.unpackedSize)) throw new Error('Market catalog package is invalid')
  const partOf = body.partOf === null ? null : body.partOf
  if (partOf !== null && (typeof partOf !== 'string' || !parseMarketPackageName(partOf))) {
    throw new Error('Market catalog package is invalid')
  }
  if (!Array.isArray(body.parts) || body.parts.length > 8) throw new Error('Market catalog package is invalid')
  const parts: string[] = []
  for (const part of body.parts) {
    if (typeof part !== 'string' || !parseMarketPackageName(part) || parts.includes(part)) {
      throw new Error('Market catalog package is invalid')
    }
    parts.push(part)
  }
  if (partOf && parts.length) throw new Error('Market catalog package is invalid')
  if (typeof body.downloadUrl !== 'string' || !body.downloadUrl) throw new Error('Market catalog package is invalid')
  if (body.previewUrl !== null && typeof body.previewUrl !== 'string') throw new Error('Market catalog package is invalid')
  return {
    name: parsed.name,
    kind: parsed.kind,
    version: body.version,
    description: body.description,
    author: body.author,
    license: body.license,
    compatible: body.compatible,
    partOf,
    parts,
    downloadUrl: body.downloadUrl,
    sha256: body.sha256,
    compressedSize: body.compressedSize,
    unpackedSize: body.unpackedSize,
    previewUrl: body.previewUrl
  }
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
