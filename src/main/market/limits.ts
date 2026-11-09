export const MARKET_LIMITS = {
  maxTarballBytes: 650 * 1024 * 1024,
  maxUnpackedBytes: 750 * 1024 * 1024,
  maxEntries: 40_000,
  maxFileBytes: 32 * 1024 * 1024,
  requestTimeoutMs: 20_000,
  cacheTtlMs: 5 * 60 * 1000,
  maxConcurrentInstalls: 2
} as const

export const MARKET_FILE_EXTENSIONS = new Set([
  '.webp',
  '.png',
  '.jpg',
  '.jpeg',
  '.mp4',
  '.mp3',
  '.json',
  '.md',
  '.txt'
])

export const MARKET_BARE_FILES = new Set(['license', 'notice', 'readme.md'])
