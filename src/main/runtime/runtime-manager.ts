import { inspectMcpCompatibility } from './mcp-compatibility'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  RuntimeConfiguration,
  RuntimeDiagnostics,
  RuntimeKind,
  RuntimeSelection,
  ResolvedRuntime
} from '@shared/runtime/schema'
import { DEFAULT_RUNTIME_CONFIGURATION, runtimeSelectionSchema } from '@shared/runtime/schema'
import { atomicWriteJson, readJsonFile } from '../services/storage'
import { resolveExecutable, resolveLoginShellPath } from '../environment/command-resolver'
import { nodeToolDirectories } from '../pi/node-environment'
import { EnvironmentError, ValidationError } from '../services/errors'
import { acquireDistribution, catalog, runtimeLayout, verifyDistribution } from './distribution.mjs'
import type { RuntimeFetcher } from './distribution.mjs'
import { buildRuntimeEnvironment } from './environment'
import { validateExecutable, probe } from './validator'
import { RuntimeVersionService } from './runtime-versions'
import type { RuntimeUpdateReport } from '@shared/runtime/schema'

interface RuntimeState {
  configuration: RuntimeConfiguration
  active: Partial<Record<RuntimeKind, string>>
  previous: Partial<Record<RuntimeKind, string | null>>
}
export interface RuntimeManagerOptions {
  bundledRoot: string
  userRoot: string
  stateFile: string
  cache: string
  legacyPiPath?: string | null
  piConfigDir?: () => string
  compatibilityMode?: boolean
  busy?: () => boolean
  activeSessions?: () => number
  stopIdle?: () => Promise<void>
  environment?: NodeJS.ProcessEnv
  fetcher?: RuntimeFetcher
  versionFetcher?: RuntimeFetcher
  appVersion?: string
}

export class RuntimeManager {
  private readonly versions: RuntimeVersionService
  private state: RuntimeState | null = null
  private mutation: Promise<unknown> | null = null
  private cache = new Map<string, Promise<ResolvedRuntime>>()
  private bundledMetadata = new Map<string, ResolvedRuntime>()
  private metadataGeneration = 0

  private resetBundledMetadata(): void {
    this.metadataGeneration++
    this.bundledMetadata.clear()
  }
  constructor(private readonly options: RuntimeManagerOptions) {
    this.versions = new RuntimeVersionService({
      cacheFile: `${options.stateFile}.versions.json`,
      fetcher: options.versionFetcher,
      appVersion: options.appVersion
    })
  }

  async initialize(): Promise<void> {
    if (this.state) return
    const stored = await readJsonFile<RuntimeState>(this.options.stateFile)
    if (stored) {
      const pi = runtimeSelectionSchema.safeParse(stored.configuration?.pi)
      const node = runtimeSelectionSchema.safeParse(stored.configuration?.node)
      if (!pi.success || !node.success)
        throw new ValidationError('Invalid runtime configuration; original file has been preserved')
      // Version pointers are directory names, never user-controlled filesystem paths.
      for (const value of [
        ...Object.values(stored.active ?? {}),
        ...Object.values(stored.previous ?? {})
      ]) {
        if (value !== null && !/^\d+\.\d+\.\d+-[a-f0-9-]+$/.test(value))
          throw new ValidationError('Invalid managed runtime version')
      }
      this.state = {
        configuration: { pi: pi.data, node: node.data },
        active: stored.active ?? {},
        previous: stored.previous ?? {}
      }
    } else {
      this.state = {
        configuration: structuredClone(DEFAULT_RUNTIME_CONFIGURATION),
        active: {},
        previous: {}
      }
      const legacy = this.options.legacyPiPath?.trim()
      if (legacy) this.state.configuration.pi = { source: 'custom', customPath: legacy }
    }
  }
  async configuration(): Promise<RuntimeConfiguration> {
    await this.initialize()
    return structuredClone(this.state!.configuration)
  }
  isChanging(): boolean {
    return this.mutation !== null
  }
  invalidate(): void {
    this.cache.clear()
  }

