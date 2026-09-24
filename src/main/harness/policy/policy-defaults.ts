/**
 * Harness Policy defaults and command classification.
 *
 * The policy layer is declarative configuration plus pure matching helpers.
 * It never shells out and never mutates Pi config; enforcement happens at the
 * Harness tool boundary (see policy-tool-guard.ts).
 */

import type { HarnessPolicyConfig } from '@shared/types/harness'

/**
 * Commands that always trigger interactive confirmation when
 * `shell.dangerousConfirmation` is enabled.
 */
export const DANGEROUS_COMMAND_PATTERNS: readonly string[] = [
  'rm -rf',
  'sudo',
  'chmod',
  'chown',
  'curl | sh',
  'wget | sh',
  'git reset --hard',
  'git clean',
  'git push --force',
  'git branch -D'
]

/** First tokens that mark a command as network-reaching. */
const NETWORK_COMMAND_TOKENS = new Set([
  'curl',
  'wget',
  'nc',
  'ncat',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'ftp',
  'telnet',
  'ping'
])

const GIT_FORCE_PUSH_PATTERN = /(^|\s)(--force(-with-lease)?\b|-f\b)(\s|$)/

export const DEFAULT_POLICY_CONFIG: HarnessPolicyConfig = {
  schemaVersion: 1,
  tools: {
    default: 'allow',
    overrides: {}
  },
  files: {
    write: 'allow',
    delete: 'ask',
    rename: 'allow',
    outsideWorkspace: 'deny'
  },
  shell: {
    default: 'allow',
    allowCommands: [],
    denyCommands: [],
    dangerousConfirmation: true
  },
  git: {
    commit: 'allow',
    push: 'ask',
    forcePush: 'deny',
    reset: 'ask',
    checkout: 'allow',
    branchDelete: 'ask'
  },
  network: 'ask',
  budget: {
    maxTokens: null,
    maxCost: null,
    maxToolCalls: null,
    maxRunDurationMs: null
  },
  evaluation: {
    autoEvaluate: true,
    preset: 'standard',
    customStages: ['lint', 'test']
  },
  checkpoints: {
    autoPreRun: false
  }
}

/** Normalize whitespace so `rm  -rf` still matches `rm -rf`. */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

/**
 * Token-prefix pattern matching.
 *
 * - `sudo` matches any command whose first token is `sudo`
 * - `rm -rf` matches commands starting with the tokens `rm -rf`
 * - patterns containing `|` (e.g. `curl | sh`) match by substring on the
 *   normalized command
 */
export function commandMatchesPattern(command: string, pattern: string): boolean {
  const normalized = normalizeCommand(command)
  const normalizedPattern = normalizeCommand(pattern)
  if (!normalized || !normalizedPattern) return false
  if (normalizedPattern.includes('|')) {
    const compact = normalized.replaceAll(' ', '')
    const compactPattern = normalizedPattern.replaceAll(' ', '')
    return compact.includes(compactPattern)
  }
  const commandTokens = normalized.split(' ')
  const patternTokens = normalizedPattern.split(' ')
  if (patternTokens.length > commandTokens.length) return false
  return patternTokens.every((token, index) => commandTokens[index] === token)
}

export function isNetworkCommand(command: string): boolean {
  const firstToken = normalizeCommand(command).split(' ')[0] ?? ''
  return NETWORK_COMMAND_TOKENS.has(firstToken)
}

export type GitCommandAction =
  'commit' | 'push' | 'forcePush' | 'reset' | 'checkout' | 'branchDelete'

/** Classify a `git …` command into a Git Policy action, or null when unrelated. */
export function classifyGitCommand(command: string): GitCommandAction | null {
  const tokens = normalizeCommand(command).split(' ')
  if (tokens[0] !== 'git') return null
  const subcommand = tokens[1] ?? ''
  switch (subcommand) {
    case 'commit':
      return 'commit'
    case 'push':
      return GIT_FORCE_PUSH_PATTERN.test(normalizeCommand(command)) ? 'forcePush' : 'push'
    case 'reset':
      return 'reset'
    case 'checkout':
    case 'switch':
      return 'checkout'
    case 'branch':
      return tokens.some((token) => token === '-D' || token === '--delete' || token === '-d')
        ? 'branchDelete'
        : null
    default:
      return null
  }
}

/** File-mutating commands the File Policy evaluates (delete / rename via shell). */
export type FileCommandAction = 'delete' | 'rename'

export function classifyFileCommand(command: string): FileCommandAction | null {
  const firstToken = normalizeCommand(command).split(' ')[0] ?? ''
  if (firstToken === 'rm') return 'delete'
  if (firstToken === 'mv') return 'rename'
  return null
}
