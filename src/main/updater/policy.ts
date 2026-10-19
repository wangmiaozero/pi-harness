import fs from 'node:fs'
import path from 'node:path'
import type { ReleasePolicy } from '@shared/release-policy'

export function communityManualUpdates(): boolean {
  if (!process.resourcesPath) return true
  const file = path.join(process.resourcesPath, 'release-policy.json')
  if (!fs.existsSync(file)) return true // Missing policy must never enable unsigned automatic updates.
  try {
    const policy = JSON.parse(fs.readFileSync(file, 'utf8')) as ReleasePolicy
    return policy.channel !== 'verified' || policy.updateMode !== 'automatic'
  } catch {
    return true
  }
}

export function readUpdateMode(): 'manual' | 'download' | 'automatic' {
  if (!process.resourcesPath) return 'manual'
  try {
    const policy = JSON.parse(
      fs.readFileSync(path.join(process.resourcesPath, 'release-policy.json'), 'utf8')
    )
    if (policy.channel !== 'community' && policy.channel !== 'verified') return 'manual'
    return ['download', 'automatic'].includes(policy.updateMode) ? policy.updateMode : 'manual'
  } catch {
    return 'manual'
  }
}
