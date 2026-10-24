// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AgentPreferencesService } from './preferences-service'
import { PiConfigService } from '../pi/config-service'
import { FileAccessService } from '../files/file-access-service'
import { JsonStore } from '../services/storage'
import type { AppSettings } from '@shared/ipc/api-types'
import type { BackupService } from '../backup/backup-service'

let temp: string,
  config: PiConfigService,
  service: AgentPreferencesService,
  access: FileAccessService
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-preferences-'))
  const settings = new JsonStore<AppSettings>(path.join(temp, 'app.json'), {
    manualConfigDir: path.join(temp, 'pi')
  } as AppSettings)
  config = new PiConfigService(settings, {
    createBackupForFile: vi.fn()
  } as unknown as BackupService)
  access = new FileAccessService()
  service = new AgentPreferencesService(config, access)
})
afterEach(async () => {
  await fs.rm(temp, { force: true, recursive: true })
})

describe('native agent settings', () => {
  it('patches supported AI preferences while keeping native and unknown fields', async () => {
    await fs.mkdir(path.dirname(config.settingsPath()), { recursive: true })
    await fs.writeFile(
      config.settingsPath(),
      JSON.stringify({
        defaultProvider: 'fixture',
        compaction: { enabled: true, futureField: 7 },
        retry: { maxDelayMs: 7000 },
        future: { keep: true }
      })
    )
    const current = await service.ai()
    await service.saveAi({
      ...current,
      defaultThinkingLevel: 'high',
      compactionEnabled: false,
      maxRetries: 5
    })
    const result = JSON.parse(await fs.readFile(config.settingsPath(), 'utf8'))
    expect(result).toMatchObject({
      defaultProvider: 'fixture',
      defaultThinkingLevel: 'high',
      compaction: { enabled: false, futureField: 7 },
      retry: { maxRetries: 5, maxDelayMs: 7000 },
      future: { keep: true }
    })
  })
  it('detects concurrent instruction edits and retains the original recovery copy', async () => {
    const original = await service.instructions({})
    const saved = await service.saveInstructions({
      content: 'Original instructions',
      revision: original.revision
    })
    await service.saveInstructions({ content: 'Changed instructions', revision: saved.revision })
    await expect(
      service.saveInstructions({ content: 'Stale write', revision: saved.revision })
    ).rejects.toThrow('changed')
    expect(await fs.readFile(saved.path, 'utf8')).toBe('Changed instructions')
    expect(await fs.readFile(`${saved.path}.harness-backup`, 'utf8')).toBe('Original instructions')
  })
  it('authorizes project roots and rejects instruction and MCP symlinks', async () => {
    const project = path.join(temp, 'project'),
      outside = path.join(temp, 'outside')
    await fs.mkdir(project)
    await fs.mkdir(outside)
    await expect(service.instructions({ root: project })).rejects.toThrow('outside')
    access.allowRoot(project)
    const doc = await service.instructions({ root: project })
    expect(doc.path).toBe(path.join(await fs.realpath(project), 'AGENTS.md'))
    await fs.writeFile(path.join(outside, 'secret'), 'outside')
    await fs.symlink(path.join(outside, 'secret'), doc.path)
    await expect(service.instructions({ root: project })).rejects.toThrow('Linked')
    await fs.symlink(outside, path.join(project, '.pi'))
    await expect(service.mcp({ root: project })).rejects.toThrow('Linked')
    expect(await fs.readFile(path.join(outside, 'secret'), 'utf8')).toBe('outside')
  })
  it('preserves MCP credentials and advanced settings without exposing them in the inventory', async () => {
    const empty = await service.mcp({})
    const value = {
      future: 4,
      mcpServers: {
        docs: {
          type: 'http',
          url: 'https://example.test/mcp?token=fixture-url-token',
          enabled: false,
          headers: { Authorization: 'Bearer private-fixture', 'X-Env': '${ENV_HEADER}' },
          oauth: { clientSecret: 'private-client' },
          toolExposure: { search: 'direct' },
          futureServer: true
        }
      }
    }
    await fs.writeFile(empty.path, JSON.stringify(value))
    const listed = await service.mcp({})
    expect(JSON.stringify(listed)).not.toContain('private-fixture')
    expect(JSON.stringify(listed)).not.toContain('private-client')
    expect(JSON.stringify(listed)).not.toContain('fixture-url-token')
    expect(listed.entries[0].capability).toMatchObject({
      type: 'mcp',
      status: 'disabled',
      ownership: { scope: 'global' }
    })
    const saved = await service.saveMcp({
      id: 'docs',
      revision: listed.revision,
      type: 'http',
      url: 'https://example.test/mcp',
      headers: { 'X-New': '${NEW_HEADER}' },
      enabled: true,
      exposure: 'direct'
    })
    const disk = JSON.parse(await fs.readFile(empty.path, 'utf8'))
    expect(disk).toMatchObject({
      future: 4,
      mcpServers: {
        docs: {
          enabled: true,
          url: 'https://example.test/mcp?token=fixture-url-token',
          headers: { Authorization: 'Bearer private-fixture', 'X-New': '${NEW_HEADER}' },
          oauth: { clientSecret: 'private-client' },
          futureServer: true
        }
      }
    })
    expect(disk.mcpServers.docs.headers['X-Env']).toBeUndefined()
    await expect(
      service.changeMcp({ id: 'docs', revision: listed.revision }, () => undefined)
    ).rejects.toThrow('changed')
    const removed = await service.changeMcp(
      { id: 'docs', revision: saved.revision },
      () => undefined
    )
    expect(removed.entries).toEqual([])
    expect(JSON.parse(await fs.readFile(empty.path, 'utf8')).future).toBe(4)
  })
  it('serializes concurrent MCP mutations and refuses the stale writer', async () => {
    const empty = await service.mcp({})
    const results = await Promise.allSettled(
      ['one', 'two'].map((id) =>
        service.saveMcp({
          id,
          revision: empty.revision,
          type: 'stdio',
          command: 'node',
          args: ['fixture.mjs'],
          enabled: false,
          exposure: 'codemode'
        })
      )
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const entries = (await service.mcp({})).entries
    expect(entries).toHaveLength(1)
    expect(['one', 'two']).toContain(entries[0].id)
  })
  it('refuses invalid native MCP data without overwriting it', async () => {
    const empty = await service.mcp({})
    await fs.writeFile(empty.path, '{broken')
    await expect(service.mcp({})).rejects.toThrow('invalid')
    expect(await fs.readFile(empty.path, 'utf8')).toBe('{broken')
  })
})
