import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCodexSignIn } from './codex-sign-in'

describe('Codex sign-in', () => {
  it('reads the account id and leaves the refresh token unread', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'codex-sign-in-'))
    await writeFile(
      path.join(home, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'access-token',
          id_token: 'id-token',
          account_id: 'acct_1',
          refresh_token: 'refresh-token'
        }
      })
    )

    const signIn = await readCodexSignIn(home)

    expect(signIn).toEqual({ access: 'access-token', idToken: 'id-token', accountId: 'acct_1' })
    expect(JSON.stringify(signIn)).not.toContain('refresh-token')
  })

  it('ignores an API key sign-in and a missing file', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'codex-sign-in-'))
    await writeFile(
      path.join(home, 'auth.json'),
      JSON.stringify({ auth_mode: 'apikey', tokens: { access_token: 'sk-test' } })
    )

    await expect(readCodexSignIn(home)).resolves.toBeNull()
    await expect(readCodexSignIn(path.join(home, 'missing'))).resolves.toBeNull()
  })
})
