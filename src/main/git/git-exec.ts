import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GitError } from '../services/errors'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 10_000
const GIT_MAX_BUFFER = 8 * 1024 * 1024

export async function gitExec(
  cwd: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number } = {}
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      timeout: options.timeout ?? GIT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? GIT_MAX_BUFFER,
      env: { ...process.env, LC_ALL: 'C' }
    })
    return stdout
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr
    const message =
      typeof stderr === 'string' && stderr.trim()
        ? stderr.trim()
        : error instanceof Error
          ? error.message
          : String(error)
    throw new GitError(message)
  }
}