  async resolve(kind: RuntimeKind, selection?: RuntimeSelection): Promise<ResolvedRuntime> {
    await this.initialize()
    const selected = selection ?? this.state!.configuration[kind]
    const key = JSON.stringify([kind, selected, this.state!.active[kind]])
    let pending = this.cache.get(key)
    if (!pending) {
      pending = this.resolveUncached(kind, selected)
      this.cache.set(key, pending)
      const request = pending
      void request.then(
        () => {
          if (this.cache.get(key) !== request) return
          // Share the entire verification before timing its short-lived result.
          const timer = setTimeout(() => {
            if (this.cache.get(key) === request) this.cache.delete(key)
          }, 10_000)
          timer.unref()
        },
        () => {
          if (this.cache.get(key) === request) this.cache.delete(key)
        }
      )
    }
    return structuredClone(await pending)
  }
  resolvePiRuntime(): Promise<ResolvedRuntime> {
    return this.resolve('pi')
  }
  resolveNodeRuntime(): Promise<ResolvedRuntime> {
    return this.resolve('node')
  }
  validatePiRuntime(selection: RuntimeSelection): Promise<ResolvedRuntime> {
    this.resetBundledMetadata()
    this.invalidate()
    return this.resolve('pi', selection)
  }
  validateNodeRuntime(selection: RuntimeSelection): Promise<ResolvedRuntime> {
    this.resetBundledMetadata()
    this.invalidate()
    return this.resolve('node', selection)
  }
  switchPiRuntime(selection: RuntimeSelection): Promise<RuntimeDiagnostics> {
    return this.switchRuntime('pi', selection)
  }
  switchNodeRuntime(selection: RuntimeSelection): Promise<RuntimeDiagnostics> {
    return this.switchRuntime('node', selection)
  }

  async environment(
    purpose: 'pi' | 'mcp' | 'extension' | 'npm' | 'terminal',
    base?: NodeJS.ProcessEnv
  ): Promise<NodeJS.ProcessEnv> {
    const inherited = base ?? this.options.environment ?? process.env
    if (purpose === 'terminal') return { ...inherited }
    const node = await this.resolve('node')
    const baseEnvironment = { ...inherited }
    if (node.source === 'system') {
      const login = await resolveLoginShellPath({ probeNode: false })
      Object.assign(baseEnvironment, login.env)
      if (login.path)
        baseEnvironment.PATH = [login.path, inherited.PATH].filter(Boolean).join(path.delimiter)
    }
    return buildRuntimeEnvironment(
      baseEnvironment,
      node.valid ? node.executablePath : null,
      purpose
    )
  }
  async diagnostics(): Promise<RuntimeDiagnostics> {
    const [configuration, pi, node] = await Promise.all([
      this.configuration(),
      this.resolve('pi'),
      this.resolve('node')
    ])
    const mcpConfig = this.options.piConfigDir
      ? await readJsonFile<unknown>(path.join(this.options.piConfigDir(), 'mcp.json')).catch(
          () => null
        )
      : null
    return {
      versions: await this.versions.report({ pi, node }),
      mcp: inspectMcpCompatibility(mcpConfig, node),
      compatibilityMode: this.options.compatibilityMode === true,
      configuration,
      pi,
      node,
      activeSessions: this.options.activeSessions?.() ?? (this.options.busy?.() ? 1 : 0),
      restartRequired: false,
      previous: {
        pi: Object.hasOwn(this.state!.previous, 'pi'),
        node: Object.hasOwn(this.state!.previous, 'node')
      }
    }
  }
  getRuntimeDiagnostics(): Promise<RuntimeDiagnostics> {
    return this.diagnostics()
  }

  async switchRuntime(kind: RuntimeKind, input: RuntimeSelection): Promise<RuntimeDiagnostics> {
    const selection = runtimeSelectionSchema.parse(input)
    return this.exclusive(async () => {
      this.invalidate()
      const resolved = await this.resolve(kind, selection)
      if (!resolved.valid)
        throw new EnvironmentError('COMMAND_FAILED', resolved.diagnosticMessages.join('; '))
      await this.assertIdle()
      const next = structuredClone(this.state!)
      next.configuration[kind] = selection
      await this.commit(next)
      return this.diagnostics()
    })
  }

