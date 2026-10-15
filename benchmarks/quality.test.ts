import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { it, expect } from 'vitest'
import { UniversalSessionService } from '../src/main/universal/service'
import { scanSources } from '../src/main/universal/scanner'
import { scanProject } from '../src/main/intelligence/scanner'
import { extractGraph } from '../src/main/intelligence/graph'

it('records repeatable bounded history and architecture measurements', async () => {
  const application = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8')) as {
    version: string
  }
  const revision = (await promisify(execFile)('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const output = path.resolve('out/quality/benchmark.json')
  await fs.mkdir(path.dirname(output), { recursive: true })
  const samples: Array<Record<string, number | string | boolean>> = []
  const save = async () => {
    const metrics = [
      'syncMs',
      'warmSyncMs',
      'searchMs',
      'restoreMs',
      'scanMs',
      'extractMs',
      'cachedExtractMs'
    ]
    const statistics = Object.fromEntries(
      [10000, 50000, 100000, 'architecture'].map((scenario) => [
        scenario,
        Object.fromEntries(
          metrics.flatMap((metric) => {
            const values = samples
              .filter((sample) => sample.scenario === scenario)
              .map((sample) => sample[metric])
              .filter((value): value is number => typeof value === 'number')
              .sort((a, b) => a - b)
            return values.length
              ? [
                  [
                    metric,
                    {
                      median: values[Math.floor(values.length / 2)],
                      max: values.at(-1),
                      samples: values.length
                    }
                  ]
                ]
              : []
          })
        )
      ])
    )
    await fs.writeFile(
      output,
      JSON.stringify(
        {
          schemaVersion: 1,
          applicationVersion: application.version,
          revision,
          workingTreeIncludesUncommittedChanges: true,
          generatedAt: new Date().toISOString(),
          environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            os: os.release(),
            cpu: os.cpus()[0]?.model,
            cpuCount: os.cpus().length
          },
          method:
            'Three sequential rounds per corpus; wall-clock monotonic timings. First sync uses a new local cache, warm sync uses unchanged sources. Process RSS is observational, not an isolated component allocation. No fixed performance threshold is asserted.',
          notMeasured: [
            'OS cold/warm launch',
            'idle GUI CPU/RSS',
            'interactive graph frame timings',
            'concurrent live-agent UI latency'
          ],
          samples,
          statistics
        },
        null,
        2
      ) + '\n'
    )
  }
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pi-quality-benchmark-')))
  try {
    for (const count of [10000, 50000, 100000]) {
      const source = path.join(root, `source-${count}`)
      await fs.mkdir(source)
      const file = path.join(source, 'session.jsonl')
      const writer = createWriteStream(file)
      for (let index = 0; index < count; index++) {
        const row = {
          type: index % 2 ? 'assistant' : 'user',
          uuid: `m-${index}`,
          sessionId: `benchmark-${count}`,
          message: {
            role: index % 2 ? 'assistant' : 'user',
            content: `Benchmark message ${index}; needle-${index}; deterministic local fixture.`
          }
        }
        if (!writer.write(JSON.stringify(row) + '\n')) await once(writer, 'drain')
      }
      writer.end()
      await once(writer, 'finish')
      for (let round = 0; round < 3; round++) {
        const service = new UniversalSessionService(
          path.join(root, `cache-${count}-${round}`),
          [{ provider: 'claude', root: source, custom: true }],
          (request, progress) => scanSources(request, undefined, progress)
        )
        try {
          const cpu = process.cpuUsage()
          let started = performance.now()
          expect((await service.sync()).errors).toEqual([])
          const syncMs = performance.now() - started
          started = performance.now()
          expect((await service.sync()).changed).toBe(0)
          const warmSyncMs = performance.now() - started
          started = performance.now()
          const result = await service.list({ query: `needle-${count - 1}` })
          const searchMs = performance.now() - started
          expect(result.total).toBe(1)
          started = performance.now()
          expect(
            (await service.read({ id: result.sessions[0].id, offset: count - 200, limit: 200 }))
              .messages
          ).toHaveLength(200)
          const restoreMs = performance.now() - started
          const usage = process.cpuUsage(cpu)
          samples.push({
            scenario: count,
            round,
            syncMs,
            warmSyncMs,
            searchMs,
            restoreMs,
            rssBytes: process.memoryUsage().rss,
            cpuUserMicros: usage.user,
            cpuSystemMicros: usage.system
          })
          await save()
          process.stdout.write(
            `history ${count}, round ${round + 1}: sync ${Math.round(syncMs)} ms; search ${Math.round(searchMs)} ms\n`
          )
        } finally {
          await service.close()
        }
      }
    }
    const project = path.join(root, 'project')
    await fs.mkdir(project)
    const languages = [
      { extension: 'py', text: 'from .module_0 import value\nvalue = 1' },
      { extension: 'go', text: 'package example\nimport "example/local"\nfunc Run() {}' },
      { extension: 'java', text: 'package example; import example.Unknown; class Example {}' },
      { extension: 'rs', text: 'pub fn run() {}' }
    ]
    for (const language of languages) {
      const directory = path.join(project, language.extension)
      await fs.mkdir(directory)
      for (let index = 0; index < 110; index++)
        await fs.writeFile(
          path.join(directory, `module_${index}.${language.extension}`),
          language.text
        )
    }
    for (let round = 0; round < 3; round++) {
      let started = performance.now()
      const scan = await scanProject(project, new AbortController().signal)
      const scanMs = performance.now() - started
      started = performance.now()
      const graph = extractGraph(project, scan)
      const extractMs = performance.now() - started
      started = performance.now()
      const cached = extractGraph(project, scan)
      const cachedExtractMs = performance.now() - started
      expect(cached.edges).toEqual(graph.edges)
      expect(graph.coverage.partial).toBe(true)
      expect(graph.nodes.length).toBeLessThanOrEqual(400)
      samples.push({
        scenario: 'architecture',
        round,
        scanMs,
        extractMs,
        cachedExtractMs,
        files: scan.files.length,
        partial: graph.coverage.partial,
        rssBytes: process.memoryUsage().rss
      })
      await save()
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
