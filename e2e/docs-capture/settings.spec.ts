import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from '../fixtures'
import type { ElectronApplication, Page } from '@playwright/test'
import { IPC_INVOKE } from '../../src/shared/ipc/channels'
import {
  AURORA,
  VIEWPORT,
  ensureAuroraWorkspace,
  openSession,
  seedConversation,
  shot,
  writeProfileSettings
} from './helpers'

const sessionId = 'docs-demo-settings'
const output = (name: string) => `功能界面/经典主题/${name}.png`

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

function seedAgentConfiguration(agentDir: string, testUserData: string) {
  fs.writeFileSync(
    path.join(agentDir, 'AGENTS.md'),
    [
      '# Aurora Studio',
      '',
      'A small, calm web workspace built with TypeScript and Vite.',
      '',
      '## Working agreements',
      '',
      '- Keep the interface quiet, readable, and keyboard friendly.',
      '- Use the existing design tokens in `src/theme/tokens.css`.',
      '- Preserve the current project structure and public component APIs.',
      '- Run the relevant unit tests and a production build before finishing.',
      '',
      '## Review checklist',
      '',
      '1. Confirm keyboard and screen-reader behavior.',
      '2. Check both light and dark themes.',
      '3. Document any user-facing changes in the README.',
      ''
    ].join('\n')
  )
  writeJson(path.join(agentDir, 'mcp.json'), {
    mcpServers: {
      memory: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        description: 'Remember project decisions and relationships across conversations.',
        enabled: true,
        exposure: 'codemode'
      },
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', AURORA],
        description: 'Read and edit files inside the Aurora Studio workspace.',
        enabled: true,
        exposure: 'codemode'
      },
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
        description: 'Look up current library documentation and usage examples.',
        enabled: false,
        exposure: 'deferred'
      }
    }
  })
  writeJson(path.join(AURORA, '.pi', 'mcp.json'), {
    mcpServers: {
      git: {
        command: 'uvx',
        args: ['mcp-server-git', '--repository', AURORA],
        description: 'Inspect Aurora Studio history, branches, and working-tree changes.',
        enabled: true,
        exposure: 'direct'
      },
      playwright: {
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest'],
        description: 'Verify the workspace in a browser and capture visual checks.',
        enabled: true,
        exposure: 'deferred'
      }
    }
  })

  const templates = [
    ['Architect', 'architect', 'Plans the design and breaks complex work into clear implementation steps.', 'worktree'],
    ['Frontend Engineer', 'frontend', 'Builds accessible interfaces and keeps the visual system consistent.', 'worktree'],
    ['Backend Engineer', 'backend', 'Implements services, APIs, validation, and core application logic.', 'worktree'],
    ['QA Engineer', 'qa', 'Runs focused tests and verifies behavior against the requirements.', 'worktree'],
    ['Reviewer', 'reviewer', 'Reviews diffs for correctness, regressions, and missing test coverage.', 'shared'],
    ['Documentation Writer', 'docs', 'Keeps setup instructions and user-facing guidance accurate and concise.', 'shared']
  ].map(([name, role, description, workspaceMode], index) => ({
    id: `docs-template-${index + 1}`,
    name,
    role,
    description,
    systemPrompt: `You are the ${name} for Aurora Studio. ${description}`,
    provider: null,
    modelId: null,
    thinkingLevel: role === 'reviewer' ? 'high' : null,
    toolNames: null,
    skillIds: [],
    workspaceMode,
    isReviewer: role === 'reviewer',
    createdAt: Date.parse('2026-10-20T09:00:00.000Z') + index * 1000,
    updatedAt: Date.parse('2026-10-30T09:00:00.000Z') + index * 1000
  }))
  writeJson(path.join(testUserData, 'harness-orchestration.json'), {
    schemaVersion: 1,
    templates,
    teams: [],
    orchestrations: [],
    agents: [],
    tasks: [],
    handoffs: [],
    evaluations: []
  })
  writeJson(path.join(testUserData, 'remote-hosts.json'), {
    hosts: [
      {
        id: '3b6f2b10-76d0-4f7d-949d-32ef238db211',
        label: 'Aurora Build Server',
        url: 'wss://build.aurora.example/v1/racp/ws',
        hostId: 'aurora-build-01',
        version: '1.4.2',
        lastConnectedAt: '2026-10-30T08:42:00.000Z'
      },
      {
        id: 'a58c793f-15b0-4b91-a5af-5439b12de17a',
        label: 'Design Review workstation',
        url: 'wss://review.aurora.example/v1/racp/ws',
        hostId: 'aurora-review-02',
        version: '1.4.2',
        lastConnectedAt: '2026-10-29T16:18:00.000Z'
      }
    ]
  })
}

