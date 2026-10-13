import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { piEnvironment } from './environment'
import { piProcess } from '../process/pi-process'
import { getDefaultSkillDirs } from '../services/app-paths'

let configDir = ''
beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-skill-locations-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(configDir, { recursive: true, force: true })
})

it('reads current skill roots without checking executable versions and keeps native ordering', async () => {
  const probe = vi.spyOn(piProcess, 'resolveCliPath').mockRejectedValue(new Error('No probes'))
  await fs.writeFile(
    path.join(configDir, 'settings.json'),
    JSON.stringify({ skills: ['extra', { source: './nested' }, 'extra'] })
  )
  const expected = [
    ...new Set([
      path.join(configDir, 'skills'),
      ...getDefaultSkillDirs(),
      path.join(configDir, 'extra'),
      path.join(configDir, 'nested')
    ])
  ]
  expect(await piEnvironment.skillLocations(configDir)).toEqual({
    configDir,
    skillsDirs: expected
  })
  await fs.writeFile(path.join(configDir, 'settings.json'), JSON.stringify({ skills: ['changed'] }))
  const changed = await piEnvironment.skillLocations(configDir)
  expect(changed.skillsDirs).toContain(path.join(configDir, 'changed'))
  expect(changed.skillsDirs).not.toContain(path.join(configDir, 'extra'))
  expect(probe).not.toHaveBeenCalled()
})

it('retains default roots for missing or malformed settings', async () => {
  const expected = [...new Set([path.join(configDir, 'skills'), ...getDefaultSkillDirs()])]
  expect((await piEnvironment.skillLocations(configDir)).skillsDirs).toEqual(expected)
  await fs.writeFile(path.join(configDir, 'settings.json'), '{')
  expect((await piEnvironment.skillLocations(configDir)).skillsDirs).toEqual(expected)
})
