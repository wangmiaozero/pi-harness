import fs from 'node:fs'
import path from 'node:path'
import type { ReleasePolicy } from '@shared/release-policy'

export function communityManualUpdates(): boolean {
  if (!process.resourcesPath) return false
  const file = path.join(process.resourcesPath, 'release-policy.json')
  if (!fs.existsSync(file)) return false // Legacy packages keep their existing policy.
  try {
    const policy = JSON.parse(fs.readFileSync(file, 'utf8')) as ReleasePolicy
    return policy.channel !== 'verified' || policy.updateMode !== 'automatic'
  } catch {
    return true
  }
}
