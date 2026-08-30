import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PET_MANIFESTS } from './manifests'

describe('unchanged user-supplied portrait assets', () => {
  it('preserves the original moonlit tea room background bytes and dimensions', () => {
    const image = readFileSync(
      path.resolve('src/renderer/src/assets/themes/portraits/moonlit-tea-room.png')
    )
    expect(createHash('sha256').update(image).digest('hex')).toBe(
      '88e2328a6037d29ca6c45bb8e625d1da56f60bc1fc92899b1a6aae8661492fec'
    )
    expect(image.readUInt32BE(16)).toBe(1672)
    expect(image.readUInt32BE(20)).toBe(941)
  })

  it('preserves the original noir study background bytes and dimensions', () => {
    const image = readFileSync(
      path.resolve('src/renderer/src/assets/themes/portraits/noir-study.png')
    )
    expect(createHash('sha256').update(image).digest('hex')).toBe(
      'a73d89375cbf80c13cfe37ec0a2557844cc62b9c74cd39c6776d50726e27fe27'
    )
    expect(image.readUInt32BE(16)).toBe(1672)
    expect(image.readUInt32BE(20)).toBe(941)
  })

  it.each([
    [
      'noirScholar',
      'noir-scholar',
      '66fe8da2ea4b2493929b711701cefa0836a5071517fc3c7aedcf64cada8dd08c'
    ],
    [
      'moonlitMaid',
      'moonlit-maid',
      '143c088a291b9906eef1086e391d47c12b88df587f38c695d4b2f249d1608f43'
    ]
  ] as const)('preserves %s bytes and aspect ratio', (style, filename, sha256) => {
    const image = readFileSync(
      path.resolve(`src/renderer/src/assets/themes/portraits/${filename}.png`)
    )
    expect(createHash('sha256').update(image).digest('hex')).toBe(sha256)
    expect(image.readUInt32BE(16)).toBe(PET_MANIFESTS[style].frameWidth)
    expect(image.readUInt32BE(20)).toBe(PET_MANIFESTS[style].frameHeight)
  })
})