  async verify(kind: RuntimeKind): Promise<RuntimeDiagnostics> {
    this.resetBundledMetadata()
    this.invalidate()
    await this.resolve(kind)
    return this.diagnostics()
  }
  async checkUpdates(): Promise<RuntimeUpdateReport> {
    const info = await this.diagnostics()
    return {
      versions: await this.versions.report(info, true),
      pi: {
        installed: info.pi.version,
        available: catalog.pi.version,
        managed: info.pi.source === 'bundled'
      },
      node: {
        installed: info.node.version,
        available: catalog.node.version,
        managed: info.node.source === 'bundled'
      }
    }
  }
  async update(
    kind: RuntimeKind,
    signal?: AbortSignal,
    onProgress?: (phase: string, progress: number) => void
  ): Promise<RuntimeDiagnostics> {
    return this.exclusive(async () => {
      await this.initialize()
      if (this.state!.configuration[kind].source !== 'bundled')
        throw new ValidationError('System and custom runtimes are managed by their owner')
      if (this.options.busy?.())
        throw new ValidationError('Finish or stop active sessions before updating runtimes')
      const previousRuntime = await this.resolve(kind)
      const id = `${catalog[kind].version}-${randomUUID()}`
      const destination = path.join(this.options.userRoot, kind, id)
      await acquireDistribution({
        kind,
        platform: process.platform,
        arch: process.arch,
        destination,
        cache: this.options.cache,
        signal,
        fetcher: this.options.fetcher,
        onProgress
      })
      try {
        signal?.throwIfAborted()
        const target = await this.validateRoot(kind, destination)
        if (!target.valid || (kind === 'node' && (!target.npm || !target.npx)))
          throw new ValidationError('Downloaded runtime verification failed')
        await this.assertIdle()
        signal?.throwIfAborted()
        const next = structuredClone(this.state!)
        const baseline = path.join(
          this.options.bundledRoot,
          kind,
          runtimeLayout(kind, process.platform).executable
        )
        const baselinePath = await fs.realpath(baseline).catch(() => baseline)
        if (previousRuntime.valid)
          next.previous[kind] =
            previousRuntime.executablePath === baselinePath ? null : (next.active[kind] ?? null)
        else delete next.previous[kind]
        next.active[kind] = id
        await this.commit(next)
      } catch (error) {
        await fs.rm(destination, { recursive: true, force: true })
        throw error
      }
      return this.diagnostics()
    })
  }
  async rollback(kind: RuntimeKind): Promise<RuntimeDiagnostics> {
    return this.exclusive(async () => {
      await this.initialize()
      if (this.state!.configuration[kind].source !== 'bundled')
        throw new ValidationError('Choose the bundled runtime before restoring a managed version')
      if (!Object.hasOwn(this.state!.previous, kind))
        throw new ValidationError('No previous runtime is available')
      const previous = this.state!.previous[kind]
      const target = previous
        ? path.join(this.options.userRoot, kind, previous)
        : path.join(this.options.bundledRoot, kind)
      if (!(await this.validateRoot(kind, target)).valid)
        throw new ValidationError('Previous runtime verification failed')
      await this.assertIdle()
      const next = structuredClone(this.state!)
      next.previous[kind] = next.active[kind] ?? null
      if (previous) next.active[kind] = previous
      else delete next.active[kind]
      await this.commit(next)
      return this.diagnostics()
    })
  }

