import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'

/**
 * Temporary docs-screenshot capture helpers (untracked; removed after the
 * docs refresh). Screenshots are written under PI_HARNESS_CAPTURE_DIR
 * (default /tmp/docs-shots) using the docs/ directory layout.
 */

export const CAPTURE_ROOT = process.env.PI_HARNESS_CAPTURE_DIR ?? '/tmp/docs-shots'
export const OUTPUT_ROOT = path.join(CAPTURE_ROOT, 'out')
export const DEMO_ROOT = path.join(CAPTURE_ROOT, 'demo')
export const AURORA = path.join(DEMO_ROOT, 'Aurora Studio')

export const VIEWPORT = { width: 1600, height: 1000 }

export function writeProfileSettings(testUserData: string, extra: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(testUserData, 'settings.json'),
    JSON.stringify({
      language: 'en-US',
      theme: 'soft-light',
      composerFireEnabled: false,
      userName: 'Me',
      assistantName: 'Assistant',
      ...extra
    })
  )
}

/** Idempotently create the demo git workspace used across captures. */
export function ensureAuroraWorkspace(): string {
  const files: Record<string, string> = {
    'package.json':
      JSON.stringify(
        {
          name: 'aurora-studio',
          private: true,
          version: '0.1.0',
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build' }
        },
        null,
        2
      ) + '\n',
    'README.md':
      '# Aurora Studio\n\nA calm desktop workspace demo project.\n',
    'index.html':
      '<!doctype html>\n<html>\n  <head><title>Aurora Studio</title></head>\n  <body><div id="app"></div><script type="module" src="/src/main.ts"></script></body>\n</html>\n',
    '.gitignore': 'node_modules\ndist\n',
    'src/main.ts':
      'import { createApp } from "./app"\n\ncreateApp(document.querySelector("#app")!)\n',
    'src/app.ts':
      'export function createApp(root: HTMLElement) {\n  root.innerHTML = `<main class="workspace">Aurora Studio</main>`\n}\n',
    'src/theme/tokens.css':
      ':root {\n  --accent: #7a5bd3;\n  --bg-window: #f6f5f2;\n}\n'
  }
  if (!fs.existsSync(path.join(AURORA, '.git'))) {
    fs.mkdirSync(path.join(AURORA, 'src', 'theme'), { recursive: true })
    const writeAll = () => {
      for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.join(AURORA, path.dirname(rel)), { recursive: true })
        fs.writeFileSync(path.join(AURORA, rel), content)
      }
    }
    writeAll()
    const git = (args: string[]) =>
      execFileSync('git', ['-C', AURORA, ...args], { stdio: 'pipe' })
    const commit = (message: string, when: string) =>
      git([
        '-c', 'user.name=Aurora Demo',
        '-c', 'user.email=demo@aurora.local',
        'commit', '--allow-empty', '-m', message,
        '--date', when
      ])
    const env = {
      GIT_AUTHOR_DATE: '2026-10-28T09:12:00',
      GIT_COMMITTER_DATE: '2026-10-28T09:12:00'
    }
    void env
    git(['init', '-q', '-b', 'main'])
    git(['add', '-A'])
    commit('Initial project scaffold', '2026-10-28T09:12:00')
    fs.appendFileSync(path.join(AURORA, 'README.md'), '\n## Layout\n\n- Session navigation\n- Conversation area\n- Composer\n')
    git(['add', '-A'])
    commit('Add workspace layout notes', '2026-10-29T14:36:00')
    fs.writeFileSync(
      path.join(AURORA, 'src/theme/tokens.css'),
      ':root {\n  --accent: #7a5bd3;\n  --bg-window: #f6f5f2;\n  --text-primary: #2c2a33;\n}\n'
    )
    git(['add', '-A'])
    commit('Refine theme tokens', '2026-10-30T10:05:00')
  }
  return AURORA
}

export type DemoMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; model?: string; provider?: string }

/** Seed a Pi session JSONL with a user/assistant conversation. */
export function seedConversation(
  agentDir: string,
  cwd: string,
  sessionId: string,
  messages: DemoMessage[]
) {
  const safePath = `--${path
    .resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const sessionDir = path.join(agentDir, 'sessions', safePath)
  fs.mkdirSync(sessionDir, { recursive: true })
  const base = Date.parse('2026-10-30T09:00:00.000Z')
  const lines: string[] = [
    JSON.stringify({
      type: 'session',
      version: 3,
      id: sessionId,
      timestamp: new Date(base).toISOString(),
      cwd
    })
  ]
  let parentId: string | null = null
  messages.forEach((message, index) => {
    const id = `demo-${sessionId}-${index}`
    const timestamp = new Date(base + (index + 1) * 65_000).toISOString()
    if (message.role === 'user') {
      lines.push(
        JSON.stringify({
          type: 'message',
          id,
          parentId,
          timestamp,
          message: { role: 'user', content: message.text, timestamp: Date.parse(timestamp) }
        })
      )
    } else {
      lines.push(
        JSON.stringify({
          type: 'message',
          id,
          parentId,
          timestamp,
          message: {
            role: 'assistant',
            model: message.model ?? 'gpt-4o',
            provider: message.provider ?? 'openai-compatible',
            stopReason: 'stop',
            content: [{ type: 'text', text: message.text }]
          }
        })
      )
    }
    parentId = id
  })
  fs.writeFileSync(
    path.join(sessionDir, `2026-10-30T09-00-00-000Z_${sessionId}.jsonl`),
    lines.join('\n') + '\n'
  )
}

/** Point the workspace UI at the demo project and open one session tab. */
export async function openSession(
  page: Page,
  input: { cwd: string; sessionId: string; title: string }
) {
  await page.evaluate(async ({ cwd, sessionId, title }) => {
    await window.piSwitch.workspace.allowRoot(cwd)
    localStorage.setItem(
      'pi-harness.workspace.v1',
      JSON.stringify({
        projectKey: null,
        pickedCwd: null,
        projectRoots: [cwd],
        tabs: [
          { id: `chat:${sessionId}`, kind: 'chat', title, sessionId, closable: false }
        ],
        activeTabId: `chat:${sessionId}`
      })
    )
  }, input)
  await page.locator('a[href="#/workspace"]').click()
  // The session index refresh toast would otherwise leak into captures.
  await page
    .getByText('Refreshed', { exact: true })
    .waitFor({ state: 'hidden', timeout: 20_000 })
    .catch(() => undefined)
}

/** Screenshot into the docs layout under the capture output root. */
export async function shot(page: Page, docsRelativePath: string) {
  const target = path.join(OUTPUT_ROOT, docsRelativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  await page.screenshot({ path: target })
  return target
}
