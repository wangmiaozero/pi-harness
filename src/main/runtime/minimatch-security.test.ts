// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DefaultPackageManager,
  SettingsManager,
  resolveModelScopeWithDiagnostics,
  type ModelRuntime
} from '@earendil-works/pi-coding-agent'

const piRequire = createRequire(
  realpathSync(path.resolve('node_modules/@earendil-works/pi-coding-agent/dist/index.js'))
)
const { Minimatch } = piRequire('minimatch')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

it.each(['**/../a/b', '**/../x/y/'])(
  'bounds Pi dependency preprocessing for repeated %s patterns',
  (segment) => {
    expect(piRequire('minimatch/package.json').version).toBe('11.0.1')
    const matcher = new Minimatch(Array(7).fill(segment).join('/'), {
      optimizationLevel: 2,
      braceExpandMax: 8
    })
    expect(matcher.set.length).toBeLessThanOrEqual(8)
  }
)

it('preserves Native model wildcards, case folding and thinking suffixes', async () => {
  const first = { provider: 'fixture', id: 'chat-one', name: 'Chat One' }
  const second = { provider: 'other', id: 'chat-two', name: 'Chat Two' }
  const runtime = { getAvailable: async () => [first, second] } as unknown as ModelRuntime
  const result = await resolveModelScopeWithDiagnostics(['FIXTURE/CHAT-*:high'], runtime)
  expect(result.scopedModels).toEqual([{ model: first, thinkingLevel: 'high' }])
  expect(result.diagnostics).toEqual([])
  const absent = await resolveModelScopeWithDiagnostics(['missing/*'], runtime)
  expect(absent.scopedModels).toEqual([])
  expect(absent.diagnostics).toHaveLength(1)
})

it('preserves Native package includes, exclusions and skill parent matching', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-glob-security-'))
  roots.push(root)
  const packageRoot = path.join(root, 'package')
  for (const relative of [
    'prompts/public.md',
    'prompts/private.md',
    'skills/allowed-one/SKILL.md',
    'skills/blocked-one/SKILL.md'
  ]) {
    const file = path.join(packageRoot, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '---\nname: fixture\ndescription: fixture\n---\nFixture')
  }
  await fs.writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: 'fixture-package',
      pi: {
        prompts: ['prompts/*.md', '!**/private.md'],
        skills: ['skills/*', '!blocked-*']
      }
    })
  )
  const manager = new DefaultPackageManager({
    cwd: root,
    agentDir: path.join(root, 'agent'),
    settingsManager: SettingsManager.inMemory()
  })
  const resources = await manager.resolveExtensionSources([packageRoot], { temporary: true })
  expect(resources.prompts.map((resource) => path.relative(packageRoot, resource.path))).toEqual([
    path.join('prompts', 'public.md')
  ])
  expect(resources.skills.map((resource) => path.relative(packageRoot, resource.path))).toEqual([
    path.join('skills', 'allowed-one', 'SKILL.md')
  ])
})
