import { describe, expect, it } from 'vitest'
import type { DiagnosticsReport } from '@shared/ipc/api-types'
import { formatDiagnosticsReport } from './diagnostics-service'

describe('diagnostics report sanitization', () => {
  it('redacts secret fields, credentials in text, and the absolute home path', () => {
    const report = {
      system: { homeDir: '/Users/alice' },
      storage: { config: { path: '/Users/alice/.pi/agent' } },
      apiKey: 'sk-live-plaintext-secret',
      nested: { message: 'Authorization: Bearer plain-token' }
    } as unknown as DiagnosticsReport

    const text = formatDiagnosticsReport(report, '/Users/alice')

    expect(text).not.toContain('/Users/alice')
    expect(text).not.toContain('sk-live-plaintext-secret')
    expect(text).not.toContain('plain-token')
    expect(text).toContain('~/.pi/agent')
  })
})
