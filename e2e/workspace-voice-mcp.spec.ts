import fs from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { test, expect } from './fixtures'

test.describe('Workspace voice and MCP market', () => {
  test.use({ fakeAudio: true })
  test('captures audio, shares only opted-in context and preserves a call across pages', async ({
    page,
    piAgentDir,
    workspaceRoot
  }, testInfo) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    const frames: Record<string, any>[] = []
    let sentTranscript = false
    server.on('connection', (socket) =>
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString())
        frames.push(frame)
        if (frame.type === 'session.update')
          socket.send(JSON.stringify({ type: 'session.updated', session: frame.session }))
        if (frame.type === 'input_audio_buffer.append' && !sentTranscript) {
          sentTranscript = true
          socket.send(
            JSON.stringify({
              type: 'response.output_audio_transcript.done',
              transcript: 'Voice fixture is connected.'
            })
          )
          socket.send(
            JSON.stringify({
              type: 'response.function_call_arguments.done',
              call_id: 'fixture-request',
              name: 'delegate_to_work_session',
              arguments: JSON.stringify({
                instruction: 'Review the current changes without editing files.'
              })
            })
          )
        }
      })
    )
    try {
      const modelsPath = path.join(piAgentDir, 'models.json'),
        models = JSON.parse(await fs.readFile(modelsPath, 'utf8'))
      models.providers['voice-fixture'] = {
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
        apiKey: 'fixture-only-voice-key',
        models: []
      }
      await fs.writeFile(modelsPath, JSON.stringify(models))
      const id = 'voice-fixture-session',
        timestamp = '2026-10-23T12:00:00.000Z'
      const sessionDir = path.join(
        piAgentDir,
        'sessions',
        `--${path
          .resolve(workspaceRoot)
          .replace(/^[/\\]/, '')
          .replace(/[/\\:]/g, '-')}--`
      )
      await fs.mkdir(sessionDir, { recursive: true })
      await fs.writeFile(
        path.join(sessionDir, `2026-10-23T12-00-00-000Z_${id}.jsonl`),
        [
          { type: 'session', version: 3, id, timestamp, cwd: workspaceRoot },
          {
            type: 'message',
            id: 'voice-user',
            parentId: null,
            timestamp,
            message: {
              role: 'user',
              content: 'Voice workspace fixture',
              timestamp: Date.parse(timestamp)
            }
          },
          {
            type: 'message',
            id: 'voice-assistant',
            parentId: 'voice-user',
            timestamp,
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Limited context fixture' }],
              model: 'fixture',
              provider: 'fixture',
              timestamp: Date.parse(timestamp)
            }
          }
        ]
          .map((row) => JSON.stringify(row))
          .join('\n') + '\n'
      )
      await page.evaluate(async () => {
        const s = await window.piSwitch.agentSettings.voice.get()
        await window.piSwitch.agentSettings.voice.save({
          enabled: true,
          providerKey: 'voice-fixture',
          endpoint: s.endpoint,
          model: s.model,
          voice: s.voice,
          profile: s.profile
        })
      })
      await page.locator('a[href="#/workspace"]').click()
      await page.getByTestId('workspace-refresh').click()
      await page
        .getByTestId('workspace-session-tree')
        .getByText('Voice workspace fixture', { exact: true })
        .click()
      await page.getByTestId('workspace-voice-trigger').click()
      const preparation = page.getByRole('dialog', { name: '实时语音' })
      await expect(preparation.getByRole('checkbox')).not.toBeChecked()
      await preparation.getByRole('checkbox').check()
      await expect(preparation).toContainText('最近 6 条纯文本消息')
      await page.screenshot({ path: testInfo.outputPath('workspace-voice-preparation.png') })
      await preparation.getByRole('button', { name: '开始实时语音' }).click()
      const bar = page.getByTestId('live-voice-bar')
      await expect(bar).toBeVisible()
      const details = page.getByRole('dialog', { name: '语音通话详情' })
      await expect(details).toBeVisible()
      await expect(details).toContainText('Voice fixture is connected.')
      await expect(details).toContainText('请确认后发送')
      await details.getByRole('button', { name: '忽略请求' }).click()
      await expect(details).toContainText('已忽略')
      await details.getByRole('button', { name: '关闭', exact: true }).click()
      expect(frames[0].session.instructions).toContain('Limited context fixture')
      expect(frames.some((frame) => frame.type === 'input_audio_buffer.append')).toBe(true)
      await page.locator('a[href="#/settings"]').click()
      await page.getByTestId('settings-section-voice').click()
      await expect(bar).toBeVisible()
      await expect(page.getByRole('combobox', { name: '语音服务' })).toBeDisabled()
      await bar.getByRole('button', { name: '关闭麦克风' }).click()
      await expect(bar).toContainText('麦克风已关闭')
      await page.screenshot({ path: testInfo.outputPath('voice-call-persists.png') })
      await bar.getByRole('button', { name: '结束通话' }).click()
      await expect(bar).toHaveCount(0)
      await expect.poll(() => server.clients.size).toBe(0)
      const microphoneReleased = await page.evaluate(async () => {
        try {
          const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          media.getTracks().forEach((track) => track.stop())
          return false
        } catch {
          return true
        }
      })
      expect(microphoneReleased).toBe(true)
      await expect(page.getByRole('combobox', { name: '语音服务' })).toBeEnabled()
    } finally {
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
  test('filters the included MCP market and installs the reviewed configuration', async ({
    page,
    piAgentDir
  }, testInfo) => {
    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-mcp').click()
    await expect(page.getByRole('button', { name: '从其他工具扫描' })).toBeVisible()
    await page.getByRole('button', { name: '市场', exact: true }).click()
    const market = page.getByTestId('mcp-market')
    await expect(market.getByRole('heading', { name: 'MCP 市场' })).toBeVisible()
    await expect(market.locator('[data-testid^="mcp-market-"]')).toHaveCount(15)
    await market.getByRole('button', { name: '文档', exact: true }).click()
    await expect(market.getByTestId('mcp-market-context7')).toBeVisible()
    await expect(market.getByTestId('mcp-market-memory')).toHaveCount(0)
    await market.getByRole('button', { name: '全部', exact: true }).click()
    await market.getByRole('textbox', { name: '搜索服务器' }).fill('Memory')
    await expect(market.locator('[data-testid^="mcp-market-"]')).toHaveCount(1)
    await market
      .getByTestId('mcp-market-memory')
      .getByRole('button', { name: '安装', exact: true })
      .click()
    const review = page.getByRole('dialog', { name: '确认服务器配置' })
    await expect(review.getByTestId('mcp-install-preview')).toContainText(
      '@modelcontextprotocol/server-memory'
    )
    await review.getByRole('button', { name: '确认安装' }).click()
    await expect(review).toHaveCount(0)
    await expect(
      market.getByTestId('mcp-market-memory').getByRole('button', { name: '已添加' })
    ).toBeDisabled()
    const config = JSON.parse(await fs.readFile(path.join(piAgentDir, 'mcp.json'), 'utf8'))
    expect(config.mcpServers.memory).toMatchObject({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory']
    })
    await market.getByRole('textbox', { name: '搜索服务器' }).fill('')
    await page.screenshot({ path: testInfo.outputPath('mcp-market.png') })
    await market.getByRole('button', { name: '我的服务器' }).click()
    await expect(page.getByTestId('mcp-server-memory')).toBeVisible()
  })
  test('groups global and project servers and edits only the selected scope', async ({
    page,
    piAgentDir,
    workspaceRoot
  }, testInfo) => {
    const id = 'mcp-scope-fixture',
      timestamp = '2026-10-24T06:00:00.000Z'
    const sessionDir = path.join(
      piAgentDir,
      'sessions',
      `--${path
        .resolve(workspaceRoot)
        .replace(/^[/\\]/, '')
        .replace(/[/\\:]/g, '-')}--`
    )
    await fs.mkdir(sessionDir, { recursive: true })
    await fs.writeFile(
      path.join(sessionDir, `2026-10-24T06-00-00-000Z_${id}.jsonl`),
      [
        { type: 'session', version: 3, id, timestamp, cwd: workspaceRoot },
        {
          type: 'message',
          id: 'mcp-user',
          parentId: null,
          timestamp,
          message: {
            role: 'user',
            content: 'MCP project fixture',
            timestamp: Date.parse(timestamp)
          }
        }
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n'
    )
    await page.evaluate(async (root) => {
      const api = window.piSwitch.agentSettings.mcp
      const fields = {
        id: 'shared-config',
        type: 'stdio' as const,
        command: 'fixture-disabled-server',
        args: [],
        enabled: false,
        exposure: 'codemode' as const
      }
      const global = await api.list({})
      await api.save({ ...fields, description: 'Global only', revision: global.revision })
      const project = await api.list({ root })
      await api.save({ ...fields, description: 'Project only', root, revision: project.revision })
    }, workspaceRoot)
    await page.locator('a[href="#/workspace"]').click()
    await page.getByTestId('workspace-refresh').click()
    await page
      .getByTestId('workspace-session-tree')
      .getByText('MCP project fixture', { exact: true })
      .click()
    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-mcp').click()
    const global = page.getByTestId('mcp-scope-global'),
      project = page.getByTestId('mcp-scope-project')
    await expect(global).toContainText('Global only')
    await expect(project).toContainText('Project only')
    await expect(page.getByRole('combobox', { name: '选择项目', exact: true })).toHaveValue(
      workspaceRoot
    )
    await project.getByRole('button', { name: '编辑 shared-config', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑 MCP 服务器' })
    await expect(dialog.getByRole('combobox', { name: '作用范围', exact: true })).toBeDisabled()
    await dialog.getByRole('textbox', { name: '描述', exact: true }).fill('Changed project only')
    await dialog.getByRole('button', { name: '保存更改' }).click()
    await expect(project).toContainText('Changed project only')
    await expect(global).toContainText('Global only')
    const globalFile = JSON.parse(await fs.readFile(path.join(piAgentDir, 'mcp.json'), 'utf8'))
    const projectFile = JSON.parse(
      await fs.readFile(path.join(workspaceRoot, '.pi/mcp.json'), 'utf8')
    )
    expect(globalFile.mcpServers['shared-config'].description).toBe('Global only')
    expect(projectFile.mcpServers['shared-config'].description).toBe('Changed project only')
    const scopes = page.getByRole('group', { name: '作用范围', exact: true })
    await scopes.getByRole('button', { name: /^全局/ }).click()
    await expect(project).toHaveCount(0)
    await expect(global).toBeVisible()
    await scopes.getByRole('button', { name: /^全部/ }).click()
    await expect(project).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('mcp-global-project-groups.png') })
  })
})
