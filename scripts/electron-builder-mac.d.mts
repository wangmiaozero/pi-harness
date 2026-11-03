export function buildMacWithCleanup(
  options: import('electron-builder').CliOptions,
  directory: string
): Promise<string[]>

export function buildMac(options?: {
  projectDir?: string
  arches?: string[]
  nomascot?: boolean
}): Promise<string[]>
