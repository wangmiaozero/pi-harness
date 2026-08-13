/** Detect Pi-style macOS Keychain apiKey commands. */
export function isKeychainCommand(cmd: string | null | undefined): boolean {
  if (!cmd) return false
  return cmd.startsWith('!') && /find-generic-password/.test(cmd)
}

export function keychainServiceName(cmd: string | null | undefined): string | null {
  if (!cmd) return null
  return cmd.match(/-s\s+"([^"]+)"/)?.[1] ?? null
}
