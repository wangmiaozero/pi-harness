import fs from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from './fixtures'

for (let round = 0; round < 3; round++) {
  test(`records fresh-profile launch, renderer reload and bounded map latency, round ${round + 1}`, async ({
    page,
    electronApp,
    startupMetrics,
    workspaceRoot
  }) => {
    test.setTimeout(120000)
    const reloadMs: number[] = []
    for (let sample = 0; sample < 2; sample++) {
      const started = performance.now()
      await page.reload()
      await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
      await expect(page.locator('a[href="#/workspace"]')).toBeVisible()
      reloadMs.push(performance.now() - started)
    }
    await page.waitForTimeout(1000)
    const processes = await electronApp.evaluate(({ app }) =>
      app.getAppMetrics().map((metric) => ({
        type: metric.type,
        workingSetSizeKiB: metric.memory.workingSetSize,
        cpuPercent: metric.cpu.percentCPUUsage
      }))
    )
    for (let index = 0; index < 420; index++)
      await fs.writeFile(
        path.join(workspaceRoot, `module-${index}.ts`),
        `export const value = ${index}\n`
      )
    let started = performance.now()
    await page.evaluate((root) => window.piSwitch.intelligence.analyze({ root }), workspaceRoot)
    await expect
      .poll(
        () =>
          page.evaluate(
            (root) => window.piSwitch.intelligence.status(root).then((state) => state.phase),
            workspaceRoot
          ),
        { timeout: 45000 }
      )
      .toBe('completed')
    const scanAndRenderMs = performance.now() - started
    const snapshot = await page.evaluate(
      (root) => window.piSwitch.intelligence.snapshot({ root }),
      workspaceRoot
    )
    expect(snapshot?.graph.coverage.partial).toBe(true)
    const projectionMs: number[] = []
    for (const offset of [48, 96]) {
      started = performance.now()
      await page.evaluate(
        ({ root, snapshotId, offset }) =>
          window.piSwitch.intelligence.map({ root, snapshotId, offset }),
        { root: workspaceRoot, snapshotId: snapshot!.graph.snapshotId, offset }
      )
      projectionMs.push(performance.now() - started)
    }
    const output = path.resolve(`out/quality/gui-${process.platform}-${process.arch}-${round}.json`)
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(
      output,
      JSON.stringify(
        {
          schemaVersion: 1,
          round,
          environment: { platform: process.platform, arch: process.arch, node: process.version },
          method:
            'Fresh isolated application profile; OS disk caches are not flushed. Renderer reload is not a full warm process launch. Process memory/CPU are observations one second after readiness. Map timings measure generation and IPC, not GPU frame rendering.',
          freshProfileLaunch: startupMetrics,
          rendererReloadMs: reloadMs,
          processes,
          scanAndRenderMs,
          projectionMs,
          coverage: snapshot!.graph.coverage,
          notMeasured: [
            'OS installer cold boot',
            'concurrent live-agent UI latency',
            'GPU frame timings'
          ]
        },
        null,
        2
      ) + '\n'
    )
  })
}
