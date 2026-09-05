#!/usr/bin/env node
/**
 * 将 resources/macos/QuarantineRepair.app 模板复制为 build/修复.app，
 * 供 electron-builder 的 DMG 布局引用（见 electron-builder.yml 的 dmg.contents）。
 *
 * 「修复」用于移除未签名 DMG 安装后的 quarantine 隔离属性
 * （「应用已损坏，无法打开」）。在所有 mac 构建脚本中于
 * electron-builder 之前运行；在非 mac 平台上运行是安全的空操作。
 */
import { cpSync, chmodSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const template = path.join(root, 'resources', 'macos', 'QuarantineRepair.app')
const output = path.join(root, 'build', '修复.app')

if (process.platform !== 'darwin') {
  console.log('[prepare-mac-repair] 非 macOS 平台，跳过修复 App 准备')
  process.exit(0)
}

if (!existsSync(template)) {
  console.error(`[prepare-mac-repair] 缺少模板: ${template}`)
  process.exit(1)
}

rmSync(output, { recursive: true, force: true })
cpSync(template, output, { recursive: true })
chmodSync(path.join(output, 'Contents', 'MacOS', 'repair'), 0o755)
console.log(`[prepare-mac-repair] 已生成 ${path.relative(root, output)}`)
