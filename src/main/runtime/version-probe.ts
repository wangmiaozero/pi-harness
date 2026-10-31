import { spawn } from 'node:child_process'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { log } from '../services/logger'

type ProbeFailure = NodeJS.ErrnoException & {
  killed?: boolean
  signal?: string | null
  stdoutBytes?: number
  stderrBytes?: number
}

/** Metadata probes never need an interactive stdin or the app's project directory. */
function run(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: path.dirname(executable),
      env: { ...env, NODE_OPTIONS: undefined },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const timer = setTimeout(
      () =>
        fail(
          Object.assign(new Error('Version probe timed out'), { code: 'ETIMEDOUT', killed: true })
        ),
      timeoutMs
    )
    function fail(error: ProbeFailure) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGKILL')
      child.stdout.destroy()
      child.stderr.destroy()
      reject(Object.assign(error, { stdoutBytes, stderrBytes }))
    }
    child.once('error', fail)
    child.stdout.on('error', fail)
    child.stderr.on('error', fail)
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return
      stdoutBytes += chunk.length
      if (stdoutBytes > 1024 * 1024)
        fail(
          Object.assign(new Error('Version probe output exceeded its limit'), {
            code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          })
        )
      else stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (settled) return
      stderrBytes += chunk.length
      if (stderrBytes > 1024 * 1024)
        fail(
          Object.assign(new Error('Version probe output exceeded its limit'), {
            code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          })
        )
    })
    child.once('close', (code, signal) => {
      if (settled) return
      if (code !== 0) {
        fail(
          Object.assign(new Error('Version probe process failed'), {
            code: String(code ?? 'PROCESS_EXIT'),
            signal
          })
        )
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(Buffer.concat(stdout).toString('utf8').trim())
    })
  })
}

export async function probe(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string> {
  const started = performance.now()
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const remaining = 15000 - (performance.now() - started)
        if (remaining <= 0)
          throw Object.assign(new Error('Version probe timed out'), {
            code: 'ETIMEDOUT',
            killed: true
          })
        return await run(executable, args, env, remaining)
      } catch (error) {
        // A descriptor race is transient; retry once with fresh noninteractive pipes.
        if (attempt || (error as ProbeFailure).code !== 'EBADF') throw error
        await setImmediate()
      }
    }
  } catch (error) {
    const failure = error as ProbeFailure
    const reason = failure.killed ? 'timeout' : (failure.code ?? failure.signal ?? 'process exit')
    log.pi.warn('Runtime version probe failed', {
      executable: path.basename(executable),
      elapsedMs: Math.round(performance.now() - started),
      reason,
      syscall: failure.syscall?.split(' ')[0],
      signal: failure.signal,
      stdoutBytes: failure.stdoutBytes ?? 0,
      stderrBytes: failure.stderrBytes ?? 0
    })
    throw new Error(`Runtime version probe failed (${reason})`, { cause: error })
  }
}
