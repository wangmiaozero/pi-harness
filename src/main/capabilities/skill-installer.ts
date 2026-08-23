import { execFile, type ExecFileOptions } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CapabilityDefinition, CapabilityMutationPhase } from '@shared/capabilities/types'
import { resolveNpmExecutable } from '../pi/node-environment'
import { capabilityBackupDir } from '../services/app-paths'
import { SkillMutationError } from '../services/errors'
import { redactSecretText } from '../services/logger'
import { parseSkillDirectory, type ParsedSkill } from './skill-parser'

const execFileP = promisify(execFile)
const INSTALL_TIMEOUT_MS = 5 * 60_000
const INSTALLER_ENV_ALLOWLIST = [
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS'
] as const

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface CommandOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export interface SkillInstallOutput {
  installPath: string
  parsed: ParsedSkill
  stdout: string
  stderr: string
  exitCode: number
  backupPath: string | null
}

export interface SkillInstallerDependencies {
  resolveNpm: () => Promise<string>
  runCommand: (
    executable: string,
    args: string[],
    options: CommandOptions
  ) => Promise<CommandResult>
  makeTempDir: () => Promise<string>
  backupRoot: () => string
  fixtureRoot: () => string | null
}

function toText(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf8')
}

async function runCommand(
  executable: string,
  args: string[],
  options: CommandOptions
): Promise<CommandResult> {
  const isWindowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
  const file = isWindowsShim ? (process.env.ComSpec ?? 'cmd.exe') : executable
  const commandArgs = isWindowsShim ? ['/d', '/s', '/c', executable, ...args] : args
  const execOptions: ExecFileOptions = {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true
  }
  try {
    const { stdout, stderr } = await execFileP(file, commandArgs, execOptions)
    return {
      stdout: redactSecretText(toText(stdout)),
      stderr: redactSecretText(toText(stderr)),
      exitCode: 0
    }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer
      stderr?: string | Buffer
      code?: number | string
      signal?: NodeJS.Signals
    }
    if (failure.signal === 'SIGTERM' || String(failure.code).includes('TIMEDOUT')) {
      throw new SkillMutationError('PROCESS_FAILED', 'Skill installer timed out', {
        exitCode: null
      })
    }
    if (typeof failure.code === 'number') {
      return {
        stdout: redactSecretText(toText(failure.stdout ?? '')),
        stderr: redactSecretText(toText(failure.stderr ?? '')),
        exitCode: failure.code
      }
    }
    throw new SkillMutationError('PROCESS_FAILED', 'Unable to start the skill installer', {
      cause: redactSecretText(failure.message)
    })
  }
}

const defaults: SkillInstallerDependencies = {
  resolveNpm: resolveNpmExecutable,
  runCommand,
  makeTempDir: () => fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-skill-')),
  backupRoot: capabilityBackupDir,
  fixtureRoot: () => process.env.PI_HARNESS_CAPABILITY_FIXTURES_DIR?.trim() || null
}

export function assertSafeSkillChild(root: string, skillId: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(skillId)) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Invalid skill path segment')
  }
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, skillId)
  if (target === resolvedRoot || !target.startsWith(resolvedRoot + path.sep)) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Skill path escapes the configured root')
  }
  return target
}

function assertManagedSkillPath(root: string, skillPath: string, selector: string): string {
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(skillPath)
  const enabledPath = assertSafeSkillChild(resolvedRoot, selector)
  const disabledPath = path.resolve(resolvedRoot, `.${selector}.pi-harness-disabled`)
  if (resolvedPath !== enabledPath && resolvedPath !== disabledPath) {
    throw new SkillMutationError(
      'SKILL_PATH_INVALID',
      'Skill path is not managed by this capability'
    )
  }
  return resolvedPath
}

async function assertRealManagedDirectory(
  root: string,
  skillPath: string,
  selector: string
): Promise<string> {
  const resolvedRoot = path.resolve(root)
  const resolvedPath = assertManagedSkillPath(resolvedRoot, skillPath, selector)
  let rootStat: Awaited<ReturnType<typeof fs.lstat>>
  let skillStat: Awaited<ReturnType<typeof fs.lstat>>
  try {
    const stats = await Promise.all([fs.lstat(resolvedRoot), fs.lstat(resolvedPath)])
    rootStat = stats[0]
    skillStat = stats[1]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SkillMutationError('SKILL_NOT_FOUND', 'Installed skill was not found')
    }
    throw error
  }
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !skillStat.isDirectory() ||
    skillStat.isSymbolicLink()
  ) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Pi skill paths must be real directories')
  }
  const [realRoot, realPath] = await Promise.all([
    fs.realpath(resolvedRoot),
    fs.realpath(resolvedPath)
  ])
  if (path.dirname(realPath) !== realRoot) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Skill path escapes the configured root')
  }
  return resolvedPath
}

