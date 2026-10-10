import { parentPort, workerData } from 'node:worker_threads'
import { scanSources, safeCode, type ScanRequest } from './scanner'

const controller = new AbortController()
parentPort?.on('message', (message) => {
  if (message === 'cancel') controller.abort()
})
void scanSources(workerData as ScanRequest, controller.signal, (status) =>
  parentPort?.postMessage({ type: 'progress', status })
)
  .then((result) => parentPort?.postMessage({ type: 'complete', result }))
  .catch((error) =>
    parentPort?.postMessage({
      type: 'error',
      code: controller.signal.aborted ? 'CANCELLED' : safeCode(error)
    })
  )
  .finally(() => parentPort?.close())
