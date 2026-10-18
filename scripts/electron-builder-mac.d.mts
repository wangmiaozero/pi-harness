export function buildMac(options?: {
  projectDir?: string
  arches?: string[]
  nomascot?: boolean
}): Promise<string[]>
