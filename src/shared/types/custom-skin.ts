export const CUSTOM_SKIN_TOKEN_KEYS = [
  'window',
  'titlebar',
  'sidebar',
  'workspace',
  'surface',
  'surfaceRaised',
  'hover',
  'selected',
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'accent',
  'accentHover',
  'accentActive',
  'accentBorder',
  'borderSubtle',
  'borderDefault',
  'borderStrong',
  'controlBackground',
  'controlBorder',
  'controlBorderHover'
] as const

export type CustomSkinTokenKey = (typeof CUSTOM_SKIN_TOKEN_KEYS)[number]

export interface CustomSkinManifest {
  $schema?: string
  schemaVersion: 1
  id: string
  name: string
  version: string
  description?: string
  author?: string
  appearance: 'dark' | 'light'
  assets?: {
    preview?: string
    wallpaper?: string
    portrait?: string
  }
  tokens: Partial<Record<CustomSkinTokenKey, string>>
}

export interface CustomSkinDescriptor {
  id: string
  name: string
  version: string
  description: string | null
  author: string | null
  appearance: 'dark' | 'light'
  tokens: Partial<Record<CustomSkinTokenKey, string>>
  previewDataUrl: string | null
  wallpaperDataUrl: string | null
  portraitDataUrl: string | null
}

export interface CustomSkinProjectResult {
  path: string
  manifestPath: string
}
