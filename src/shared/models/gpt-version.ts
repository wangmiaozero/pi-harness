/** Extract GPT major.minor from a model id such as `openai/gpt-5.6-codex`. */
const GPT_VERSION = /(?:^|[^a-z0-9])gpt[-_]?(\d+)(?:\.(\d+))?/gi

export function parseGptVersion(modelId: string): { major: number; minor: number } | null {
  let best: { major: number; minor: number } | null = null
  for (const match of modelId.matchAll(GPT_VERSION)) {
    const major = Number(match[1])
    const minor = match[2] != null ? Number(match[2]) : 0
    if (!Number.isFinite(major) || !Number.isFinite(minor)) continue
    if (!best || major > best.major || (major === best.major && minor > best.minor)) {
      best = { major, minor }
    }
  }
  return best
}

export function isGptAtLeast(modelId: string, major: number, minor = 0): boolean {
  const version = parseGptVersion(modelId)
  if (!version) return false
  return version.major > major || (version.major === major && version.minor >= minor)
}
