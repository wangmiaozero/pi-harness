export function prepareDistribution(
  options: {
    destination: string
    kind: 'node' | 'pi'
    platform: string
    arch: string
    cache: string
    verifyOnly?: boolean
    refresh?: boolean
    offline?: boolean
  },
  dependencies?: {
    acquire?: (options: { destination: string }) => Promise<unknown>
    verify?: (root: string, kind: string, platform: string, arch: string) => Promise<unknown>
    rename?: (from: string, to: string) => Promise<void>
  }
): Promise<unknown>
