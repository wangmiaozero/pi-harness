import fs from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from './fixtures'

test.describe('Agent settings', () => {
  test.use({ fakeAudio: true })
  test('shows seven destinations and preserves existing models and capabilities', async ({
    page
  }) => {
    await page.locator('a[href="#/settings"]').click()
    for (const section of [
      'ai',
      'voice',
      'shortcuts',
      'instructions',
      'mcp',
      'subagents',
      'remote'
    ])
      await expect(page.getByTestId(`settings-section-${section}`)).toBeVisible()
    const search = page.getByRole('textbox', { name: '搜索设置…' })
    await search.fill('MCP')
    await expect(page.getByTestId('settings-section-mcp')).toBeVisible()
    await expect(page.getByTestId('settings-section-ai')).toHaveCount(0)
    await search.fill('')
    for (const section of [
      'ai',
      'voice',
      'shortcuts',
      'instructions',
      'mcp',
      'subagents',
      'remote'
    ]) {
      await page.getByTestId(`settings-section-${section}`).click()
      await expect(page.getByTestId(`agent-settings-${section}`)).toBeVisible()
      await expect(page.locator('h1')).not.toContainText('agentSettings.')
      await expect(page.getByRole('alert')).toHaveCount(0)
    }
    await expect(page.getByTestId('settings-section-models')).toHaveCount(0)
    await page.locator('a[href="#/models"]').click()
    await expect(page.getByTestId('model-management-tab-models')).toBeVisible()
    await page.locator('a[href="#/settings"]').click()
    await expect(page.getByTestId('settings-section-skills')).toHaveCount(0)
    await page.locator('a[href="#/skills"]').click()
    await expect(page.locator('h1')).toContainText(/能力中心|Capabilities/)
  })
  test('saves native AI preferences, instructions and MCP lifecycle through the bridge', async ({
    page,
    piAgentDir
  }) => {
    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-ai').click()
    const ai = page.getByTestId('agent-settings-ai')
    await ai.getByRole('combobox', { name: '默认思考级别' }).selectOption('high')
    await ai.getByRole('button', { name: '保存更改' }).click()
    await expect(ai.getByRole('status')).toContainText('更改已保存')
    expect(
      JSON.parse(await fs.readFile(path.join(piAgentDir, 'settings.json'), 'utf8'))
        .defaultThinkingLevel
    ).toBe('high')
    await page.getByTestId('settings-section-instructions').click()
    const instructions = page.getByTestId('agent-settings-instructions')
    await instructions
      .getByRole('textbox', { name: '指令', exact: true })
      .fill('Fixture instruction: keep responses concise.')
    await instructions.getByRole('button', { name: '保存更改' }).click()
    await expect(instructions.getByRole('status')).toContainText('更改已保存')
    expect(await fs.readFile(path.join(piAgentDir, 'AGENTS.md'), 'utf8')).toBe(
      'Fixture instruction: keep responses concise.'
    )
    await page.getByTestId('settings-section-mcp').click()
    await page.getByRole('button', { name: '添加 MCP 服务器' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('fixture-server')
    await dialog.getByRole('textbox', { name: '可执行文件' }).fill('node')
    await dialog.getByRole('textbox', { name: '参数（每行一个）' }).fill('fixture.mjs')
    await dialog.getByRole('button', { name: '保存更改' }).click()
    const row = page.getByTestId('mcp-server-fixture-server')
    await expect(row).toBeVisible()
    await row.getByRole('switch').click()
    await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    const mcp = JSON.parse(await fs.readFile(path.join(piAgentDir, 'mcp.json'), 'utf8'))
    expect(mcp.mcpServers['fixture-server']).toMatchObject({
      command: 'node',
      args: ['fixture.mjs'],
      enabled: false
    })
    await row.getByRole('button', { name: '编辑 fixture-server' }).click()
    await dialog.getByRole('textbox', { name: '描述', exact: true }).fill('Fixture MCP server')
    await dialog.getByRole('button', { name: '保存更改' }).click()
    await expect(row).toContainText('Fixture MCP server')
    if (process.env.PI_HARNESS_DESIGN_QA_DIR)
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'agent-settings-mcp.png')
      })
    await row.getByRole('button', { name: '移除 fixture-server' }).click()
    await page
      .getByRole('dialog', { name: '移除此项？' })
      .getByRole('button', { name: '移除', exact: true })
      .click()
    await expect(row).toHaveCount(0)
  })
  test('edits subagents and records an effective shortcut', async ({ page }) => {
    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-subagents').click()
    await page.getByRole('button', { name: '新建子智能体' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('Fixture reviewer')
    await dialog.getByRole('textbox', { name: '角色', exact: true }).fill('reviewer')
    await dialog
      .getByRole('textbox', { name: '指令', exact: true })
      .fill('Review changes and report actionable issues.')
    await dialog.getByRole('button', { name: '保存更改' }).click()
    const row = page.getByTestId('subagent-Fixture reviewer')
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: '编辑 Fixture reviewer' }).click()
    await expect(dialog.getByRole('textbox', { name: '指令', exact: true })).toHaveValue(
      'Review changes and report actionable issues.'
    )
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    if (process.env.PI_HARNESS_DESIGN_QA_DIR)
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'agent-settings-subagents.png')
      })
    await page.getByTestId('settings-section-shortcuts').click()
    await page.getByRole('button', { name: '录制快捷键 打开设置' }).click()
    await page.keyboard.press('Control+g')
    await expect(page.getByRole('status')).toContainText('更改已保存')
    await page.locator('a[href="#/models"]').click()
    await page.keyboard.press('Control+g')
    await expect(page.getByTestId('settings-layout')).toBeVisible()
    await page.getByTestId('settings-section-shortcuts').click()
    await expect(page.getByRole('button', { name: '录制快捷键 打开设置' })).toContainText('CTRL G')
  })
  test('loads the microphone worklet under the desktop content policy and releases capture', async ({
    page
  }) => {
    const assets = await fs.readdir(path.resolve('out/renderer/assets'))
    const worklet = assets.find((file) => /^pcm-capture-.*\.js$/.test(file))
    expect(worklet).toBeTruthy()
    const result = await page.evaluate(async (worklet) => {
      const timeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
        Promise.race([
          promise,
          new Promise<T>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`Timed out: ${label}`)), 12000)
          )
        ])
      const api = window.piSwitch!.agentSettings.voice
      const settings = await timeout(api.get(), 'read settings')
      await timeout(
        api.save({
          enabled: true,
          endpoint: settings.endpoint,
          model: settings.model,
          voice: settings.voice,
          profile: settings.profile
        }),
        'save settings'
      )
      const id = await timeout(api.prepare(), 'prepare capture')
      const media = await timeout(
        navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
        'request virtual microphone'
      )
      const context = new AudioContext({ sampleRate: 24000 })
      try {
        await timeout(
          context.audioWorklet.addModule(
            new URL(`./assets/${worklet}`, window.location.href.split('#')[0]).href
          ),
          'load worklet'
        )
        await timeout(context.resume(), 'resume context')
        const capture = new AudioWorkletNode(context, 'harness-pcm-capture')
        const input = context.createMediaStreamSource(media)
        const bytes = await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('No PCM frame captured')), 10000)
          capture.port.onmessage = (event) => {
            clearTimeout(timer)
            resolve(event.data.byteLength)
          }
          input.connect(capture)
          capture.connect(context.destination)
        })
        return { bytes, sampleRate: context.sampleRate }
      } finally {
        media.getTracks().forEach((track) => track.stop())
        await timeout(context.close(), 'close context')
        await api.stop(id)
      }
    }, worklet!)
    expect(result).toEqual({ bytes: 4096, sampleRate: 24000 })
  })
  test('shows voice and remote connection setup, rejects invalid remote addresses', async ({
    page
  }) => {
    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-voice').click()
    const voice = page.getByTestId('agent-settings-voice')
    await expect(voice.getByRole('button', { name: '开始语音通话' })).toBeDisabled()
    await expect(voice.getByRole('textbox', { name: '语音模型' })).toHaveValue('gpt-realtime')
    if (process.env.PI_HARNESS_DESIGN_QA_DIR)
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'agent-settings-voice.png')
      })
    await page.getByTestId('settings-section-remote').click()
    await page.getByRole('button', { name: '配对主机' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: '主机名称' }).fill('Fixture')
    await dialog
      .getByRole('textbox', { name: 'pi-host WebSocket 地址' })
      .fill('ws://outside.test/v1/racp/ws')
    await dialog.getByLabel('配对令牌或设备令牌').fill('ppt1.fixture')
    await dialog.getByRole('button', { name: '配对主机', exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  })
})