const test = base.extend({
  piAgentDir: async ({ testUserData }, use) => {
    const agentDir = path.join(testUserData, 'mock-pi')
    fs.cpSync(path.resolve('fixtures/mock-pi'), agentDir, { recursive: true })
    writeProfileSettings(testUserData, {
      shortcutOverrides: {
        'workspace-new-session': ['meta+shift+n', 'ctrl+shift+n']
      }
    })
    ensureAuroraWorkspace()
    seedAgentConfiguration(agentDir, testUserData)
    seedConversation(agentDir, AURORA, sessionId, [
      { role: 'user', text: 'Review the Aurora Studio workspace settings.' },
      {
        role: 'assistant',
        text: 'The workspace is configured with shared instructions, focused MCP tools, and specialist subagents.'
      }
    ])
    await use(agentDir)
  }
})

async function go(page: Page, hash: string) {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash
  }, hash)
}

async function cleanShot(page: Page, name: string) {
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0)
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0)
  await expect(page.locator('.feature-error:visible')).toHaveCount(0)
  // Settle real route/tab transitions instead of capturing two highlighted items.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      try {
        animation.finish()
      } catch {
        animation.cancel()
      }
    }
  })
  expect(page.viewportSize()).toEqual(VIEWPORT)
  await shot(page, output(name))
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
})

test('capture general, AI, voice, and keyboard settings', async ({ page }) => {
  await openSession(page, { cwd: AURORA, sessionId, title: 'Aurora Studio setup' })
  await go(page, '#/settings/general')
  await expect(page.getByRole('button', { name: 'Theme', exact: true })).toBeVisible()
  await expect(page.getByText('Soft Light', { exact: true })).toBeVisible()
  await cleanShot(page, '通用设置')

  await go(page, '#/settings/ai')
  await expect(page.getByTestId('agent-settings-ai').locator('form')).toBeVisible()
  await expect(page.getByText('Automatic context compaction', { exact: true })).toBeVisible()
  await cleanShot(page, 'AI')

  await go(page, '#/settings/voice')
  await expect(page.getByTestId('agent-settings-voice').locator('form')).toBeVisible()
  await expect(page.getByText('Enable realtime voice', { exact: true })).toBeVisible()
  await cleanShot(page, '实时语音')

  await go(page, '#/settings/shortcuts')
  await expect(page.getByTestId('agent-settings-shortcuts')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Record shortcut New conversation', exact: true })
  ).toContainText('⇧')
  await expect(page.getByRole('heading', { name: 'File editor', exact: true })).toBeVisible()
  await cleanShot(page, '快捷键')
})

