import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PET_PROTOCOL_HOST,
  PET_PROTOCOL_SCHEME,
  findExistingPetResource,
  installPetProtocolHandler,
  registerPetProtocolScheme,
  resolvePetResourcePath
} from './protocol'
import { createPackDir } from './test-fixtures'

const protocolMocks = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  handle: vi.fn()
}))
vi.mock('electron', () => ({ protocol: protocolMocks }))

const USER_ROOT = path.resolve('/tmp/pet-user')
const BUNDLED_ROOT = path.resolve('/tmp/pet-bundled')
const ROOTS = [USER_ROOT, BUNDLED_ROOT]

function url(rest: string): string {
  return `${PET_PROTOCOL_SCHEME}://${PET_PROTOCOL_HOST}/${rest}`
}

describe('resolvePetResourcePath', () => {
  it('maps pack-relative URLs onto the first root in order (user first)', () => {
    expect(resolvePetResourcePath(ROOTS, url('mypack/clips/idle/idle_001.webp'))).toBe(
      path.join(USER_ROOT, 'mypack', 'clips', 'idle', 'idle_001.webp')
    )
  })

  it('supports the flat clip layout (no clips/ prefix)', () => {
    expect(resolvePetResourcePath(ROOTS, url('mypack/idle/idle_001.webp'))).toBe(
      path.join(USER_ROOT, 'mypack', 'idle', 'idle_001.webp')
    )
  })

  it('resolves two-segment preview URLs inside the pack root', () => {
    expect(resolvePetResourcePath(ROOTS, url('mypack/preview.png'))).toBe(
      path.join(USER_ROOT, 'mypack', 'preview.png')
    )
  })

  it('rejects traversal segments and hostile pack ids', () => {
    expect(resolvePetResourcePath(ROOTS, url('mypack/../../etc/passwd'))).toBeNull()
    expect(resolvePetResourcePath(ROOTS, url('../etc/passwd'))).toBeNull()
    expect(resolvePetResourcePath(ROOTS, url('pack%2F..%2F..%2Fx/a.webp'))).toBeNull()
    expect(resolvePetResourcePath(ROOTS, url('my pack/a.webp'))).toBeNull()
  })

  it('rejects malformed or unexpected URLs', () => {
    expect(resolvePetResourcePath(ROOTS, 'not a url')).toBeNull()
    expect(resolvePetResourcePath(ROOTS, 'https://evil.example/mypack/a.webp')).toBeNull()
    expect(resolvePetResourcePath(ROOTS, url('mypack'))).toBeNull()
    expect(resolvePetResourcePath(ROOTS, url('mypack/a/b/c/d.webp'))).toBeNull()
  })

  it('contains URL-normalized traversal attempts inside the pack root', () => {
    // The WHATWG URL parser collapses dot segments before we ever see them,
    // so ../ traversal can only normalize away, never escape.
    const resolved = resolvePetResourcePath(ROOTS, url('mypack/idle/../evil.webp'))
    expect(resolved).not.toBeNull()
    expect(resolved!.startsWith(USER_ROOT + path.sep)).toBe(true)
    expect(resolved).toBe(path.join(USER_ROOT, 'mypack', 'evil.webp'))
  })

  it('maps positionally; the existence-aware layer decides who serves', () => {
    expect(resolvePetResourcePath(ROOTS, url('nowhere/a.webp'))).toBe(
      path.join(USER_ROOT, 'nowhere', 'a.webp')
    )
    expect(resolvePetResourcePath([], url('mypack/a.webp'))).toBeNull()
  })
})

describe('findExistingPetResource', () => {
  let tmpRoot: string
  let userRoot: string
  let bundledRoot: string

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petproto-test-'))
    userRoot = path.join(tmpRoot, 'user')
    bundledRoot = path.join(tmpRoot, 'bundled')
    await fs.mkdir(userRoot, { recursive: true })
    await fs.mkdir(bundledRoot, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('prefers the user pack and falls through to the bundled pack', async () => {
    await createPackDir(userRoot, { id: 'dupe', useClipsLayout: false })
    await createPackDir(bundledRoot, { id: 'dupe', useClipsLayout: false })
    const roots = [userRoot, bundledRoot]
    const fromUser = await findExistingPetResource(roots, url('dupe/idle/idle_001.webp'))
    expect(fromUser).toBe(path.join(userRoot, 'dupe', 'idle', 'idle_001.webp'))

    // User copy loses its frame: bundled copy serves instead.
    await fs.rm(path.join(userRoot, 'dupe', 'idle', 'idle_001.webp'))
    const fromBundled = await findExistingPetResource(roots, url('dupe/idle/idle_001.webp'))
    expect(fromBundled).toBe(path.join(bundledRoot, 'dupe', 'idle', 'idle_001.webp'))

    // Missing everywhere → null.
    expect(await findExistingPetResource(roots, url('dupe/idle/idle_999.webp'))).toBeNull()
  })

  it('returns null for invalid URLs regardless of roots', async () => {
    expect(await findExistingPetResource([userRoot, bundledRoot], 'not a url')).toBeNull()
    expect(await findExistingPetResource([userRoot, bundledRoot], url('mypack/manifest.json'))).toBeNull()
  })
})

describe('pet protocol CORS support (click-through hit-testing)', () => {
  beforeEach(() => {
    protocolMocks.registerSchemesAsPrivileged.mockClear()
    protocolMocks.handle.mockClear()
  })

  it('registers the scheme with corsEnabled so frame canvases stay un-tainted', () => {
    registerPetProtocolScheme()
    expect(protocolMocks.registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
    const schemes = protocolMocks.registerSchemesAsPrivileged.mock.calls[0][0] as Array<{
      scheme: string
      privileges: Record<string, unknown>
    }>
    expect(Array.isArray(schemes)).toBe(true)
    const arg = schemes[0]
    expect(arg.scheme).toBe(PET_PROTOCOL_SCHEME)
    expect(arg.privileges.corsEnabled).toBe(true)
  })

  it('serves frames with access-control-allow-origin so alphaAt can read pixels', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petproto-cors-'))
    try {
      await createPackDir(tmpRoot, { id: 'corspack', useClipsLayout: false })
      installPetProtocolHandler([tmpRoot])
      expect(protocolMocks.handle).toHaveBeenCalledTimes(1)
      const handler = protocolMocks.handle.mock.calls[0][1] as (
        request: { url: string }
      ) => Promise<Response>
      const response = await handler({ url: url('corspack/idle/idle_001.webp') })
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })
})
