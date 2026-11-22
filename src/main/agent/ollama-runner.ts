import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PI_FILES } from '@shared/constants/index'
import { isLocalOllamaEndpoint } from '@shared/providers/local-ollama'

/** Set while the in-app provider gateway is listening. That proxy is not a local model. */
let localGatewayBaseUrl: string | null = null

export function noteLocalGatewayBaseUrl(baseUrl: string | null): void {
  localGatewayBaseUrl = baseUrl
}

const execFileAsync = promisify(execFile)

export interface ProcessRow {
  pid: number
  command: string
}

/** Ollama's model runner. `ollama serve` stays up so the next chat can load a model. */
export function isOllamaRunnerCommand(command: string): boolean {
  const text = command.toLowerCase()
  return text.includes('llama-server') && (text.includes('ollama') || text.includes('.ollama'))
}

export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const match = /^(\d+)\s+(.*)$/.exec(line.trim())
    if (!match) continue
    const pid = Number(match[1])
    if (!Number.isInteger(pid) || pid <= 0) continue
    rows.push({ pid, command: match[2] })
  }
  return rows
}

/** A model server on this machine. The app's own gateway proxy is excluded. */
export function isUserLocalModelEndpoint(
  baseUrl: string,
  gatewayBaseUrl = localGatewayBaseUrl
): boolean {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false
  if (url.username || url.password || url.search || url.hash) return false
  if (gatewayBaseUrl) {
    try {
      if (new URL(gatewayBaseUrl).origin === url.origin) return false
    } catch {
      /* An unreadable gateway address does not turn a local model into a proxy. */
    }
  }
  return true
}

export async function userLocalModelBaseUrl(
  configDir: string,
  provider: string | undefined
): Promise<string | null> {
  if (!provider || !path.isAbsolute(configDir)) return null
  const raw = await fs.readFile(path.join(configDir, PI_FILES.models), 'utf8').catch(() => null)
  if (!raw) return null
  let baseUrl: unknown
  try {
    baseUrl = JSON.parse(raw)?.providers?.[provider]?.baseUrl
  } catch {
    return null
  }
  return typeof baseUrl === 'string' && isUserLocalModelEndpoint(baseUrl) ? baseUrl : null
}

function endpointPort(baseUrl: string): number | null {
  const url = new URL(baseUrl)
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
}

function isProtectedProcess(pid: number, command: string): boolean {
  if (pid === process.pid) return true
  return /Pi-Harness|Cursor\.app|Visual Studio Code/i.test(command)
}

async function listenersOnPort(port: number): Promise<ProcessRow[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$port = ${port}; Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess); '{0} {1}' -f $_.OwningProcess, $proc.CommandLine }`
      ],
      { windowsHide: true, timeout: 5000 }
    )
    return parseProcessTable(stdout)
  }
  const { stdout } = await execFileAsync(
    'lsof',
    ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
    { timeout: 3000 }
  )
  const pids = parseProcessTable(stdout.replace(/^(\d+)\s*$/gm, '$1 (listening)'))
    .map((row) => row.pid)
  if (!pids.length) return []
  const { stdout: commands } = await execFileAsync(
    'ps',
    ['-p', pids.join(','), '-o', 'pid=,command='],
    { timeout: 3000 }
  )
  return parseProcessTable(commands)
}

export async function stopUserLocalModel(
  baseUrl: string | null | undefined,
  io: {
    stopOllama?: () => Promise<number>
    listeners?: (port: number) => Promise<ProcessRow[]>
    kill?: (pid: number, signal: NodeJS.Signals) => void
    alive?: (pid: number) => boolean
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  } = {}
): Promise<void> {
  if (!baseUrl || !isUserLocalModelEndpoint(baseUrl)) return
  if (isLocalOllamaEndpoint(baseUrl)) {
    await (io.stopOllama ?? stopOllamaRunners)().catch(() => undefined)
    return
  }
  const port = endpointPort(baseUrl)
  if (!port) return
  const rows = await (io.listeners ?? listenersOnPort)(port).catch(() => [])
  const kill = io.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal))
  const alive = io.alive ?? processAlive
  const sleep = io.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = io.now ?? Date.now
  const pids = rows
    .filter((row) => !isProtectedProcess(row.pid, row.command))
    .map((row) => row.pid)
  for (const pid of pids) {
    try {
      kill(pid, 'SIGTERM')
    } catch {
      /* Already gone. */
    }
  }
  const deadline = now() + 2000
  while (pids.some((pid) => alive(pid)) && now() < deadline) await sleep(200)
  for (const pid of pids) {
    if (!alive(pid)) continue
    try {
      kill(pid, 'SIGKILL')
    } catch {
      /* Already gone. */
    }
  }
}

export async function isLocalOllamaProvider(
  configDir: string,
  provider: string | undefined
): Promise<boolean> {
  if (!provider || !path.isAbsolute(configDir)) return false
  const raw = await fs.readFile(path.join(configDir, PI_FILES.models), 'utf8').catch(() => null)
  if (!raw) return false
  let baseUrl: unknown
  try {
    baseUrl = JSON.parse(raw)?.providers?.[provider]?.baseUrl
  } catch {
    return false
  }
  return typeof baseUrl === 'string' && isLocalOllamaEndpoint(baseUrl)
}

async function listProcesses(): Promise<ProcessRow[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name = 'llama-server.exe'\" | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }"
      ],
      { windowsHide: true, timeout: 5000 }
    )
    return parseProcessTable(stdout)
  }
  const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,command='], { timeout: 5000 })
  return parseProcessTable(stdout)
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function stopOllamaRunners(
  io: {
    list?: () => Promise<ProcessRow[]>
    kill?: (pid: number, signal: NodeJS.Signals) => void
    alive?: (pid: number) => boolean
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  } = {}
): Promise<number> {
  const list = io.list ?? listProcesses
  const kill = io.kill ?? ((pid, signal) => process.kill(pid, signal))
  const alive = io.alive ?? processAlive
  const sleep = io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = io.now ?? Date.now
  const rows = await list().catch(() => [])
  const pids = rows.filter((row) => isOllamaRunnerCommand(row.command)).map((row) => row.pid)
  for (const pid of pids) {
    try {
      kill(pid, 'SIGTERM')
    } catch {
      /* Already gone. */
    }
  }
  const deadline = now() + 2000
  while (pids.some((pid) => alive(pid)) && now() < deadline) await sleep(200)
  for (const pid of pids) {
    if (!alive(pid)) continue
    try {
      kill(pid, 'SIGKILL')
    } catch {
      /* Already gone. */
    }
  }
  return pids.length
}
