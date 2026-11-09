import type { ThemePackManifest } from './theme-manifest'

export interface MarketPackageSummary {
  name: string
  kind: 'theme' | 'pet'
  version: string
  description: string
  author: string
  license: string
  unpackedSize: number | null
  deprecated: boolean
  compatible: boolean | null
}

export interface MarketSearchResult {
  packages: MarketPackageSummary[]
  incomplete: boolean
  fromCache: boolean
  offline: boolean
}

export interface MarketProgress {
  name: string
  phase: 'metadata' | 'download' | 'verify' | 'extract' | 'install' | 'done' | 'error' | 'cancelled'
  received: number
  total: number | null
  message?: string
}

export interface InstalledMarketPackage {
  name: string
  kind: 'theme' | 'pet'
  version: string
  packId: string
  license: string
  latest: string | null
  updateAvailable: boolean
  manifest: ThemePackManifest | null
  petId: string | null
}

export interface MarketInstalled {
  themes: InstalledMarketPackage[]
  pets: InstalledMarketPackage[]
}

export interface MarketInstallResult {
  name: string
  version: string
  packId: string
  updated: boolean
}