/** Build a minimal environment for untrusted third-party installer code. */
export function buildSkillInstallerEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  tempHome: string,
  npmExecutable: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of INSTALLER_ENV_ALLOWLIST) {
    if (baseEnv[key]) env[key] = baseEnv[key]
  }
  const inheritedPath = baseEnv.PATH ?? baseEnv.Path
  return {
    ...env,
    HOME: tempHome,
    USERPROFILE: tempHome,
    XDG_CONFIG_HOME: path.join(tempHome, '.config'),
    PATH: [path.dirname(npmExecutable), inheritedPath].filter(Boolean).join(path.delimiter),
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_ignore_scripts: 'true',
    npm_config_update_notifier: 'false',
    npm_config_progress: 'false',
    npm_config_cache: path.join(tempHome, '.npm-cache'),
    npm_config_userconfig: path.join(tempHome, '.npmrc'),
    npm_config_globalconfig: path.join(tempHome, '.npm-globalrc')
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function findStagedSkill(root: string, selector: string): Promise<string | null> {
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }]
  while (pending.length) {
    const current = pending.shift()
    if (!current || current.depth > 7) continue
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current.directory, { withFileTypes: true })
    } catch {
      continue
    }
    if (
      path.basename(current.directory) === selector &&
      entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')
    ) {
      return current.directory
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === 'node_modules') continue
      pending.push({
        directory: path.join(current.directory, entry.name),
        depth: current.depth + 1
      })
    }
  }
  return null
}

async function copyFixtureSkill(
  fixtureRoot: string,
  selector: string,
  tempHome: string
): Promise<void> {
  const source = assertSafeSkillChild(fixtureRoot, selector)
  const destination = path.join(tempHome, '.pi', 'agent', 'skills', selector)
  await fs.cp(source, destination, { recursive: true, errorOnExist: true })
}

export class SkillInstallService {
  private readonly dependencies: SkillInstallerDependencies

