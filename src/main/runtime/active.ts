import type {
  RuntimeConfiguration,
  RuntimeDiagnostics,
  RuntimeUpdateReport,
  RuntimeKind,
  RuntimeSelection,
  ResolvedRuntime
} from '@shared/runtime/schema'

export interface RuntimeProvider {
  invalidate(): void
  configuration(): Promise<RuntimeConfiguration>
  resolve(kind: RuntimeKind, selection?: RuntimeSelection): Promise<ResolvedRuntime>
  environment(
    purpose: 'pi' | 'mcp' | 'extension' | 'npm' | 'terminal',
    base?: NodeJS.ProcessEnv
  ): Promise<NodeJS.ProcessEnv>
  diagnostics(): Promise<RuntimeDiagnostics>
  update(
    kind: RuntimeKind,
    signal?: AbortSignal,
    onProgress?: (phase: string, progress: number) => void
  ): Promise<RuntimeDiagnostics>
  rollback(kind: RuntimeKind): Promise<RuntimeDiagnostics>
  checkUpdates(): Promise<RuntimeUpdateReport>
}
let provider: RuntimeProvider | null = null
export function setRuntimeProvider(value: RuntimeProvider | null): void {
  provider = value
}
export function getRuntimeProvider(): RuntimeProvider | null {
  return provider
}
