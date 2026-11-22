import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { UpdateError } from './update-error'

const APP_NAME = 'Pi-Harness.app'
const APPLY_SCRIPT = `#!/bin/sh
set -eu
pid="$1"
source="$2"
target="$3"
case "$source" in
  */${APP_NAME}) ;;
  *) exit 2 ;;
esac
case "$target" in
  */${APP_NAME}) ;;
  *) exit 2 ;;
esac
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 300 ]; then exit 1; fi
  sleep 0.2
done
/bin/rm -rf "$target"
/usr/bin/ditto "$source" "$target"
/usr/bin/open "$target"
`

export function parseDiskImageMount(plist: string): string {
  const match = plist.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/)
  const mount = match?.[1]
  if (
    !mount ||
    !mount.startsWith('/Volumes/') ||
    mount.includes('..') ||
    mount.includes('\\') ||
    mount.slice('/Volumes/'.length).includes('/')
  )
    throw new UpdateError('INSTALL_LAUNCH_FAILED', 'The disk image did not mount.')
  return mount
}

export async function runMacCommand(command: string, args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(command, args, {
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024
  })
  return stdout
}

export function spawnMacHelper(script: string, args: string[]) {
  const child = spawn('/bin/sh', [script, ...args], { detached: true, stdio: 'ignore' })
  child.unref()
}

export async function stageMacUpdate(options: {
  file: string
  bundle: string
  stageRoot: string
  pid: number
  run?: (command: string, args: string[]) => Promise<string>
  spawnHelper?: (script: string, args: string[]) => void
}) {
  const run = options.run ?? runMacCommand
  const spawnHelper = options.spawnHelper ?? spawnMacHelper
  if (
    path.extname(options.file) !== '.dmg' ||
    !path.isAbsolute(options.file) ||
    options.file.includes('\0')
  )
    throw new UpdateError('INSTALL_UNSUPPORTED', 'The macOS update must be a verified disk image.')
  if (!Number.isInteger(options.pid) || options.pid <= 0)
    throw new UpdateError('INSTALL_LAUNCH_FAILED', 'The running app could not be replaced.')
  let bundle: string
  try {
    bundle = await fs.realpath(options.bundle)
  } catch {
    throw new UpdateError('INSTALL_UNSUPPORTED', 'Only the running Pi-Harness app can be replaced.')
  }
  if (path.basename(bundle) !== APP_NAME)
    throw new UpdateError('INSTALL_UNSUPPORTED', 'Only the running Pi-Harness app can be replaced.')
  await fs.access(bundle, fs.constants.W_OK)
  await fs.access(path.dirname(bundle), fs.constants.W_OK)
  const output = await run('hdiutil', ['attach', options.file, '-nobrowse', '-readonly', '-plist'])
  const mount = parseDiskImageMount(output)
  try {
    await applyMountedBundle({
      mount,
      bundle,
      stageRoot: options.stageRoot,
      pid: options.pid,
      run,
      spawnHelper
    })
  } finally {
    await run('hdiutil', ['detach', mount, '-quiet']).catch(() => undefined)
  }
}

export async function applyMountedBundle(options: {
  mount: string
  bundle: string
  stageRoot: string
  pid: number
  run: (command: string, args: string[]) => Promise<string>
  spawnHelper: (script: string, args: string[]) => void
}) {
  const source = path.join(options.mount, APP_NAME)
  const sourceStat = await fs.lstat(source)
  if (!sourceStat.isDirectory())
    throw new UpdateError('INSTALL_UNSUPPORTED', 'The disk image does not contain Pi-Harness.')
  const staged = path.join(options.stageRoot, APP_NAME)
  await fs.rm(staged, { recursive: true, force: true })
  await options.run('ditto', [source, staged])
  const script = path.join(options.stageRoot, 'apply-update.sh')
  await fs.writeFile(script, APPLY_SCRIPT, { mode: 0o700 })
  options.spawnHelper(script, [String(options.pid), staged, options.bundle])
}
