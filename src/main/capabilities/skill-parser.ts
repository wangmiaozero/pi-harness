import path from 'node:path'
import { readTextFile, fileMtime } from '../services/storage'

export interface ParsedSkillMetadata {
  name: string
  description: string
  version: string | null
  tags: string[]
}

export interface ParsedSkill extends ParsedSkillMetadata {
  path: string
  skillFile: string
  lastModified: number | null
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed) as string
      } catch {
        /* fall through to minimal YAML quote removal */
      }
    }
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return []
  return trimmed
    .slice(1, -1)
    .split(',')
    .map((entry) => unquote(entry).trim())
    .filter(Boolean)
}

function firstBodyDescription(body: string): string {
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('```')) continue
    return line.slice(0, 500)
  }
  return ''
}

export function parseSkillMarkdown(markdown: string, fallbackName = ''): ParsedSkillMetadata {
  const lines = markdown.split(/\r?\n/)
  const fields = new Map<string, string>()
  const listFields = new Map<string, string[]>()
  let bodyStart = 0

  if (lines[0]?.trim() === '---') {
    let currentList: string | null = null
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index]
      if (line.trim() === '---') {
        bodyStart = index + 1
        break
      }
      const listItem = line.match(/^\s*-\s+(.+)$/)
      if (currentList && listItem) {
        const values = listFields.get(currentList) ?? []
        values.push(unquote(listItem[1]))
        listFields.set(currentList, values)
        continue
      }
      const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
      if (!field) continue
      const key = field[1].toLowerCase()
      const value = field[2].trim()
      currentList = value ? null : key
      if (value) fields.set(key, unquote(value))
      const inline = parseInlineList(value)
      if (inline.length) listFields.set(key, inline)
    }
  }

  const body = lines.slice(bodyStart).join('\n')
  const heading = body.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() ?? ''
  const name = fields.get('name')?.trim() || fallbackName.trim() || heading
  const description = fields.get('description')?.trim() || firstBodyDescription(body)
  const tags = listFields.get('tags') ?? []

  return {
    name,
    description: description.slice(0, 500),
    version: fields.get('version')?.trim() || null,
    tags: [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort()
  }
}

export async function parseSkillDirectory(skillPath: string): Promise<ParsedSkill | null> {
  const resolved = path.resolve(skillPath)
  const skillFile = path.join(resolved, 'SKILL.md')
  const markdown = await readTextFile(skillFile)
  if (markdown === null) return null
  return {
    ...parseSkillMarkdown(markdown, path.basename(resolved)),
    path: resolved,
    skillFile,
    lastModified: await fileMtime(skillFile)
  }
}
