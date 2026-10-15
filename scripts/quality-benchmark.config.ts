import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, '../src/shared') } },
  test: {
    environment: 'node',
    include: ['benchmarks/quality.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 300000
  }
})
