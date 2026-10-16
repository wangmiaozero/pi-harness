// @vitest-environment node
import path from 'node:path'
import { expect, it } from 'vitest'
import { probe } from './validator'

it('runs runtime metadata outside the application working directory', async () => {
  await expect(probe(process.execPath, ['-p', 'process.cwd()'], process.env)).resolves.toBe(
    path.dirname(process.execPath)
  )
})
