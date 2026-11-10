import { describe, expect, it } from 'vitest'
import { parseMarketCatalog } from './catalog'

const pack = {
  name: '@piharness/pet-bigfish-3',
  kind: 'pet',
  version: '1.0.2',
  description: 'actions',
  author: 'wangmiao',
  license: 'MIT',
  compatible: '>=2.4.0',
  partOf: '@piharness/pet-bigfish',
  parts: [],
  downloadUrl: 'https://github.com/wangmiaozero/pi-Harness-packages/releases/download/pet-bigfish-3-v1.0.2/pet-bigfish-3-v1.0.2.zip',
  sha256: 'ab'.repeat(32),
  compressedSize: 10,
  unpackedSize: 20,
  previewUrl: null
}

describe('market catalog schema', () => {
  it('rejects a duplicated package and a missing base pet', () => {
    expect(() =>
      parseMarketCatalog({
        schemaVersion: 1,
        packages: [pack, pack]
      })
    ).toThrow(/twice/)
    expect(() => parseMarketCatalog({ schemaVersion: 1, packages: [pack] })).toThrow(/missing/)
  })
})
