import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

const signInSchema = z.object({
  auth_mode: z.string().optional(),
  tokens: z.object({
    access_token: z.string().min(1),
    id_token: z.string().min(1).optional(),
    account_id: z.string().min(1).optional()
  })
})

export interface CodexSignIn {
  access: string
  idToken?: string
  accountId?: string
}

/** Codex's own ChatGPT sign-in, read as it is. Nothing here is written back. */
export async function readCodexSignIn(home?: string): Promise<CodexSignIn | null> {
  const directory = home ?? defaultCodexHome()
  if (!directory) return null
  let text: string
  try {
    text = await readFile(path.join(directory, 'auth.json'), 'utf8')
  } catch {
    return null
  }
  if (text.length > 1_000_000) return null
  let parsed: z.infer<typeof signInSchema>
  try {
    const body = signInSchema.safeParse(JSON.parse(text))
    if (!body.success || body.data.auth_mode === 'apikey') return null
    parsed = body.data
  } catch {
    return null
  }
  return {
    access: parsed.tokens.access_token,
    idToken: parsed.tokens.id_token,
    accountId: parsed.tokens.account_id
  }
}

function defaultCodexHome(): string {
  if (process.env.VITEST && !process.env.PI_HARNESS_CODEX_HOME) return ''
  const configured = process.env.CODEX_HOME?.trim()
  return configured || path.join(homedir(), '.codex')
}
