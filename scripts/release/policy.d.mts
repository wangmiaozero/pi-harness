export const platforms: string[]
export const variants: string[]
export function assetNames(version: string, platform: string, variant: string): string[]
export function metadataName(platform: string, variant: string): string
export function validateVersion(version: string, tag: string): void
export function changelogSection(text: string, version: string): string
export function validateMetadata(
  directory: string,
  name: string,
  version: string,
  expected: string[]
): Promise<unknown>
export function digest(file: string, algorithm?: string, encoding?: string): Promise<string>
