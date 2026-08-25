export type ApiKeyUiKind = 'none' | 'literal' | 'env' | 'command' | 'keychain' | 'stored'

const COMMON_API_KEY_KINDS: ApiKeyUiKind[] = ['none', 'literal', 'env', 'command', 'stored']

/** macOS Keychain commands are only usable on macOS. */
export function apiKeyKindsForPlatform(platform: string): ApiKeyUiKind[] {
  if (platform !== 'darwin') return [...COMMON_API_KEY_KINDS]
  return ['none', 'literal', 'env', 'command', 'keychain', 'stored']
}

export function rendererPlatformHint(platform: string | undefined): string {
  if (platform?.startsWith('Mac')) return 'darwin'
  if (platform?.startsWith('Win')) return 'win32'
  if (platform?.startsWith('Linux')) return 'linux'
  return ''
}
