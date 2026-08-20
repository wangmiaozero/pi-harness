import { describe, expect, it } from 'vitest'
import packageJson from '../../../package.json'
import { APP_VERSION } from './index'

describe('application version', () => {
  it('matches the package and installer version', () => {
    expect(APP_VERSION).toBe(packageJson.version)
  })
})