test('capture instructions, MCP, subagents, and remote hosts', async ({ page }) => {
  await openSession(page, { cwd: AURORA, sessionId, title: 'Aurora Studio setup' })
  await go(page, '#/settings/instructions')
  const instructions = page.getByRole('textbox', { name: 'Instructions', exact: true })
  await expect(instructions).toBeVisible()
  await expect(instructions).toHaveValue(/# Aurora Studio/)
  await cleanShot(page, '指令')

  await go(page, '#/settings/mcp')
  await expect(page.getByTestId('mcp-server-memory')).toBeVisible()
  await expect(page.getByTestId('mcp-server-git')).toBeVisible()
  await expect(page.getByTestId('mcp-server-playwright')).toBeVisible()
  await cleanShot(page, 'MCP服务器')

  await page.getByRole('button', { name: 'Marketplace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'MCP marketplace', exact: true })).toBeVisible()
  await expect(page.getByText('Sequential Thinking', { exact: true })).toBeVisible()
  await expect(page.getByText(/Included catalog · 15/)).toBeVisible()
  await cleanShot(page, 'MCP市场')

  await go(page, '#/settings/subagents')
  await expect(page.getByTestId('subagent-Architect')).toBeVisible()
  await expect(page.getByTestId('subagent-Reviewer')).toBeVisible()
  await expect(page.getByTestId('subagent-Documentation Writer')).toBeVisible()
  await cleanShot(page, '子智能体')

  await go(page, '#/settings/remote')
  await expect(page.getByTestId('remote-host-Aurora Build Server')).toBeVisible()
  await expect(page.getByTestId('remote-host-Design Review workstation')).toBeVisible()
  await expect(page.getByText('Disconnected', { exact: true }).first()).toBeVisible()
  await cleanShot(page, '远程主机')
})

test('capture provider and model management', async ({ page }) => {
  await go(page, '#/models')
  await expect(page.getByTestId('provider-row')).toHaveCount(2)
  await expect(
    page.getByTestId('provider-row').filter({ hasText: 'openai-compatible' })
  ).toBeVisible()
  await cleanShot(page, 'Provider与模型-1')

  await page.getByTestId('provider-tab-models').click()
  await expect(page.getByTestId('model-action-cell')).toHaveCount(2)
  await expect(page.getByText('Claude Sonnet 4', { exact: true })).toBeVisible()
  await cleanShot(page, 'Provider与模型-2')
})

async function mockCapabilities(electronApp: ElectronApplication) {
  await electronApp.evaluate(
    ({ ipcMain }, channels) => {
      const ok = (data: unknown) => ({ ok: true, data })
      const packages = [
        {
          id: 'global:npm:pi-project-toolkit',
          source: 'npm:pi-project-toolkit',
          name: 'pi-project-toolkit',
          sourceType: 'npm',
          scope: 'global',
          projectRoot: null,
          registered: true,
          registryPath: '/Users/demo/.pi/agent/settings.json',
          version: '2.4.1',
          description: 'Project planning, code review, and delivery workflows for Pi.',
          path: '/Users/demo/.pi/agent/packages/pi-project-toolkit',
          installed: true,
          available: true,
          healthy: true,
          health: 'healthy',
          managed: true,
          resources: {
            skills: ['planning', 'code-review', 'verification'],
            prompts: ['plan', 'review'],
            extensions: [],
            themes: [],
            tools: []
          },
          resourceItems: [],
          problems: [],
          permissions: []
        },
        {
          id: 'project:npm:pi-browser-tools',
          source: 'npm:pi-browser-tools',
          name: 'pi-browser-tools',
          sourceType: 'npm',
          scope: 'project',
          projectRoot: '/tmp/docs-shots/demo/Aurora Studio',
          registered: true,
          registryPath: '/tmp/docs-shots/demo/Aurora Studio/.pi/settings.json',
          version: '1.8.0',
          description: 'Browser verification and visual regression workflows.',
          path: '/tmp/docs-shots/demo/Aurora Studio/.pi/packages/pi-browser-tools',
          installed: true,
          available: true,
          healthy: true,
          health: 'healthy',
          managed: true,
          resources: {
            skills: ['browser-testing'],
            prompts: [],
            extensions: ['browser-tools'],
            themes: [],
            tools: []
          },
          resourceItems: [],
          problems: [],
          permissions: []
        }
      ]
      for (const channel of [channels.search, channels.packages, channels.updates]) {
        ipcMain.removeHandler(channel)
      }
      ipcMain.handle(channels.search, () =>
        ok({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0, fetchedAt: Date.now() })
      )
      ipcMain.handle(channels.packages, () => ok(packages))
      ipcMain.handle(channels.updates, () =>
        ok([
          {
            packageId: packages[0].id,
            source: packages[0].source,
            scope: 'global',
            installedVersion: '2.4.1',
            latestVersion: '2.4.1',
            updateAvailable: false,
            state: 'up-to-date',
            error: null
          },
          {
            packageId: packages[1].id,
            source: packages[1].source,
            scope: 'project',
            installedVersion: '1.8.0',
            latestVersion: '1.9.0',
            updateAvailable: true,
            state: 'update-available',
            error: null
          }
        ])
      )
    },
    {
      search: IPC_INVOKE.packagesRegistrySearch,
      packages: IPC_INVOKE.skillsPackages,
      updates: IPC_INVOKE.packagesCheckUpdates
    }
  )
}

test('capture capability skills, installed packages, and featured collections', async ({
  electronApp,
  page
}) => {
  await mockCapabilities(electronApp)
  await go(page, '#/skills')
  await expect(page.getByRole('heading', { name: 'Capabilities', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Skills', exact: true }).click()
  await expect(page.getByTestId('featured-capability-native-pi')).toBeVisible()
  await expect(page.getByText('Native runtime', { exact: true })).toBeVisible()
  await cleanShot(page, '能力中心-1')

  await page.getByRole('tab', { name: 'Installed', exact: true }).click()
  await expect(page.getByText('pi-project-toolkit', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('pi-browser-tools', { exact: true })).toBeVisible()
  await expect(page.getByText('2.4.1', { exact: true }).first()).toBeVisible()
  await cleanShot(page, '能力中心-2')

  await page.getByRole('tab', { name: 'Featured', exact: true }).click()
  await expect(page.getByTestId('market-collection-core-development')).toBeVisible()
  await expect(page.getByText('Skills For Real Engineers', { exact: true }).first()).toBeVisible()
  await cleanShot(page, '能力中心-3')
})
