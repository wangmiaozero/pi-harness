import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const describe = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length
    ? {
        samples: sorted.length,
        median:
          (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
        min: sorted[0],
        max: sorted.at(-1)
      }
    : null
}
export async function summarize(directory = 'out/quality') {
  const names = await fs.readdir(directory)
  const groups = new Map()
  const launches = []
  for (const name of names) {
    if (
      !/^long-session-round-\d+-\d+(?:-mixed)?\.json$/.test(name) &&
      !/^gui-.*-\d+\.json$/.test(name)
    )
      continue
    const record = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))
    if (name.startsWith('gui-')) {
      launches.push(record)
      continue
    }
    const key = `${record.messageCount}${record.mixed ? '-mixed' : ''}`
    const rows = groups.get(key) ?? []
    rows.push(record)
    groups.set(key, rows)
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    method:
      'Isolated fresh application profiles with production bundles; OS caches are not flushed. p95 is descriptive for this small sample, not a service-level claim. Heap is observational and not a forced-GC leak test.',
    scenarios: Object.fromEntries(
      [...groups].map(([key, rows]) => [
        key,
        {
          environment: rows[0].environment,
          initialRenderMs: describe(rows.map((row) => row.initialRenderMs)),
          observedHeapBytes: describe(rows.map((row) => row.heap?.used)),
          initialLongTaskCount: describe(rows.map((row) => row.initialTasks?.length)),
          rendererWorkingSetKiB: describe(
            rows.map((row) =>
              row.initialProfile?.processes
                ?.filter((item) => item.type === 'Tab')
                .reduce((sum, item) => sum + item.memory.workingSetSize, 0)
            )
          ),
          launchMs: describe(rows.map((row) => row.startupMetrics?.launchMs)),
          readyMs: describe(rows.map((row) => row.startupMetrics?.readyMs)),
          longTaskCount: describe(rows.map((row) => row.tasks?.length)),
          longTaskTotalMs: describe(
            rows.map((row) => (row.tasks ?? []).reduce((sum, value) => sum + value, 0))
          )
        }
      ])
    ),
    startup: {
      launchMs: describe(launches.map((row) => row.freshProfileLaunch?.launchMs)),
      readyMs: describe(launches.map((row) => row.freshProfileLaunch?.readyMs)),
      observations: launches
    },
    notMeasured: [
      'OS cold boot',
      'live provider readiness',
      'forced-GC memory release after closing a session',
      'screen-reader behavior',
      'prolonged idle CPU baseline'
    ]
  }
  await fs.writeFile(
    path.join(directory, 'desktop-summary.json'),
    JSON.stringify(report, null, 2) + '\n'
  )
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await summarize(process.argv[2])
