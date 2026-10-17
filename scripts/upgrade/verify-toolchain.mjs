import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Linter } from 'eslint'
import config from '../../eslint.config.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cache = path.join(root, '.tsbuildinfo')
await fs.mkdir(cache, { recursive: true })
const temporary = await fs.mkdtemp(path.join(cache, 'toolchain-'))
const exec = promisify(execFile)
try {
  const project = path.join(temporary, 'tsconfig.json')
  const fixture = path.join(temporary, 'Probe.vue')
  await fs.writeFile(
    project,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        skipLibCheck: true,
        noEmit: true,
        lib: ['ES2022', 'DOM'],
        types: []
      },
      vueCompilerOptions: { strictTemplates: true },
      include: ['./Probe.vue']
    })
  )
  const cli = fileURLToPath(new URL('./dist/cli.mjs', import.meta.resolve('vue-tsgo/package.json')))
  const check = () =>
    exec(process.execPath, [cli, '--tsdk', 'typescript', '--project', project], {
      cwd: root,
      timeout: 30_000
    })
  await fs.writeFile(
    fixture,
    '<script setup lang="ts">\nconst title: string = "ok"\n</script>\n<template>{{ title.toUpperCase() }}</template>\n'
  )
  await check()
  await fs.writeFile(
    fixture,
    '<script setup lang="ts">\nconst title: string = 1\n</script>\n<template>{{ title.toFixed() }}</template>\n'
  )
  let rejected = false
  try {
    await check()
  } catch (error) {
    assert.match(error.stdout, /TS2322/, 'Vue script type errors must fail the check')
    assert.match(error.stdout, /TS2551/, 'Vue template type errors must fail the check')
    rejected = true
  }
  assert.equal(rejected, true, 'The native Vue checker accepted an invalid component')
  const messages = new Linter().verify(
    'import type { Item } from "./types"; const unused = 1; export const result: Item = {} as Item;',
    config,
    { filename: path.join(root, 'src/toolchain-probe.ts') }
  )
  assert.equal(
    messages.some((message) => message.fatal),
    false
  )
  assert.equal(messages.filter((message) => message.ruleId === 'no-unused-vars').length, 1)
  assert.match(messages.find((message) => message.ruleId === 'no-unused-vars').message, /unused/)
  process.stdout.write(
    'Native TypeScript 7: Vue script/template errors rejected; ESLint type references verified\n'
  )
} finally {
  await fs.rm(temporary, { recursive: true, force: true })
}
