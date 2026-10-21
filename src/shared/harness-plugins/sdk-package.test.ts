// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('supports standalone package consumers in NodeNext and Bundler without application aliases', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-sdk-consumer-'))
  const exec = promisify(execFile)
  try {
    const modules = path.join(directory, 'node_modules')
    await fs.mkdir(path.join(modules, '@pi-harness'), { recursive: true })
    await fs.cp('packages/harness-plugin-sdk', path.join(modules, '@pi-harness/plugin-sdk'), {
      recursive: true
    })
    for (const dependency of ['zod', 'semver']) {
      await fs.symlink(
        await fs.realpath(path.resolve('node_modules', dependency)),
        path.join(modules, dependency),
        process.platform === 'win32' ? 'junction' : 'dir'
      )
    }
    await fs.writeFile(path.join(directory, 'package.json'), '{"type":"module"}')
    const source = `
import { definePlugin, HARNESS_PLUGIN_API_VERSION, type PluginManifest } from '@pi-harness/plugin-sdk'
import { pluginManifestSchema, compatible } from '@pi-harness/plugin-sdk/manifest'
const manifest: PluginManifest = pluginManifestSchema.parse({})
compatible({ apiVersion: HARNESS_PLUGIN_API_VERSION })
definePlugin({ activate(context) {
  context.events.subscribe(['run.completed'], event => {
    context.diagnostics.log(event.event.type)
  })
} })
void manifest
`
    const file = path.join(directory, 'consumer.ts')
    await fs.writeFile(file, source)
    for (const [module, resolution] of [
      ['NodeNext', 'NodeNext'],
      ['ESNext', 'Bundler']
    ]) {
      await exec(
        process.execPath,
        [
          path.resolve('node_modules/typescript/bin/tsc'),
          '--ignoreConfig',
          '--noEmit',
          '--strict',
          '--skipLibCheck',
          'false',
          '--target',
          'ES2022',
          '--module',
          module,
          '--moduleResolution',
          resolution,
          file
        ],
        { cwd: directory, timeout: 30_000 }
      ).catch((error) => {
        throw new Error(`${resolution} consumer failed: ${error.stdout}\n${error.stderr}`)
      })
    }
    const runtime = path.join(directory, 'runtime.mjs')
    await fs.writeFile(
      runtime,
      `
import { definePlugin, HARNESS_PLUGIN_API_VERSION } from '@pi-harness/plugin-sdk'
import { compatible } from '@pi-harness/plugin-sdk/manifest'
if (!compatible({ apiVersion: HARNESS_PLUGIN_API_VERSION })) throw new Error('Incompatible SDK')
definePlugin({ activate(context) { context.diagnostics.log('consumer activated') } })
  .activate({ diagnostics: { log: console.log } })
`
    )
    expect((await exec(process.execPath, [runtime], { cwd: directory })).stdout).toContain(
      'consumer activated'
    )
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 90_000)
