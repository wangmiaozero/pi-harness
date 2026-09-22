import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import packageJson from '../../../package.json'
import tauriConf from '../../../src-tauri/tauri.conf.json'
import { APP_VERSION } from './index'

describe('application version', () => {
  it('matches the package and installer version', () => {
    expect(APP_VERSION).toBe(packageJson.version)
  })

  it('matches Cargo.toml and tauri.conf.json', () => {
    const cargo = readFileSync(resolve(import.meta.dirname, '../../../src-tauri/Cargo.toml'), 'utf8')
    const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
    expect(cargoVersion).toBe(packageJson.version)
    expect(tauriConf.version).toBe(packageJson.version)
  })
})
