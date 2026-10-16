// @vitest-environment node
import { expect, it } from 'vitest'
import { probe } from './validator'

it('closes standard input for noninteractive runtime probes', async () => {
  const program = "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('1.2.0'))"
  await expect(probe(process.execPath, ['-e', program], process.env)).resolves.toBe('1.2.0')
}, 20_000)
