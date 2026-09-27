import type { AgentWorkspace, WorkspaceFolder } from '../types/workspace'

const BEGIN = '--- BEGIN PI-HARNESS WORKSPACE ---'
const END = '--- END PI-HARNESS WORKSPACE ---'
const INTEGRITY_BEGIN = '--- BEGIN PI-HARNESS FILE INTEGRITY ---'
const INTEGRITY_END = '--- END PI-HARNESS FILE INTEGRITY ---'

const FILE_INTEGRITY_PROMPT = [
  INTEGRITY_BEGIN,
  'File-change integrity:',
  '- When the user asks you to create, edit, delete, rename, or save a file, perform the operation with an enabled tool before reporting success.',
  '- Prefer write for new files and edit for existing files so the application can verify and preview the change.',
  '- Never claim that a file was created or changed unless the corresponding tool call completed successfully.',
  '- Use the current working directory or an explicitly attached project path. Never substitute guessed sandbox paths such as /mnt/okcomputer/output.',
  '- If no enabled tool can complete the requested file operation, state clearly that no file was changed.',
  INTEGRITY_END
].join('\n')

export function formatWorkspaceAgentPrompt(workspace: AgentWorkspace): string {
  const main = workspace.folders.find((folder) => folder.role === 'main') ?? workspace.folders[0]
  const others = workspace.folders.filter((folder) => folder !== main)
  const lines = [
    BEGIN,
    'Projects attached to the current session:',
    '',
    'These directories share one conversation context. Treat them as the complete project set for this session.',
    'Use project names when referring to them; do not require the user to paste absolute paths.',
    ''
  ]
  if (main) {
    lines.push('Primary Project:', formatFolderBlock(main, true), '')
  }
  if (others.length) {
    lines.push(
      'Additional Projects:',
      ...others.flatMap((folder) => [formatFolderBlock(folder), ''])
    )
  }
  lines.push(
    'Folder names:',
    ...workspace.folders.map((folder) => `- ${folder.name} → ${folder.resolvedPath}`),
    '',
    'Permissions:',
    '- When the user names a folder, resolve it with the map above. Do not ask for absolute paths.',
    '- Search and read across every attached project unless the user names one project.',
    '- You may coordinate changes across attached projects in the same response.',
    '- Default shell working directory to the Primary Project.',
    '- Do not modify a folder marked read-only.',
    '- Stay inside the projects attached to this session. Do not write outside them.',
    END
  )
  return lines.join('\n')
}

export function applyWorkspacePrompt(existing: string | undefined, prompt: string | null): string {
  const stripped = stripManagedBlock(
    stripWorkspacePrompt(existing ?? ''),
    INTEGRITY_BEGIN,
    INTEGRITY_END
  )
  const parts = [stripped.replace(/\s+$/, ''), prompt, FILE_INTEGRITY_PROMPT].filter(Boolean)
  return parts.join('\n\n')
}

export function stripWorkspacePrompt(existing: string): string {
  return stripManagedBlock(existing, BEGIN, END)
}

function stripManagedBlock(existing: string, begin: string, endMarker: string): string {
  const start = existing.indexOf(begin)
  if (start === -1) return existing
  const end = existing.indexOf(endMarker, start)
  if (end === -1) return existing.slice(0, start).trimEnd()
  return `${existing.slice(0, start).trimEnd()}${existing.slice(end + endMarker.length)}`.trim()
}

function formatFolderBlock(folder: WorkspaceFolder, main = false): string {
  const access = folder.readonly ? 'Read-only' : 'Writable'
  const missing = folder.exists ? '' : ' (missing — do not assume files exist)'
  const role = main ? 'Primary' : 'Attached'
  return [
    `- ${folder.name}${missing}`,
    `  ${folder.resolvedPath}`,
    `  ${role}`,
    `  ${access}`,
    folder.readonly
      ? '  This workspace folder is read-only. Do not modify files in this directory.'
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}
