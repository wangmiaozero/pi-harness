export type PetToolCategory =
  | 'coding'
  | 'shell'
  | 'git'
  | 'mcp'
  | 'browser'
  | 'search'
  | 'filesystem'
  | 'skills'
  | 'package'
  | 'extension'
  | 'tool'

const CODING_PATTERNS = [
  /(^|[_-])apply[_-]?patch($|[_-])/,
  /(^|[_-])(write|edit|create|replace|patch)[_-]?(file|text|code)?($|[_-])/,
  /(^|[_-])(insert|delete)[_-](text|code|lines?)($|[_-])/,
  /(^|[_-])refactor($|[_-])/
]

const READ_ONLY_PATTERNS = [
  /(^|[_-])(read|search|find|list|scan|inspect|view|stat|glob|grep)($|[_-])/,
  /(^|[_-])(read|search|find|list)[_-](file|files|directory|directories)($|[_-])/
]

function normalizeToolName(tool: string): string {
  return tool
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
}

export function isCodingTool(tool: string): boolean {
  const normalized = normalizeToolName(tool)
  if (!normalized || READ_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) return false
  return CODING_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function categorizePetTool(tool: string): PetToolCategory {
  const normalized = normalizeToolName(tool)
  if (isCodingTool(normalized)) return 'coding'
  if (/bash|shell|terminal|exec|command/.test(normalized)) return 'shell'
  if (/git|worktree|commit|diff/.test(normalized)) return 'git'
  if (/mcp/.test(normalized)) return 'mcp'
  if (/browser|playwright|chrome|web/.test(normalized)) return 'browser'
  if (/search|grep|find|glob|query/.test(normalized)) return 'search'
  if (/file|filesystem|directory|read|list|stat/.test(normalized)) return 'filesystem'
  if (/skill/.test(normalized)) return 'skills'
  if (/npm|pnpm|yarn|package/.test(normalized)) return 'package'
  if (/extension|plugin/.test(normalized)) return 'extension'
  return 'tool'
}
