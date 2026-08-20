import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { atomicWriteText } from './storage'

describe('atomicWriteText', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-switch-storage-'))
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it('durably creates and replaces a file', async () => {
    const target = path.join(testDir, 'settings.json')

    await atomicWriteText(target, 'dark')
    await atomicWriteText(target, 'light')

    expect(await fs.readFile(target, 'utf8')).toBe('light')
  })

  it('uses isolated temporary files for concurrent writes', async () => {
    const target = path.join(testDir, 'ui-state.json')
    const values = Array.from({ length: 8 }, (_, index) => `value-${index}`)

    await Promise.all(values.map((value) => atomicWriteText(target, value)))

    expect(await fs.readFile(target, 'utf8')).toBe(values.at(-1))
    expect((await fs.readdir(testDir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
