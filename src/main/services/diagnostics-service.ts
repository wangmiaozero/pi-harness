/**
 * DiagnosticsService — aggregate environment report for the Diagnostics page.
 */

import { homedir } from 'node:os'
import { app } from 'electron'
import type { AppSettings, DiagnosticsReport } from '@shared/ipc/api-types'
import type { JsonStore } from './storage'
import { piEnvironment } from '../pi/environment'
import type { PiConfigService } from '../pi/config-service'
import { APP_VERSION } from '@shared/constants/index'
import { atomicWriteText } from './storage'
import path from 'node:path'
import { userData } from './app-paths'
import { secretStore } from '../security/secret-store'
import type { SessionService } from '../sessions/session-service'
import type { AgentRuntimeService } from '../agent/agent-runtime-service'
import type { FileAccessService } from '../files/file-access-service'
import { peekPiCodingAgent } from '../agent/pi-sdk'

export class DiagnosticsService {
  private workspace: {
    sessions: SessionService
    agent: AgentRuntimeService
    access: FileAccessService
  } | null = null

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly config: PiConfigService
  ) {}

  attachWorkspace(workspace: {
    sessions: SessionService
    agent: AgentRuntimeService
    access: FileAccessService
  }): void {
    this.workspace = workspace
  }

  async get(): Promise<DiagnosticsReport> {
    const settings = this.settingsStore.peek()
    const pi = await piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
    const config = await this.config.getStatus()
    const secretBackend =
      process.platform === 'darwin'
        ? 'keychain'
        : secretStore.isAvailable()
          ? 'safeStorage'
          : 'unavailable'

    return {
      app: {
        version: APP_VERSION,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      pi: {
        installed: pi.installed,
        version: pi.version,
        cliPath: pi.cliPath,
        configDir: pi.configDir,
        configPath: pi.modelsConfigPath,
        skillsPath: pi.skillsDirs[0] ?? null,
        skillsDirs: pi.skillsDirs,
        configValid: pi.configValid,
        readPermission: pi.configReadable,
        writePermission: pi.configWritable
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        shell: process.env.SHELL ?? null,
        homeDir: homedir(),
        pathSummary: (process.env.PATH ?? '')
          .split(path.delimiter)
          .slice(0, 8)
          .join(path.delimiter),
        secretBackend
      },
      config,
      workspace: {
        sessionRoot: this.workspace?.sessions.sessionsRoot() ?? '',
        sessionCount: this.workspace ? (await this.workspace.sessions.list()).length : 0,
        runningSessions: this.workspace?.agent.listRunning() ?? [],
        piSdkLoaded: peekPiCodingAgent() !== null
      }
    }
  }

  async copyText(): Promise<string> {
    const report = await this.get()
    // Sanitize anything that could look like a secret field name before clipboard.
    const text = JSON.stringify(report, null, 2)
    return text.replace(
      /("(?:api[-_]?key|authorization|token|secret|password|cookie|bearer)"\s*:\s*)"[^"]*"/gi,
      '$1"••••••••••"'
    )
  }

  async export(): Promise<string> {
    const text = await this.copyText()
    const out = path.join(userData(), 'diagnostics', `diagnostics-${Date.now()}.json`)
    await atomicWriteText(out, text)
    return out
  }
}

void app
