/**
 * Lazy Pi SDK loader.
 *
 * `runtime.ready` fires before the SDK is loaded; the first session/agent
 * request triggers the dynamic ESM import. Load failures surface as
 * `PI_SDK_LOAD_FAILED` RuntimeError (not a process crash) so the host can
 * surface the problem and keep the UI alive.
 */

import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import * as path from 'node:path'
import type { PiCodingAgentModuleLike, PiSdkLoader } from './types.js'
import { applyAgentDirOverride } from './environment.js'
import { RuntimeError } from './errors.js'

const SDK_SPECIFIER = '@earendil-works/pi-coding-agent'

let cachedModule: PiCodingAgentModuleLike | null = null
let loadPromise: Promise<PiCodingAgentModuleLike> | null = null

export interface SdkLoadMetrics {
  /** Wall-clock ms spent importing + initializing the SDK. */
  loadMs: number
  loadedAt: number
}

let loadMetrics: SdkLoadMetrics | null = null

export function peekPiSdk(): PiCodingAgentModuleLike | null {
  return cachedModule
}

export function getPiSdkLoadMetrics(): SdkLoadMetrics | null {
  return loadMetrics
}

/** Load (and cache) the Pi Coding Agent SDK. */
export function loadPiSdk(): Promise<PiCodingAgentModuleLike> {
  if (cachedModule) return Promise.resolve(cachedModule)
  if (loadPromise) return loadPromise

  const startedAt = performance.now()
  loadPromise = (async () => {
    try {
      applyAgentDirOverride()
      const imported = (await import(SDK_SPECIFIER)) as unknown as PiCodingAgentModuleLike
      if (!imported || typeof imported.createAgentSessionServices !== 'function') {
        throw new RuntimeError('PI_SDK_LOAD_FAILED', 'Pi SDK module is missing expected exports')
      }
      cachedModule = imported
      loadMetrics = {
        loadMs: Math.round(performance.now() - startedAt),
        loadedAt: Date.now()
      }
      try {
        imported.initTheme?.()
      } catch {
        // Theme init is cosmetic; never block SDK loading on it.
      }
      return imported
    } catch (raw) {
      loadPromise = null
      if (raw instanceof RuntimeError) throw raw
      const message = raw instanceof Error ? raw.message : String(raw)
      throw new RuntimeError('PI_SDK_LOAD_FAILED', `Failed to load Pi SDK: ${message}`, {
        recoverable: false,
        cause: raw
      })
    }
  })()

  return loadPromise
}

/** Reset the cache (tests only). */
export function resetPiSdkCacheForTests(): void {
  cachedModule = null
  loadPromise = null
  loadMetrics = null
}

/** Default loader used by production services; injectable for tests. */
export const defaultPiSdkLoader: PiSdkLoader = loadPiSdk

/**
 * Resolve the loader the sidecar should use. `PI_HARNESS_TEST_PI_SDK`
 * (absolute or repo-relative module path) injects a mock SDK module for
 * host-level integration tests; unset in production.
 */
export function resolveConfiguredSdkLoader(env: NodeJS.ProcessEnv = process.env): PiSdkLoader {
  const testModule = env.PI_HARNESS_TEST_PI_SDK
  if (!testModule) return defaultPiSdkLoader
  let moduleUrl: URL
  try {
    moduleUrl = pathToFileURL(path.resolve(testModule))
  } catch {
    return async () => {
      throw new RuntimeError(
        'PI_SDK_LOAD_FAILED',
        `Invalid PI_HARNESS_TEST_PI_SDK path: ${testModule}`,
        { recoverable: false }
      )
    }
  }
  return async () => {
    applyAgentDirOverride()
    const imported = (await import(moduleUrl.href)) as unknown as PiCodingAgentModuleLike
    if (!imported || typeof imported.createAgentSessionServices !== 'function') {
      throw new RuntimeError('PI_SDK_LOAD_FAILED', 'Test SDK module is missing expected exports', {
        recoverable: false
      })
    }
    return imported
  }
}
