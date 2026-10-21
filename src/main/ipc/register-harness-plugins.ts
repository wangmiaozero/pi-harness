import { dialog } from 'electron'
import { exportAuthorizedJson } from '../harness/export/run-export-service'
import { z } from 'zod'
import { IPC_INVOKE } from '@shared/ipc/channels'
import {
  pluginTargetSchema,
  pluginToggleSchema,
  pluginRunSchema,
  pluginTemplateInputSchema
} from '@shared/harness-plugins/schema'
import type { HarnessPluginHost, PluginApproval } from '../harness/plugins/plugin-host'
import type { PluginRecord } from '@shared/harness-plugins/types'
import type { IpcHandleRegistrar } from './trusted-ipc'
import type { FileAccessService } from '../files/file-access-service'
import { ValidationError } from '../services/errors'

type Wrap = <T>(
  fn: () => Promise<T>
) => Promise<{ ok: true; data: T } | { ok: false; error: unknown }>
const none = z.undefined()
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ValidationError('Invalid Harness plugin request')
  return result.data
}

/** Native confirmation is owned by Main; a renderer boolean cannot grant code trust. */
export async function approveHarnessPlugin(
  record: PluginRecord,
  chinese = false
): Promise<PluginApproval | null> {
  const code = Boolean(record.manifest.entry)
  const detail = chinese
    ? `插件：${record.manifest.id}\n版本：${record.manifest.version}\n请求的宿主权限：${record.manifest.permissions.join(', ') || '无'}\n\n${code ? '此插件包含可执行代码。独立进程不是安全沙箱：代码可使用 Node.js 访问本机文件、网络和进程，也可能读取本机密钥。仅在已审查并信任插件作者及其代码时允许。' : '此插件仅贡献声明式团队模板，不执行插件代码。应用模板只创建待启动的编排。'}\n\nSHA256: ${record.digest}`
    : `Plugin: ${record.manifest.id}\nVersion: ${record.manifest.version}\nRequested host permissions: ${record.manifest.permissions.join(', ') || 'none'}\n\n${code ? 'This plugin contains executable code. Its separate process is NOT a security sandbox: code can use Node.js to access local files, networks and processes, and may read local secrets. Allow only after reviewing and trusting the author and code.' : 'This plugin only contributes declarative team templates. Applying a template creates a pending orchestration.'}\n\nSHA256: ${record.digest}`
  const result = await dialog.showMessageBox({
    type: 'warning',
    title: chinese ? '允许 Harness 插件？' : 'Allow Harness plugin?',
    message: record.manifest.name,
    detail,
    buttons: chinese
      ? ['取消', code ? '信任代码并允许' : '允许模板']
      : ['Cancel', code ? 'Trust code and allow' : 'Allow template'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return result.response === 1
    ? { digest: record.digest, permissions: record.manifest.permissions, trustedCode: code }
    : null
}
export function registerHarnessPluginsIpc(
  ipc: IpcHandleRegistrar,
  wrap: Wrap,
  host: HarnessPluginHost,
  access: FileAccessService
): void {
  ipc.handle(IPC_INVOKE.harnessPluginsList, (_e, input: unknown) =>
    wrap(async () => {
      parse(none, input)
      return host.list()
    })
  )
  ipc.handle(IPC_INVOKE.harnessPluginsInstall, (_e, input: unknown) =>
    wrap(async () => {
      parse(none, input)
      const chosen = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (chosen.canceled || !chosen.filePaths[0]) return null
      return host.install(chosen.filePaths[0])
    })
  )
  ipc.handle(IPC_INVOKE.harnessPluginsToggle, (_e, input: unknown) =>
    wrap(async () => {
      const p = parse(pluginToggleSchema, input)
      await host.setEnabled(p.id, p.enabled)
    })
  )
  ipc.handle(IPC_INVOKE.harnessPluginsUninstall, (_e, input: unknown) =>
    wrap(async () => {
      await host.uninstall(parse(pluginTargetSchema, input).id)
    })
  )
  ipc.handle(IPC_INVOKE.harnessPluginsEvaluate, (_e, input: unknown) =>
    wrap(async () => {
      const p = parse(pluginRunSchema, input)
      return host.evaluate(p.id, p.contributionId, p.sessionId, p.runId)
    })
  )
  ipc.handle(IPC_INVOKE.harnessPluginsExport, (_e, input: unknown) =>
    wrap(async () => {
      const p = parse(pluginRunSchema, input)
      // Choosing a destination explicitly authorizes this export. Cancel sends no trace to the plugin.
      const result = await exportAuthorizedJson(() =>
        host.exportTrace(p.id, p.contributionId, p.sessionId, p.runId)
      )
      return !result.cancelled
    })
  )
  ipc.handle(IPC_INVOKE.harnessPluginsApplyTeam, (_e, input: unknown) =>
    wrap(async () => {
      const p = parse(pluginTemplateInputSchema, input)
      const chosen = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (chosen.canceled || !chosen.filePaths[0]) return null
      return host.applyTeam(p.id, p.contributionId, await access.authorizeRoot(chosen.filePaths[0]))
    })
  )
}