  private async resolveUncached(
    kind: RuntimeKind,
    selection: RuntimeSelection
  ): Promise<ResolvedRuntime> {
    const base = this.options.environment ?? process.env
    if (selection.source === 'bundled') {
      const id = this.state!.active[kind]
      const current = await this.validateRoot(
        kind,
        id ? path.join(this.options.userRoot, kind, id) : path.join(this.options.bundledRoot, kind)
      )
      if (id && !current.valid) {
        const baseline = await this.validateRoot(kind, path.join(this.options.bundledRoot, kind))
        if (baseline.valid) {
          baseline.diagnosticMessages.push(
            'The optional runtime is unavailable; the verified application baseline is being used'
          )
          return baseline
        }
      }
      return current
    }
    let discoverySource: string | undefined
    let executable: string | null = selection.customPath ?? null
    if (selection.source === 'system') {
      const login = await resolveLoginShellPath({ probeNode: true })
      discoverySource =
        kind === 'node' && login.node && login.shell ? 'login-shell' : 'process-path'
      executable =
        kind === 'node' && login.node
          ? login.node.path
          : (
              await resolveExecutable(kind, {
                env: base,
                additionalDirectories: await nodeToolDirectories(login.path, base),
                loginShell: true
              })
            ).path
    }
    if (
      executable &&
      process.platform === 'win32' &&
      /\.(cmd|bat)$/i.test(executable) &&
      kind === 'pi'
    ) {
      // npm's Windows shim has a stable package-relative entry; no shell interpolation.
      const entry = path.join(
        path.dirname(executable),
        'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'
      )
      if (await fs.stat(entry).catch(() => null)) executable = entry
    }
    const real = executable ? await fs.realpath(executable).catch(() => executable) : null
    if (kind === 'pi' && real && /\.[cm]?js$/i.test(real)) {
      const stat = await fs.stat(real).catch(() => null)
      if (!stat?.isFile())
        return {
          source: selection.source,
          executablePath: real,
          version: null,
          platform: process.platform,
          arch: process.arch,
          valid: false,
          integrity: 'unmanaged',
          diagnosticMessages: ['Pi entry must be a readable file']
        }
      const node = await this.resolve('node')
      const result: ResolvedRuntime = {
        source: selection.source,
        executablePath: real,
        version: null,
        platform: process.platform,
        arch: process.arch,
        valid: false,
        integrity: 'unmanaged',
        diagnosticMessages: []
      }
      if (!node.valid || !node.executablePath)
        result.diagnosticMessages.push(
          'The npm Pi installation requires a valid selected Node runtime'
        )
      else {
        try {
          const version = await probe(
            node.executablePath,
            [real, '--version'],
            await this.environment('pi')
          )
          result.version = version.match(/\d+\.\d+\.\d+/)?.[0] ?? null
          result.valid = result.version === catalog.pi.version
          if (!result.valid)
            result.diagnosticMessages.push(
              `Pi ${catalog.pi.version} is required by this integration`
            )
        } catch {
          result.diagnosticMessages.push('The npm Pi entry could not be executed')
        }
      }
      return result
    }
    const result = await validateExecutable(kind, selection.source, real, base)
    result.discoverySource = discoverySource
    if (kind === 'node' && result.valid) await this.addToolchain(result)
    return result
  }
  private async validateRoot(kind: RuntimeKind, root: string): Promise<ResolvedRuntime> {
    const layout = runtimeLayout(kind, process.platform)
    const generation = this.metadataGeneration
    try {
      const canonicalRoot = await fs.realpath(root)
      // Integrity is checked before ANY executable in this directory is launched.
      await verifyDistribution(root, kind, process.platform, process.arch)
      // A complete pinned-tree match binds the executable and npm/npx bytes to
      // the metadata already executed in this app. Always recheck that match;
      // only the redundant process launches are reused. Custom/system runtimes
      // and explicit verification still execute their metadata checks afresh.
      const key = JSON.stringify([kind, canonicalRoot, catalog[kind].version])
      const known = generation === this.metadataGeneration ? this.bundledMetadata.get(key) : null
      if (known) return structuredClone(known)
      const result = await validateExecutable(
        kind,
        'bundled',
        path.join(root, layout.executable),
        this.options.environment
      )
      result.integrity = 'verified'
      if (kind === 'node' && result.valid) await this.addToolchain(result, root)
      if (
        generation === this.metadataGeneration &&
        result.valid &&
        (kind === 'pi' || (result.npm && result.npx))
      )
        this.bundledMetadata.set(key, structuredClone(result))
      return result
    } catch {
      return {
        source: 'bundled',
        executablePath: path.join(root, layout.executable),
        version: null,
        platform: process.platform,
        arch: process.arch,
        valid: false,
        integrity: 'failed',
        diagnosticMessages: [
          'Bundled runtime is missing or its integrity could not be verified; repair the application installation'
        ]
      }
    }
  }

  private async addToolchain(result: ResolvedRuntime, root?: string): Promise<void> {
    const executable = result.executablePath!
    const bin = path.dirname(executable)
    const roots = root ? [root] : [process.platform === 'win32' ? bin : path.dirname(bin), bin]
    const env = buildRuntimeEnvironment(this.options.environment ?? process.env, executable, 'npm')
    for (const tool of ['npm', 'npx'] as const) {
      for (const candidate of roots.flatMap((base) => [
        path.join(base, 'lib/node_modules/npm/bin', `${tool}-cli.js`),
        path.join(base, 'node_modules/npm/bin', `${tool}-cli.js`)
      ])) {
        if (!(await fs.stat(candidate).catch(() => null))) continue
        try {
          const version = await probe(executable, [candidate, '--version'], env)
          if (!/^\d+\.\d+\.\d+$/.test(version)) continue
          result[tool] = { cliPath: candidate, version }
          break
        } catch {
          /* Report the missing capability below, preserving usable Node. */
        }
      }
      if (!result[tool])
        result.diagnosticMessages.push(`${tool} is unavailable for the selected Node runtime`)
    }
  }
  private async assertIdle(): Promise<void> {
    if (this.options.busy?.())
      throw new ValidationError('Finish or stop active sessions before switching runtimes')
    await this.options.stopIdle?.()
    if (this.options.busy?.())
      throw new ValidationError('A session started during the runtime change; retry after it stops')
  }
  private async commit(next: RuntimeState): Promise<void> {
    // Do not update the live cache unless the atomic write succeeds.
    await atomicWriteJson(this.options.stateFile, next)
    this.state = next
    this.invalidate()
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.mutation) throw new ValidationError('Another runtime operation is in progress')
    const promise = action()
    this.mutation = promise
    try {
      return await promise
    } finally {
      this.mutation = null
    }
  }
}
