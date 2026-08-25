import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { authorizeTrustedPath } from './open-path-policy'

describe('authorizeTrustedPath', () => {
  it('allows exact paths and descendants of trusted roots', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'pi-harness-open-path-'))
    const root = path.join(base, 'root')
    const child = path.join(root, 'child.txt')
    const exact = path.join(base, 'exact.txt')
    await mkdir(root)
    await writeFile(child, 'child')
    await writeFile(exact, 'exact')

    await expect(authorizeTrustedPath(child, { exact: [], roots: [root] })).resolves.toBe(
      await realpath(child)
    )
    await expect(authorizeTrustedPath(exact, { exact: [exact], roots: [] })).resolves.toBe(
      await realpath(exact)
    )
  })

  it('rejects paths outside trusted roots and symlink escapes', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'pi-harness-open-path-'))
    const root = path.join(base, 'root')
    const outside = path.join(base, 'outside.txt')
    const link = path.join(root, 'escape.txt')
    await mkdir(root)
    await writeFile(outside, 'outside')
    await symlink(outside, link)

    await expect(authorizeTrustedPath(outside, { exact: [], roots: [root] })).rejects.toMatchObject(
      {
        code: 'PATH_DENIED'
      }
    )
    await expect(authorizeTrustedPath(link, { exact: [], roots: [root] })).rejects.toMatchObject({
      code: 'PATH_DENIED'
    })
  })
})
