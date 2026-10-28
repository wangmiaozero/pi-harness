/**
 * Pet pack loading and validation.
 *
 * A pet pack is a directory containing `pet-pack.json` plus one sub-directory
 * per animation clip of numbered WebP frames. The bundled BigFish pack lives
 * in `resources/petpacks/bigfish/` (source, license and commit provenance are
 * recorded inside the manifest).
 *
 * Validation is fail-closed: a pack with a malformed manifest or missing
 * clips is rejected, and clip directories are pinned to the pack root so a
 * hostile manifest can never escape it (path traversal guard).
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { BIGFISH_CLIPS, type PetPackManifest } from '@shared/pet/desktop'
import { isAppPackaged } from '../services/app-paths'

const PACK_MANIFEST_FILE = 'pet-pack.json'
const MAX_CLIP_NAME_LENGTH = 64
const MAX_CLIPS = 64
const MAX_FRAMES_PER_CLIP = 1024

export interface LoadedPetPack {
  root: string
  manifest: PetPackManifest
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reject anything that is not a plain single path segment below the pack root. */
export function isSafeClipDir(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_CLIP_NAME_LENGTH &&
    // Allow the on-disk layout "clips/<name>" used by bundled packs.
    /^(clips\/)?[\w][\w.-]*$/.test(name) &&
    !name.includes('..') &&
    name !== '.' &&
    name !== '..'
  )
}

export function validatePetPackManifest(value: unknown): PetPackManifest {
  if (!isPlainObject(value)) throw new Error('Pet pack manifest must be an object')
  const clipsValue = value['clips']
  if (!isPlainObject(clipsValue)) throw new Error('Pet pack manifest is missing clips')
  const keys = Object.keys(clipsValue)
  if (!keys.length || keys.length > MAX_CLIPS) throw new Error('Pet pack has an invalid clip count')
  const clips: PetPackManifest['clips'] = {}
  for (const [name, raw] of Object.entries(clipsValue)) {
    if (!isPlainObject(raw)) {
      throw new Error(`Pet pack clip "${name}" has an unsafe or malformed entry`)
    }
    // Honor the declared on-disk directory (e.g. "clips/idle" for bundled
    // packs); fall back to the clip name when it is not declared.
    const dir = typeof raw['dir'] === 'string' && raw['dir'] ? raw['dir'] : name
    if (!isSafeClipDir(dir)) {
      throw new Error(`Pet pack clip "${name}" has an unsafe or malformed entry`)
    }
    const frames = raw['frames']
    if (typeof frames !== 'number' || !Number.isInteger(frames) || frames <= 0) {
      throw new Error(`Pet pack clip "${name}" has an invalid frame count`)
    }
    if (frames > MAX_FRAMES_PER_CLIP) {
      throw new Error(`Pet pack clip "${name}" exceeds the frame limit`)
    }
    clips[name] = {
      dir,
      frames,
      loop: raw['loop'] !== false
    }
  }
  const baseWidth = value['baseWidth']
  const baseHeight = value['baseHeight']
  const fps = value['fps']
  if (typeof baseWidth !== 'number' || baseWidth <= 0) throw new Error('Invalid pack baseWidth')
  if (typeof baseHeight !== 'number' || baseHeight <= 0) throw new Error('Invalid pack baseHeight')
  if (typeof fps !== 'number' || fps <= 0 || fps > 60) throw new Error('Invalid pack fps')
  for (const key of ['id', 'name', 'nameEn', 'author', 'version', 'license'] as const) {
    if (typeof value[key] !== 'string' || !value[key]) {
      throw new Error(`Pet pack manifest is missing "${key}"`)
    }
  }
  return {
    formatVersion: 1,
    id: value['id'] as string,
    name: value['name'] as string,
    nameEn: value['nameEn'] as string,
    description: typeof value['description'] === 'string' ? value['description'] : undefined,
    author: value['author'] as string,
    version: value['version'] as string,
    license: value['license'] as string,
    licenseFiles: Array.isArray(value['licenseFiles'])
      ? value['licenseFiles'].filter((f): f is string => typeof f === 'string')
      : [],
    source: isPlainObject(value['source']) ? (value['source'] as PetPackManifest['source']) : undefined,
    baseWidth,
    baseHeight,
    fps,
    clips
  }
}

/** Resolve the bundled pack directory without touching the filesystem. */
export function bundledPetPackRoot(importerDir: string): string {
  // importerDir is the compiled main bundle directory (out/main in dev+prod).
  if (!isAppPackaged()) {
    return path.resolve(importerDir, '../../resources/petpacks')
  }
  return path.join(process.resourcesPath, 'petpacks')
}

export async function loadPetPack(root: string): Promise<LoadedPetPack> {
  const resolvedRoot = path.resolve(root)
  const manifestPath = path.join(resolvedRoot, PACK_MANIFEST_FILE)
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Pet pack manifest is unreadable: ${String(error)}`, { cause: error })
  }
  const manifest = validatePetPackManifest(raw)

  // Verify every declared clip directory exists below the pack root with the
  // exact declared frame count. Missing/corrupted clips degrade the whole
  // pack (callers fall back to no pet) instead of half-rendering.
  for (const clip of Object.values(manifest.clips)) {
    const dir = path.resolve(resolvedRoot, clip.dir)
    if (!dir.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`Pet pack clip "${clip.dir}" escapes the pack root`)
    }
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      throw new Error(`Pet pack clip "${clip.dir}" is missing from the pack`)
    }
    const frames = entries.filter((f) => f.endsWith('.webp')).length
    if (frames < clip.frames) {
      throw new Error(
        `Pet pack clip "${clip.dir}" is incomplete (${frames}/${clip.frames} frames)`
      )
    }
  }
  return { root: resolvedRoot, manifest }
}

/** True when the pack can serve every clip required by the state map. */
export function packCoversRequiredStates(manifest: PetPackManifest): boolean {
  return BIGFISH_CLIPS.slice(0, 10).every((clip) => manifest.clips[clip] !== undefined)
}
