import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HarnessPolicyConfig, HarnessPolicyDecisionReport } from '@shared/types/harness'
import { JsonStore } from '../../services/storage'
import { DEFAULT_POLICY_CONFIG, DANGEROUS_COMMAND_PATTERNS } from './policy-defaults'
import { PolicyEngine } from './policy-engine'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createEngine(config: Partial<HarnessPolicyConfig> = {}): PolicyEngine {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-harness-policy-'))
  tempDirs.push(dir)
  const store = new JsonStore<HarnessPolicyConfig>(path.join(dir, 'policy.json'), {
    ...structuredClone(DEFAULT_POLICY_CONFIG),
    ...structuredClone(config)
  })
  return new PolicyEngine(store)
}

describe('PolicyEngine', () => {
  it('exposes defaults merged over an empty store', () => {
    const engine = createEngine()
    const config = engine.peek()
    expect(config.files.delete).toBe('ask')
    expect(config.git.forcePush).toBe('deny')
    expect(config.shell.default).toBe('allow')
    expect(config.budget.maxTokens).toBeNull()
  })

  it('evaluates shell commands through the full decision chain', () => {
    const engine = createEngine({
      shell: {
        ...DEFAULT_POLICY_CONFIG.shell,
        denyCommands: ['rm -rf'],
        allowCommands: ['pnpm test'],
        dangerousConfirmation: true
      }
    })

    expect(engine.shellCommandDecision('echo hi')).toMatchObject({
      decision: 'allow',
      rule: 'shell.default'
    })
    expect(engine.shellCommandDecision('pnpm test src')).toMatchObject({
      decision: 'allow',
      rule: expect.stringContaining('shell.allowCommands')
    })
    // Git actions route through the git domain policy.
    expect(engine.shellCommandDecision('git push origin main')).toMatchObject({
      decision: 'ask',
      domain: 'git'
    })
    expect(engine.shellCommandDecision('git push --force origin main')).toMatchObject({
      decision: 'deny',
      rule: 'git.forcePush'
    })
    // Dangerous commands ask even when the shell default is allow.
    expect(engine.shellCommandDecision('sudo systemctl restart nginx')).toMatchObject({
      decision: 'ask',
      rule: expect.stringContaining('dangerousConfirmation')
    })
    expect(engine.shellCommandDecision('rm -rf /tmp/x')).toMatchObject({
      decision: 'deny',
      rule: expect.stringContaining('shell.denyCommands')
    })
  })

  it('filters tool names and reports denied ones with their rule', () => {
    const engine = createEngine({
      tools: {
        ...DEFAULT_POLICY_CONFIG.tools,
        default: 'allow',
        overrides: { bash: 'deny' }
      }
    })
    const result = engine.filterToolNames(['read', 'bash', 'edit'])
    expect(result.allowed).toEqual(['read', 'edit'])
    expect(result.denied).toEqual([
      {
        name: 'bash',
        evaluation: { decision: 'deny', domain: 'tool', rule: 'tools.overrides.bash' }
      }
    ])
  })

  it('persists updates and keeps them across engine instances sharing a store path', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pi-harness-policy-'))
    tempDirs.push(dir)
    const storePath = path.join(dir, 'policy.json')
    const store = new JsonStore<HarnessPolicyConfig>(storePath, structuredClone(DEFAULT_POLICY_CONFIG))
    const engine = new PolicyEngine(store)
    await engine.update({
      ...structuredClone(DEFAULT_POLICY_CONFIG),
      git: { ...DEFAULT_POLICY_CONFIG.git, push: 'deny' },
      budget: { ...DEFAULT_POLICY_CONFIG.budget, maxTokens: 1234 }
    })

    const reloaded = new PolicyEngine(
      new JsonStore<HarnessPolicyConfig>(storePath, structuredClone(DEFAULT_POLICY_CONFIG))
    )
    // peek() is cache-only, so read from disk once before asserting.
    await reloaded.config()
    expect(reloaded.budget()).toMatchObject({ maxTokens: 1234 })
    expect(reloaded.gitDecision('push').decision).toBe('deny')
    expect(reloaded.autoEvaluate()).toBe(DEFAULT_POLICY_CONFIG.evaluation.autoEvaluate)
  })

  it('denies ask decisions without a visible window instead of escalating', async () => {
    const engine = createEngine()
    const decisions: HarnessPolicyDecisionReport[] = []
    engine.onDecision((report) => decisions.push(report))
    const allowed = await engine.resolveAsk('s1', 'git push origin main', {
      decision: 'ask',
      domain: 'git',
      rule: 'git.push'
    })
    expect(allowed).toBe(false)
    expect(decisions).toEqual([
      {
        sessionId: 's1',
        domain: 'git',
        decision: 'ask',
        target: 'git push origin main',
        rule: 'git.push',
        allowed: false
      }
    ])
  })

  it('ships dangerous command patterns that catch destructive shells', () => {
    const engine = createEngine({
      shell: { ...DEFAULT_POLICY_CONFIG.shell, dangerousConfirmation: true }
    })
    for (const command of ['sudo rm -rf /', 'sudo systemctl restart nginx', 'git reset --hard']) {
      const evaluation = engine.shellCommandDecision(command)
      expect(['ask', 'deny']).toContain(evaluation.decision)
    }
    expect(DANGEROUS_COMMAND_PATTERNS.length).toBeGreaterThan(0)
  })
})
