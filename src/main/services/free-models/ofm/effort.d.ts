export function effortPatchFor(
  level: string | undefined,
  model: {
    efforts?: string[]
    effortPatch?: Record<string, unknown>
    effortOffPatch?: Record<string, unknown>
  }
): Record<string, unknown> | null