  constructor(dependencies: Partial<SkillInstallerDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies }
  }

  async install(
    definition: CapabilityDefinition,
    targetRoot: string,
    options: {
      replace: boolean
      existingPath?: string | null
      onPhase?: (phase: CapabilityMutationPhase) => void
    }
  ): Promise<SkillInstallOutput> {
    if (!definition.install || !definition.sourceUrl) {
      throw new SkillMutationError('SKILL_INVALID', 'Capability has no trusted install definition')
    }
    const selector = definition.install.selector
    const resolvedRoot = path.resolve(targetRoot)
    const desiredPath = assertSafeSkillChild(resolvedRoot, selector)
    const finalPath = options.existingPath ? path.resolve(options.existingPath) : desiredPath
    assertManagedSkillPath(resolvedRoot, finalPath, selector)
    if (!options.replace && (await pathExists(finalPath))) {
      throw new SkillMutationError('SKILL_ALREADY_INSTALLED', 'Skill is already installed')
    }

    options.onPhase?.('resolving')
    const tempHome = await this.dependencies.makeTempDir()
    let command: CommandResult = { stdout: '', stderr: '', exitCode: 0 }
    try {
      const fixtureRoot = this.dependencies.fixtureRoot()
      options.onPhase?.('installing')
      if (fixtureRoot) {
        await copyFixtureSkill(fixtureRoot, selector, tempHome)
      } else {
        const npm = await this.dependencies.resolveNpm().catch(() => {
          throw new SkillMutationError(
            'PROCESS_FAILED',
            'Node.js and npm are required to install skills'
          )
        })
        const args = [
          'exec',
          '--yes',
          '--package',
          'skills',
          '--',
          'skills',
          'add',
          definition.sourceUrl,
          '--skill',
          selector,
          '--global',
          '--agent',
          'pi',
          '--copy',
          '--yes'
        ]
        command = await this.dependencies.runCommand(npm, args, {
          cwd: tempHome,
          timeoutMs: INSTALL_TIMEOUT_MS,
          env: buildSkillInstallerEnvironment(process.env, tempHome, npm)
        })
      }

      if (command.exitCode !== 0) {
        const errorCode = /(?:ENOTFOUND|ECONNRESET|ETIMEDOUT|network|unable to resolve host)/i.test(
          command.stderr
        )
          ? 'NETWORK_ERROR'
          : 'SKILL_INSTALL_FAILED'
        throw new SkillMutationError(errorCode, 'Skill installation failed', {
          exitCode: command.exitCode,
          stderr: command.stderr.slice(0, 4000),
          stdout: command.stdout.slice(0, 2000)
        })
      }

      options.onPhase?.('validating')
      const stagedPath = await findStagedSkill(tempHome, selector)
      if (!stagedPath) {
        throw new SkillMutationError('SKILL_INVALID', 'Installer output does not contain SKILL.md')
      }
      const parsed = await parseSkillDirectory(stagedPath)
      if (!parsed || parsed.name.toLowerCase() !== selector.toLowerCase()) {
        throw new SkillMutationError('SKILL_INVALID', 'Installed skill metadata does not match')
      }

      await fs.mkdir(resolvedRoot, { recursive: true })
      const rootStat = await fs.lstat(resolvedRoot)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new SkillMutationError('SKILL_PATH_INVALID', 'Pi skill root must be a real directory')
      }

      const incoming = path.join(resolvedRoot, `.${selector}.install-${randomUUID()}`)
      await fs.cp(stagedPath, incoming, { recursive: true, errorOnExist: true })
      let backupPath: string | null = null
      try {
        if (await pathExists(finalPath)) {
          if (!options.replace) {
            throw new SkillMutationError('SKILL_ALREADY_INSTALLED', 'Skill is already installed')
          }
          await assertRealManagedDirectory(resolvedRoot, finalPath, selector)
          backupPath = await this.backup(finalPath, selector, 'update')
          await fs.rm(finalPath, { recursive: true, force: true })
        }
        await fs.rename(incoming, finalPath)
      } catch (error) {
        await fs.rm(incoming, { recursive: true, force: true }).catch(() => undefined)
        if (backupPath && !(await pathExists(finalPath))) {
          await fs.cp(backupPath, finalPath, { recursive: true }).catch(() => undefined)
        }
        throw error
      }

      const installed = await parseSkillDirectory(finalPath)
      if (!installed) {
        throw new SkillMutationError('SKILL_INVALID', 'Installed SKILL.md failed final validation')
      }
      return {
        installPath: finalPath,
        parsed: installed,
        stdout: command.stdout.slice(0, 4000),
        stderr: command.stderr.slice(0, 4000),
        exitCode: command.exitCode,
        backupPath
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') {
        throw new SkillMutationError('SKILL_PERMISSION_DENIED', 'Skill directory is not writable')
      }
      throw error
    } finally {
      await fs.rm(tempHome, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async uninstall(skillPath: string, root: string, selector: string): Promise<string> {
    const resolvedRoot = path.resolve(root)
    const resolvedPath = await assertRealManagedDirectory(resolvedRoot, skillPath, selector)
    if (!(await parseSkillDirectory(resolvedPath))) {
      throw new SkillMutationError('SKILL_NOT_FOUND', 'Installed skill was not found')
    }
    const backupPath = await this.backup(resolvedPath, selector, 'uninstall')
    try {
      await fs.rm(resolvedPath, { recursive: true, force: false })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') {
        throw new SkillMutationError('SKILL_PERMISSION_DENIED', 'Skill directory is not writable')
      }
      throw new SkillMutationError('SKILL_INSTALL_FAILED', 'Unable to uninstall skill')
    }
    return backupPath
  }

  async setEnabled(
    skillPath: string,
    root: string,
    selector: string,
    enabled: boolean
  ): Promise<string> {
    const resolvedRoot = path.resolve(root)
    const currentPath = await assertRealManagedDirectory(resolvedRoot, skillPath, selector)
    if (!(await parseSkillDirectory(currentPath))) {
      throw new SkillMutationError('SKILL_NOT_FOUND', 'Installed skill was not found')
    }
    const nextPath = enabled
      ? assertSafeSkillChild(resolvedRoot, selector)
      : path.resolve(resolvedRoot, `.${selector}.pi-harness-disabled`)
    if (!nextPath.startsWith(resolvedRoot + path.sep)) {
      throw new SkillMutationError('SKILL_PATH_INVALID', 'Skill path escapes the configured root')
    }
    if (nextPath === currentPath) return currentPath
    if (await pathExists(nextPath)) {
      throw new SkillMutationError('SKILL_CONFLICT', 'Skill enable state conflicts on disk')
    }
    await fs.rename(currentPath, nextPath)
    return nextPath
  }

  private async backup(source: string, selector: string, action: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destination = path.join(
      this.dependencies.backupRoot(),
      `${stamp}-${action}-${selector}-${randomUUID()}`
    )
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.cp(source, destination, { recursive: true, errorOnExist: true })
    return destination
  }
}
