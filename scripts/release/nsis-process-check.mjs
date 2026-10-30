/** Exercise the actual installer macros with real processes, including a stalled probe. */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
const exec = promisify(execFile)
const require = createRequire(import.meta.url)
const builder = createRequire(require.resolve('electron-builder'))
const { getMakeNsisPath, getNsisPluginsPath } = builder('app-builder-lib/out/toolsets/windows')
const { nsisEscapeString } = builder('app-builder-lib/out/targets/nsis/nsisScriptGenerator')
const include = path.join(
  path.dirname(builder.resolve('app-builder-lib/package.json')),
  'templates/nsis/include'
)
const compileOnly = process.argv.includes('--compile-only')
if (!compileOnly && process.platform !== 'win32') throw new Error('Native Windows is required')
if (
  !compileOnly &&
  process.env.GITHUB_ACTIONS !== 'true' &&
  process.env.PI_HARNESS_DISPOSABLE_INSTALL_TEST !== '1'
)
  throw new Error('Installer process tests require a disposable runner')
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'nsis process 空格 '))
const installed = path.join(work, 'installed')
await fs.mkdir(installed)
const compiler = await getMakeNsisPath()
const plugins = path.join(await getNsisPluginsPath(), 'x86-unicode')
const quote = (value) => `"${nsisEscapeString(value)}"`
const processes = new Set()
const results = []
async function compile(
  name,
  body,
  macros = true,
  macroFile = path.join(include, 'allowOnlyOneInstallerInstance.nsh')
) {
  const output = path.join(macros ? work : installed, `${name}.exe`)
  const source = path.join(work, `${name}.nsi`)
  await fs.writeFile(
    source,
    [
      'Unicode true',
      'RequestExecutionLevel user',
      'SilentInstall silent',
      'AutoCloseWindow true',
      `Name "Process check"`,
      `OutFile ${quote(output)}`,
      `!addincludedir ${quote(include)}`,
      `!addplugindir /x86-unicode ${quote(plugins)}`,
      '!include "LogicLib.nsh"',
      ...(macros
        ? [
            `!include ${quote(macroFile)}`,
            'Var CmdPath',
            'Var PowerShellPath',
            ...(body.includes('!insertmacro IS_POWERSHELL_AVAILABLE')
              ? []
              : ['Var IsPowerShellAvailable'])
          ]
        : []),
      'Section',
      ...(macros
        ? [
            `StrCpy $INSTDIR ${quote(installed)}`,
            'StrCpy $CmdPath "$SYSDIR\\cmd.exe"',
            'StrCpy $PowerShellPath "$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe"',
            ...(body.includes('!insertmacro IS_POWERSHELL_AVAILABLE')
              ? []
              : ['StrCpy $IsPowerShellAvailable 0']),
            "System::Call 'kernel32::GetCurrentProcessId() i.r0'",
            'StrCpy $pid $0'
          ]
        : []),
      body,
      'SectionEnd',
      ''
    ].join('\n')
  )
  await exec(compiler.path, ['-V2', '-INPUTCHARSET', 'UTF8', source], {
    env: { ...process.env, ...compiler.env },
    timeout: 60_000
  })
  return output
}
async function start(file) {
  const child = spawn(file, ['/S'], { stdio: 'ignore', windowsHide: true })
  processes.add(child)
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  const deadline = Date.now() + 5000
  while (true) {
    try {
      await fs.stat(path.join(installed, `ready-${child.pid}`))
      break
    } catch (error) {
      if (error.code !== 'ENOENT' || Date.now() > deadline) throw error
      await delay(25)
    }
  }
  return child
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('close', resolve))
  child.kill('SIGKILL')
  await exited
}
async function run(file, expected, result) {
  const began = Date.now()
  await exec(file, ['/S'], { timeout: 15_000 })
  const actual = (await fs.readFile(result, 'utf8')).trim()
  if (typeof expected === 'string') assert.equal(actual, expected)
  else assert.match(actual, expected)
  results.push({ name: path.basename(file), actual, status: 'PASS', elapsedMs: Date.now() - began })
}
try {
  const unique = `nsis-fixture-${path.basename(work).replace(/[^a-z0-9]/gi, '')}`
  const busy = await compile(
    unique,
    'System::Call \'kernel32::GetCurrentProcessId() i.r0\'\nFileOpen $1 "$EXEDIR\\ready-$0" w\nFileClose $1\nSleep 60000',
    false
  )
  const hung = await compile('hung-probe', 'Sleep 60000', false)
  const failed = await compile('failed-probe', 'SetErrorLevel 2', false)
  const result = path.join(work, 'result.txt')
  const write = `FileOpen $1 ${quote(result)} w\nFileWrite $1 "$R0:$IsPowerShellAvailable"\nFileClose $1`
  const find = (override = '') =>
    `${override}\n!insertmacro FIND_PROCESS "${path.basename(busy)}" $R0\n${write}`
  const normal = await compile('find-normal', find())
  const invalidQueryFile = path.join(work, 'invalid-query.nsh')
  await fs.writeFile(
    invalidQueryFile,
    (await fs.readFile(path.join(include, 'allowOnlyOneInstallerInstance.nsh'), 'utf8')).replaceAll(
      'Win32_Process -ErrorAction Stop',
      'PiHarness_NonexistentClass -ErrorAction Stop'
    )
  )
  const invalidQuery = await compile('find-query-error', find(), true, invalidQueryFile)
  const timeout = await compile('find-timeout', find(`StrCpy $PowerShellPath ${quote(hung)}`))
  const failure = await compile('find-error', find(`StrCpy $PowerShellPath ${quote(failed)}`))
  const availability = await compile(
    'availability-timeout',
    `StrCpy $PowerShellPath ${quote(hung)}\n!insertmacro IS_POWERSHELL_AVAILABLE\nStrCpy $R0 $IsPowerShellAvailable\n${write}`
  )
  const kill = await compile(
    'kill-timeout',
    `StrCpy $PowerShellPath ${quote(hung)}\nStrCpy $0 "stack-sentinel"\n!insertmacro KILL_PROCESS "${path.basename(busy)}" 1\nStrCpy $R0 $0\n${write}`
  )
  let negative
  if (process.argv.includes('--negative-control')) {
    const original = (
      await fs.readFile(path.join(include, 'allowOnlyOneInstallerInstance.nsh'), 'utf8')
    ).replaceAll('/TIMEOUT=5000 ', '')
    const macroFile = path.join(work, 'unbounded.nsh')
    await fs.writeFile(macroFile, original)
    negative = await compile(
      'unbounded-control',
      find(`StrCpy $PowerShellPath ${quote(hung)}`),
      true,
      macroFile
    )
  }
  if (!compileOnly) {
    await run(normal, /^1:[01]$/, result)
    const first = await start(busy)
    await run(normal, /^0:[01]$/, result)
    await run(invalidQuery, '0:1', result)
    const second = await start(busy)
    await run(normal, /^0:[01]$/, result)
    await stop(second)
    await run(failure, '0:1', result)
    if (negative) {
      const child = spawn(negative, ['/S'], { stdio: 'ignore', windowsHide: true })
      const exited = new Promise((resolve) => child.once('close', () => resolve('exited')))
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      try {
        assert.equal(await Promise.race([exited, delay(8000, 'blocked')]), 'blocked')
        results.push({ name: 'unbounded-control', status: 'REPRODUCED_BLOCK' })
      } finally {
        await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15_000 })
        await exited
      }
    }
    await run(timeout, '0:1', result)
    await run(availability, '1:1', result)
    await run(kill, 'stack-sentinel:1', result)
    await new Promise((resolve, reject) => {
      if (first.exitCode !== null || first.signalCode !== null) return resolve()
      const timer = setTimeout(() => reject(new Error('Fixture application did not exit')), 5000)
      first.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    await run(normal, /^1:[01]$/, result)
  }
  process.stdout.write(
    JSON.stringify(
      { native: !compileOnly, platform: process.platform, arch: process.arch, results },
      null,
      2
    ) + '\n'
  )
} finally {
  await Promise.all([...processes].map(stop))
  await fs.rm(work, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 5 : 0
  })
}
