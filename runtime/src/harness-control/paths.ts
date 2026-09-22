/**
 * Runtime-side harness store paths.
 *
 * Mirrors the Electron `app-paths.ts` harness layout so both hosts read and
 * write the exact same files under the same userData directory. The desktop
 * host (Electron or Tauri) injects `PI_HARNESS_USER_DATA` at spawn time; the
 * runtime never guesses its own location.
 */

import path from 'node:path'
import { homedir, tmpdir } from 'node:os'

/** userData root injected by the desktop host. Falls back to ~/.pi-harness/runtime-data in tests. */
export function runtimeUserDataDir(): string {
  const injected = process.env.PI_HARNESS_USER_DATA?.trim()
  if (injected) return path.resolve(injected)
  const fallback = process.env.PI_HARNESS_RUNTIME_DATA_DIR?.trim()
  if (fallback) return path.resolve(fallback)
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    // Per-process fallback so leftover files from a previous run cannot leak
    // into the next vitest invocation. Tests that persist policy / runs must
    // still set PI_HARNESS_USER_DATA to an isolated mkdtemp.
    return path.join(tmpdir(), `pi-harness-runtime-test-${process.pid}`)
  }
  return path.join(homedir(), '.pi-harness', 'runtime-data')
}

/** Harness Control Plane policy configuration. */
export function harnessPolicyPath(): string {
  return path.join(runtimeUserDataDir(), 'harness-policy.json')
}

/** Harness Control Plane checkpoints (recovery anchors). */
export function harnessCheckpointsPath(): string {
  return path.join(runtimeUserDataDir(), 'harness-checkpoints.json')
}

/** Persisted Harness runs (Run Intelligence store). */
export function harnessRunsPath(): string {
  return path.join(runtimeUserDataDir(), 'harness-runs.json')
}

/** Persisted Harness traces (spans + replay events per run). */
export function harnessTracesPath(): string {
  return path.join(runtimeUserDataDir(), 'harness-traces.json')
}

/** Persisted Harness artifacts (metadata only). */
export function harnessArtifactsPath(): string {
  return path.join(runtimeUserDataDir(), 'harness-artifacts.json')
}

/** Persisted Harness evaluations (checks + pipeline). */
export function harnessEvaluationsPath(): string {
  return path.join(runtimeUserDataDir(), 'harness-evaluations.json')
}

/** Harness baselines (project → run) and store settings. */
export function harnessBaselinesPath(): string {
  return path.join(runtimeUserDataDir(), 'harness-baselines.json')
}

export function harnessStoreSettingsPath(): string {
  return path.join(runtimeUserDataDir(), 'harness-store-settings.json')
}

/** Multi-Agent Orchestration state (agents, tasks, teams, templates, runs). */
export function harnessOrchestrationPath(): string {
  return path.join(runtimeUserDataDir(), 'harness-orchestration.json')
}
