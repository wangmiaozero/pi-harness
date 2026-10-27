// @vitest-environment node
/**
 * ECC real-runtime lifecycle acceptance (Phase 4.5).
 *
 * These tests drive the REAL Pi CLI (pinned @earendil-works/pi-coding-agent
 * shipped with Pi-Harness) and the REAL Pi SDK resource loader against an
 * ISOLATED config directory and workspace. No user configuration under
 * ~/.pi is touched: every service is pointed at the sandbox through the
 * settings store's manualConfigDir / manualCliPath, which PiPackageManager
 * forwards as PI_CODING_AGENT_DIR to the spawned CLI.
 *
 * The suite performs real network operations (git clone of the ECC package),
 * so it is gated behind RUN_ECC_RUNTIME_E2E=1 and skipped in normal unit
 * test runs. Execute with:
 *
 *   RUN_ECC_RUNTIME_E2E=1 pnpm vitest run src/main/capabilities/ecc-runtime-lifecycle.test.ts
 *
 * A proxy may be required in restricted networks (https_proxy / http_proxy),
 * which is inherited by the spawned Pi CLI and git.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DefaultResourceLoader, SessionManager, createAgentSession } from '@earendil-works/pi-coding-agent'

import { JsonStore } from '../services/storage'
import { PiPackageManager } from '../packages/package-manager'
import { SkillsService } from '../services/skills-service'
import { BackupService } from '../backup/backup-service'
import { PiConfigService } from '../pi/config-service'
import { SkillRegistry } from './skill-registry'
import { CapabilityService } from './capability-service'
import { SkillInstallService } from './skill-installer'
import type { AppMetadata } from '../services/metadata-store'
import type { AppSettings } from '@shared/ipc/api-types'

const RUN_E2E = process.env.RUN_ECC_RUNTIME_E2E === '1'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
const PI_CLI = path.join(
  REPO_ROOT,
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'dist',
  'bundle',
  'cli.js'
)

const ECC_SOURCE = 'git:github.com/affaan-m/ECC'
const METADATA_DEFAULTS: AppMetadata = {
  providers: {},
  models: {},
  capabilities: {},
  builtinSkills: { schemaVersion: 1, installed: {} }
}

interface LoadedRuntime {
  loader: DefaultResourceLoader
  eccSkillCount: number
  eccPromptCount: number
  skillNames: Set<string>
  promptNames: string[]
  eccExtensionLoaded: boolean
  extensionHandlers: string[]
  extensionCommands: string[]
  diagnostics: number
}

async function countFiles(root: string, name: string): Promise<number> {
  let count = 0
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name))
      else if (entry.isFile() && entry.name === name) count += 1
    }
  }
  await walk(root)
  return count
}

async function loadRuntime(agentDir: string, cwd: string): Promise<LoadedRuntime> {
  const loader = new DefaultResourceLoader({ cwd, agentDir })
  await loader.reload()
  const skills = loader.getSkills()
  const prompts = loader.getPrompts()
  const extensions = loader.getExtensions()
  const eccSkills = skills.skills.filter((skill) => skill.filePath.startsWith(agentDir))
  const eccPrompts = prompts.prompts.filter((prompt) => prompt.filePath.startsWith(agentDir))
  const eccExtension = extensions.extensions.find((entry) => entry.resolvedPath.startsWith(agentDir))
  return {
    loader,
    eccSkillCount: eccSkills.length,
    eccPromptCount: eccPrompts.length,
    skillNames: new Set(skills.skills.map((skill) => skill.name)),
    promptNames: prompts.prompts.map((prompt) => prompt.name),
    eccExtensionLoaded: Boolean(eccExtension),
    extensionHandlers: eccExtension ? [...eccExtension.handlers.keys()] : [],
    extensionCommands: eccExtension ? [...eccExtension.commands.keys()] : [],
    diagnostics: skills.diagnostics.length + prompts.diagnostics.length
  }
}

describe.skipIf(!RUN_E2E)('ECC real runtime lifecycle (isolated sandbox)', () => {
  let sandbox = ''
  let agentDir = ''
  let workspace = ''
  let settingsStore: JsonStore<AppSettings>
  let metadataStore: JsonStore<AppMetadata>
  let packageManager: PiPackageManager
  let registry: SkillRegistry
  let capabilityService: CapabilityService
  let installedRoot = ''

  const readRegistryPackages = async (): Promise<unknown> => {
    const text = await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8').catch(() => null)
    if (!text) return undefined
    return (JSON.parse(text) as { packages?: unknown }).packages
  }

  const newManager = (): PiPackageManager =>
    new PiPackageManager(settingsStore)

  beforeAll(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'ecc-runtime-e2e-'))
    agentDir = path.join(sandbox, 'pi-config')
    workspace = path.join(sandbox, 'workspace')
    await fs.mkdir(agentDir, { recursive: true })
    await fs.mkdir(workspace, { recursive: true })
    // A minimal project so ECC's SessionStart hook can produce project context.
    await fs.writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'ecc-acceptance-workspace', version: '1.0.0', private: true })
    )
    settingsStore = new JsonStore<AppSettings>(path.join(sandbox, 'app-settings.json'), {} as AppSettings)
    await settingsStore.update({ manualCliPath: PI_CLI, manualConfigDir: agentDir })
    // Real desktop wiring: BackupService + PiConfigService manage the global
    // registry file. Only the backup root is redirected into the sandbox so
    // the real user's backups are never touched.
    const backupService = new BackupService(settingsStore)
    ;(backupService as unknown as { root: () => string }).root = () =>
      path.join(sandbox, 'backups')
    const configService = new PiConfigService(settingsStore, backupService)
    metadataStore = new JsonStore<AppMetadata>(path.join(sandbox, 'app-metadata.json'), METADATA_DEFAULTS)
    packageManager = new PiPackageManager(settingsStore, configService)
    registry = new SkillRegistry(settingsStore, metadataStore, new SkillsService(settingsStore, packageManager))
    capabilityService = new CapabilityService(metadataStore, registry, new SkillInstallService(), packageManager)
  }, 30_000)

  afterAll(async () => {
    await fs.rm(sandbox, { recursive: true, force: true }).catch(() => undefined)
  })

  it('installs ECC through the real Pi CLI and registers it', async () => {
    const result = await capabilityService.install('ecc')
    expect(result.phase).toBe('success')
    expect(result.exitCode).toBe(0)

    installedRoot = path.join(agentDir, 'git', 'github.com', 'affaan-m', 'ECC')
    const stat = await fs.stat(path.join(installedRoot, 'package.json'))
    expect(stat.isFile()).toBe(true)

    // Pi registry entry written into the isolated config dir.
    const packages = await readRegistryPackages()
    expect(packages).toEqual([ECC_SOURCE])

    // Official Pi adapter files exist.
    await expect(fs.access(path.join(installedRoot, '.pi', 'extensions', 'index.ts'))).resolves.toBeUndefined()
    const manifest = JSON.parse(await fs.readFile(path.join(installedRoot, 'package.json'), 'utf8')) as {
      version: string
      pi: { extensions: string[]; skills: string[]; prompts: string[] }
    }
    expect(manifest.version).toBe('2.2.3')
    expect(manifest.pi.extensions).toContain('./.pi/extensions/index.ts')
    expect(manifest.pi.skills).toContain('./skills')
    expect(manifest.pi.prompts).toContain('./commands')

    // Harness metadata tracks the installation.
    expect(metadataStore.peek().capabilities.ecc?.enabled).toBe(true)

    // Registry sees a healthy managed package with real resources.
    const packages1 = await newManager().list()
    const ecc = packages1.find((pkg) => pkg.source === ECC_SOURCE)
    expect(ecc).toMatchObject({
      registered: true,
      installed: true,
      healthy: true,
      health: 'healthy',
      managed: true,
      scope: 'global'
    })
    expect(ecc?.resources.skills.length).toBeGreaterThan(0)
    expect(ecc?.resources.prompts.length).toBeGreaterThan(0)
  }, 420_000)

  it('refuses a duplicate install instead of double-registering', async () => {
    await expect(capabilityService.install('ecc')).rejects.toThrow(/already installed/i)
    const packages = await readRegistryPackages()
    expect((packages as unknown[]).length).toBe(1)
  }, 60_000)

  it('discovers ECC skills, commands and the adapter through the real Pi runtime', async () => {
    const runtime = await loadRuntime(agentDir, workspace)
    const upstreamSkillCount = await countFiles(path.join(installedRoot, 'skills'), 'SKILL.md')
    const upstreamCommandCount = (await fs.readdir(path.join(installedRoot, 'commands')))
      .filter((name) => name.endsWith('.md')).length

    expect(runtime.eccSkillCount).toBe(upstreamSkillCount)
    expect(runtime.eccSkillCount).toBeGreaterThan(250)
    expect(runtime.eccPromptCount).toBe(upstreamCommandCount)
    expect(runtime.eccPromptCount).toBeGreaterThan(80)
    expect(runtime.diagnostics).toBe(0)

    // Skills verifiably present in ECC 2.2.3 are discovered by name.
    for (const expected of ['coding-standards', 'tdd-workflow', 'security-review', 'verification-loop']) {
      expect(runtime.skillNames.has(expected)).toBe(true)
    }

    // Prompt command names are unique (no collisions).
    expect(new Set(runtime.promptNames).size).toBe(runtime.promptNames.length)

    // The official adapter extension is loaded with its lifecycle handlers.
    expect(runtime.eccExtensionLoaded).toBe(true)
    expect(runtime.extensionHandlers).toEqual(
      expect.arrayContaining(['session_start', 'before_agent_start', 'session_shutdown'])
    )
    expect(runtime.extensionCommands).toContain('ecc-doctor')
  }, 240_000)

  it('runs ECC hooks in a real session and injects rules and session context', async () => {
    const loader = new DefaultResourceLoader({ cwd: workspace, agentDir })
    await loader.reload()
    const { session, extensionsResult } = await createAgentSession({
      cwd: workspace,
      agentDir,
      sessionManager: SessionManager.inMemory(workspace)
    })
    try {
      const ecc = extensionsResult.extensions.find((entry) => entry.resolvedPath.startsWith(agentDir))
      expect(ecc).toBeTruthy()
      const ctx = extensionsResult.runtime.createContext()
      const notifications: Array<{ message: string; type?: string }> = []
      ctx.ui.notify = (message, type) => {
        notifications.push({ message, type })
      }

      // Real ECC SessionStart hook subprocess runs through the live event bus.
      for (const handler of ecc!.handlers.get('session_start') ?? []) {
        await handler({ reason: 'startup' }, ctx)
      }
      expect(notifications).toEqual([])

      // before_agent_start folds rules + one-shot session context into the prompt.
      let result: { systemPrompt?: string } | undefined
      for (const handler of ecc!.handlers.get('before_agent_start') ?? []) {
        result = (await handler({ systemPrompt: 'BASE_PROMPT' }, ctx)) as
          | { systemPrompt?: string }
          | undefined
      }
      const systemPrompt = result?.systemPrompt ?? ''
      expect(systemPrompt).toContain('BASE_PROMPT')
      expect(systemPrompt).toContain('<ecc-engineering-rules>')
      const rules = systemPrompt.match(/<ecc-engineering-rules>([\s\S]*?)<\/ecc-engineering-rules>/)?.[1] ?? ''
      expect(rules.length).toBeGreaterThan(5000)
      expect(systemPrompt).toContain('<ecc-session-context>')
      expect(systemPrompt).toMatch(/Project type:/)

      // Session shutdown hook also runs without failure.
      for (const handler of ecc!.handlers.get('session_shutdown') ?? []) {
        await handler({ reason: 'quit' }, ctx)
      }
      expect(notifications).toEqual([])
    } finally {
      await session.dispose()
    }
  }, 240_000)

  it('isolates broken, failing, timed-out and invalid-output hooks', async () => {
    // Faults are injected into a lightweight copy of the installed package so
    // the real registration and files stay untouched.
    const copyRoot = path.join(sandbox, 'ecc-fault-copy')
    for (const dir of ['scripts', 'rules/common', '.pi/extensions']) {
      await fs.cp(path.join(installedRoot, dir), path.join(copyRoot, dir), { recursive: true })
    }
    await fs.cp(path.join(installedRoot, 'package.json'), path.join(copyRoot, 'package.json'))
    const adapterPath = path.join(copyRoot, '.pi', 'extensions', 'index.ts')

    const loadFaulty = async (): Promise<{
      start: (ctxExtensions: unknown) => Promise<string[]>
    }> => {
      const loader = new DefaultResourceLoader({
        cwd: workspace,
        agentDir,
        additionalExtensionPaths: [adapterPath]
      })
      await loader.reload()
      const extensions = loader.getExtensions()
      const ext = extensions.extensions.find((entry) => entry.resolvedPath.includes('ecc-fault-copy'))
      expect(ext).toBeTruthy()
      const notifications: string[] = []
      // A minimal ExtensionContext stub: the adapter only touches ui, cwd and
      // the session id, and the standalone loader has no bound runtime.
      const ctx = {
        ui: {
          notify: (message: string) => {
            notifications.push(message)
          }
        },
        cwd: workspace,
        sessionManager: { getSessionId: () => 'ecc-fault-test' }
      } as never
      return {
        start: async () => {
          for (const handler of ext!.handlers.get('session_start') ?? []) {
            await handler({ reason: 'startup' }, ctx)
          }
          return notifications
        }
      }
    }

    const runFault = async (mutate: () => Promise<void>) => {
      // Restore a pristine hook tree so mutations do not leak between cases.
      await fs.rm(path.join(copyRoot, 'scripts', 'hooks'), { recursive: true, force: true })
      await fs.cp(path.join(installedRoot, 'scripts'), path.join(copyRoot, 'scripts'), {
        recursive: true
      })
      await mutate()
      const faulty = await loadFaulty()
      return faulty.start(undefined)
    }

    // 1. Hook runner missing → warning, no crash.
    let notes = await runFault(async () => {
      await fs.rm(path.join(copyRoot, 'scripts', 'hooks', 'run-with-flags.js'))
    })
    expect(notes.join('\n')).toMatch(/hook runner not found/i)

    // 2. Hook exits non-zero → warning, no crash.
    notes = await runFault(async () => {
      await fs.writeFile(path.join(copyRoot, 'scripts', 'hooks', 'session-start.js'), 'process.exit(3)\n')
    })
    expect(notes.length).toBeGreaterThan(0)

    // 3. Hook hangs → 30s adapter timeout → warning, no crash.
    notes = await runFault(async () => {
      await fs.writeFile(
        path.join(copyRoot, 'scripts', 'hooks', 'session-start.js'),
        'setTimeout(() => {}, 120000)\n'
      )
    })
    expect(notes.length).toBeGreaterThan(0)

    // 4. Hook prints invalid JSON → tolerated silently, no crash.
    notes = await runFault(async () => {
      await fs.writeFile(
        path.join(copyRoot, 'scripts', 'hooks', 'session-start.js'),
        "console.log('definitely not json')\n"
      )
    })
    expect(notes).toEqual([])
  }, 300_000)

  it('disables ECC: registry entry removed, files kept, new sessions stop loading it', async () => {
    const entry = await packageManager.readRegistryEntry({ source: ECC_SOURCE, scope: 'global', projectRoot: null })
    expect(entry).toBe(ECC_SOURCE)

    const result = await capabilityService.setEnabled('ecc', false)
    expect(result.phase).toBe('success')

    // Raw entry snapshot stored in harness metadata for verbatim restore.
    expect(metadataStore.peek().capabilities.ecc?.enabled).toBe(false)
    expect(metadataStore.peek().capabilities.ecc?.packageRegistryEntry).toBe(ECC_SOURCE)

    // Registry entry gone, files still on disk.
    expect(await readRegistryPackages()).toEqual([])
    await expect(fs.access(path.join(installedRoot, 'package.json'))).resolves.toBeUndefined()

    const packages = await newManager().list()
    const ecc = packages.find((pkg) => pkg.source === ECC_SOURCE)
    expect(ecc?.registered).toBe(false)
    expect(ecc?.installed).toBe(true)
    expect(ecc?.health).toBe('orphaned')

    // A fresh Pi runtime no longer discovers ECC resources or the adapter.
    const runtime = await loadRuntime(agentDir, workspace)
    expect(runtime.eccSkillCount).toBe(0)
    expect(runtime.eccPromptCount).toBe(0)
    expect(runtime.eccExtensionLoaded).toBe(false)

    // Capability catalog still reports the installation (disabled).
    const descriptors = await registry.list()
    const eccDescriptor = descriptors.find((descriptor) => descriptor.id === 'ecc')
    expect(eccDescriptor?.installed).toBe(true)
    expect(eccDescriptor?.enabled).toBe(false)
  }, 240_000)

  it('re-enables ECC: entry restored verbatim, resources discovered again', async () => {
    const storedEntry = metadataStore.peek().capabilities.ecc?.packageRegistryEntry
    const result = await capabilityService.setEnabled('ecc', true)
    expect(result.phase).toBe('success')
    expect(storedEntry).toBe(ECC_SOURCE)

    expect(await readRegistryPackages()).toEqual([ECC_SOURCE])
    const packages = await newManager().list()
    const ecc = packages.find((pkg) => pkg.source === ECC_SOURCE)
    expect(ecc).toMatchObject({ registered: true, installed: true, healthy: true })
    expect(metadataStore.peek().capabilities.ecc?.packageRegistryEntry).toBeUndefined()

    const runtime = await loadRuntime(agentDir, workspace)
    expect(runtime.eccSkillCount).toBeGreaterThan(250)
    expect(runtime.eccExtensionLoaded).toBe(true)
  }, 240_000)

  it('survives repeated enable/disable cycles without registry drift', async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const disable = await capabilityService.setEnabled('ecc', false)
      expect(disable.phase).toBe('success')
      expect(await readRegistryPackages()).toEqual([])
      const enable = await capabilityService.setEnabled('ecc', true)
      expect(enable.phase).toBe('success')
      expect(await readRegistryPackages()).toEqual([ECC_SOURCE])
    }
    const packages = await newManager().list()
    const eccEntries = packages.filter((pkg) => pkg.source === ECC_SOURCE)
    expect(eccEntries).toHaveLength(1)
    expect(eccEntries[0]?.problems).toEqual([])
    // No stray package directories leaked into the managed git root.
    const gitRoot = path.join(agentDir, 'git', 'github.com', 'affaan-m')
    expect((await fs.readdir(gitRoot)).sort()).toEqual(['ECC'])
  }, 240_000)

  it('updates ECC with no upstream change and keeps a single healthy entry', async () => {
    const before = (await newManager().list()).find((pkg) => pkg.source === ECC_SOURCE)
    const result = await capabilityService.update('ecc')
    expect(result.phase).toBe('success')
    const after = (await newManager().list()).find((pkg) => pkg.source === ECC_SOURCE)
    expect(after?.version).toBe(before?.version)
    expect(after?.registered).toBe(true)
    expect(after?.healthy).toBe(true)
    expect(await readRegistryPackages()).toEqual([ECC_SOURCE])
    const runtime = await loadRuntime(agentDir, workspace)
    expect(runtime.eccSkillCount).toBeGreaterThan(250)
  }, 420_000)

  it('rolls back an update failure without losing the working installation', async () => {
    const packagesBefore = await readRegistryPackages()
    const healthBefore = (await newManager().list()).find((pkg) => pkg.source === ECC_SOURCE)

    // Fault injection: point the package's git origin at an unreachable host so
    // the real `pi update` fails during the git fetch.
    const gitConfig = path.join(installedRoot, '.git', 'config')
    const originalConfig = await fs.readFile(gitConfig, 'utf8')
    await fs.writeFile(gitConfig, originalConfig.replace(/url = .*/, 'url = https://github.invalid/affaan-m/ECC.git'))
    try {
      await capabilityService.update('ecc')
      throw new Error('update against an unreachable origin unexpectedly succeeded')
    } catch (error) {
      expect((error as Error).message).not.toContain('unexpectedly succeeded')
    } finally {
      await fs.writeFile(gitConfig, originalConfig)
    }

    // Registry and files are intact; package still healthy.
    expect(await readRegistryPackages()).toEqual(packagesBefore)
    const after = (await newManager().list()).find((pkg) => pkg.source === ECC_SOURCE)
    expect(after?.registered).toBe(healthBefore?.registered)
    expect(after?.installed).toBe(true)
    const runtime = await loadRuntime(agentDir, workspace)
    expect(runtime.eccSkillCount).toBeGreaterThan(250)
  }, 240_000)

  it('uninstalls the enabled ECC package cleanly', async () => {
    const result = await capabilityService.uninstall('ecc')
    expect(result.phase).toBe('success')

    expect(await readRegistryPackages()).toEqual([])
    await expect(fs.access(installedRoot)).rejects.toThrow()
    expect(metadataStore.peek().capabilities.ecc).toBeUndefined()

    const packages = await newManager().list()
    expect(packages.find((pkg) => pkg.source === ECC_SOURCE)).toBeUndefined()
    const runtime = await loadRuntime(agentDir, workspace)
    expect(runtime.eccSkillCount).toBe(0)
    expect(runtime.eccPromptCount).toBe(0)
    expect(runtime.eccExtensionLoaded).toBe(false)
    expect(runtime.loader.getSkills().diagnostics).toEqual([])
  }, 420_000)

  it('reinstall → disable → uninstall removes files via the orphan path', async () => {
    await capabilityService.install('ecc')
    expect(await readRegistryPackages()).toEqual([ECC_SOURCE])

    await capabilityService.setEnabled('ecc', false)
    expect(await readRegistryPackages()).toEqual([])

    const result = await capabilityService.uninstall('ecc')
    expect(result.phase).toBe('success')
    await expect(fs.access(installedRoot)).rejects.toThrow()
    expect(metadataStore.peek().capabilities.ecc).toBeUndefined()
    expect((await newManager().list()).find((pkg) => pkg.source === ECC_SOURCE)).toBeUndefined()
  }, 420_000)

  it('reports a second uninstall as not-found and keeps Pi usable afterwards', async () => {
    await expect(capabilityService.uninstall('ecc')).rejects.toThrow(/not installed/i)
    // A fresh runtime over the empty isolated config still loads cleanly.
    const runtime = await loadRuntime(agentDir, workspace)
    expect(runtime.eccSkillCount).toBe(0)
    expect(runtime.diagnostics).toBe(0)
  }, 120_000)
})
