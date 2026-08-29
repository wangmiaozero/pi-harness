import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import path from 'node:path'
import { FileConflictError, FileSystemError, ValidationError } from '../services/errors'
import type { FileAccessService } from './file-access-service'
import type { FilePreview, FileTreeEntry } from '@shared/types/workspace'
import {
  AUDIO_PREVIEW_MAX_BYTES,
  DOCX_PREVIEW_MAX_BYTES,
  FILE_UPLOAD_MAX_BYTES,
  IMAGE_PREVIEW_MAX_BYTES,
  PDF_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  TEXT_EDIT_MAX_BYTES,
  documentPreviewKind,
  getAudioMime,
  getImageMime,
  getLanguage
} from '@shared/workspace/file-types'

export class FileService {
  constructor(private readonly access: FileAccessService) {}

  async list(directory: string): Promise<FileTreeEntry[]> {
    const realDir = await this.access.assertAllowed(directory, { mustExist: true })
    const st = await stat(realDir)
    if (!st.isDirectory()) throw new FileSystemError('Not a directory', { directory })

    const dirents = await readdir(realDir, { withFileTypes: true })
    const entries: FileTreeEntry[] = []
    for (const dirent of dirents) {
      const fullPath = path.join(realDir, dirent.name)
      let isDirectory = dirent.isDirectory()
      if (!isDirectory && !dirent.isFile()) {
        try {
          isDirectory = (await stat(fullPath)).isDirectory()
        } catch {
          continue
        }
      }
      entries.push({ name: dirent.name, path: fullPath, isDirectory })
    }
    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async readPreview(filePath: string): Promise<FilePreview> {
    const realPath = await this.access.assertAllowed(filePath, { mustExist: true })
    const st = await stat(realPath)
    if (!st.isFile()) throw new FileSystemError('Not a file', { filePath })
    const name = path.basename(realPath)
    const imageMime = getImageMime(realPath)
    const audioMime = getAudioMime(realPath)
    const docKind = documentPreviewKind(realPath)

    if (imageMime) {
      if (st.size > IMAGE_PREVIEW_MAX_BYTES) {
        return { kind: 'binary', path: realPath, name, size: st.size, mime: imageMime }
      }
      const buf = await readFile(realPath)
      return {
        kind: 'image',
        path: realPath,
        name,
        size: st.size,
        mime: imageMime,
        base64: buf.toString('base64')
      }
    }

    if (audioMime) {
      if (st.size > AUDIO_PREVIEW_MAX_BYTES) {
        return { kind: 'binary', path: realPath, name, size: st.size, mime: audioMime }
      }
      const buf = await readFile(realPath)
      return {
        kind: 'audio',
        path: realPath,
        name,
        size: st.size,
        mime: audioMime,
        base64: buf.toString('base64')
      }
    }

    if (docKind === 'pdf') {
      if (st.size > PDF_PREVIEW_MAX_BYTES) {
        return { kind: 'binary', path: realPath, name, size: st.size, mime: 'application/pdf' }
      }
      const buf = await readFile(realPath)
      return {
        kind: 'pdf',
        path: realPath,
        name,
        size: st.size,
        mime: 'application/pdf',
        base64: buf.toString('base64')
      }
    }

    if (docKind === 'docx') {
      const text = await extractDocxText(realPath, st.size)
      return {
        kind: 'docx',
        path: realPath,
        name,
        size: st.size,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        text,
        truncated: st.size > DOCX_PREVIEW_MAX_BYTES
      }
    }

    if (st.size > TEXT_PREVIEW_MAX_BYTES) {
      const slice = await readTextPrefix(realPath, st.size).catch(() => '')
      return {
        kind: looksBinary(Buffer.from(slice)) ? 'binary' : 'text',
        path: realPath,
        name,
        size: st.size,
        language: getLanguage(realPath),
        text: slice,
        truncated: true
      }
    }

    const buf = await readFile(realPath)
    if (looksBinary(buf)) {
      return { kind: 'binary', path: realPath, name, size: st.size }
    }
    return {
      kind: 'text',
      path: realPath,
      name,
      size: st.size,
      language: getLanguage(realPath),
      text: buf.toString('utf8'),
      revision: contentRevision(buf)
    }
  }

  async writeText(
    filePath: string,
    text: string,
    expectedRevision: string,
    overwrite = false
  ): Promise<{ path: string; size: number; revision: string }> {
    const next = Buffer.from(text, 'utf8')
    if (next.byteLength > TEXT_EDIT_MAX_BYTES) {
      throw new ValidationError('Edited file exceeds 2 MB')
    }

    const realPath = await this.access.assertWritable(filePath, { mustExist: true })
    if ((await lstat(filePath)).isSymbolicLink()) {
      throw new ValidationError('Refusing to edit a symbolic link', { filePath })
    }
    const flags = fsConstants.O_RDWR | (fsConstants.O_NOFOLLOW ?? 0)
    let handle
    try {
      handle = await open(realPath, flags)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new ValidationError('Refusing to edit a symbolic link', { filePath })
      }
      throw error
    }

    try {
      const opened = await handle.stat()
      if (!opened.isFile()) throw new ValidationError('Edit target is not a file', { filePath })
      if (opened.size > TEXT_EDIT_MAX_BYTES) {
        throw new ValidationError('Edited file exceeds 2 MB')
      }
      const current = await handle.readFile()
      if (looksBinary(current)) throw new ValidationError('Binary files cannot be edited')
      const currentRevision = contentRevision(current)
      if (!overwrite && currentRevision !== expectedRevision) {
        throw new FileConflictError('File changed externally since it was opened', {
          path: realPath,
          expectedRevision,
          currentRevision
        })
      }

      if (next.byteLength > 0) await handle.write(next, 0, next.byteLength, 0)
      await handle.truncate(next.byteLength)
      await handle.sync()
      return {
        path: realPath,
        size: next.byteLength,
        revision: contentRevision(next)
      }
    } finally {
      await handle.close()
    }
  }

  async upload(
    directory: string,
    fileName: string,
    dataBase64: string,
    overwrite = false
  ): Promise<{ path: string }> {
    if (
      !fileName ||
      fileName.length > 255 ||
      fileName === '.' ||
      fileName === '..' ||
      fileName.includes('/') ||
      fileName.includes('\\') ||
      fileName.includes('\0')
    ) {
      throw new ValidationError('Invalid upload file name', { fileName })
    }
    const requestedTarget = path.join(directory, fileName)
    await this.access.assertWritable(requestedTarget)
    const realDir = await this.access.assertWritable(directory, { mustExist: true })
    const target = path.join(realDir, fileName)
    const buf = Buffer.from(dataBase64, 'base64')
    if (buf.byteLength > FILE_UPLOAD_MAX_BYTES) {
      throw new ValidationError('Upload exceeds 25 MB')
    }
    await mkdir(realDir, { recursive: true })
    if (!overwrite) {
      try {
        await writeFile(target, buf, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new ValidationError('File already exists', { fileName })
        }
        throw error
      }
      return { path: target }
    }

    try {
      const targetStat = await lstat(target)
      if (targetStat.isSymbolicLink()) {
        throw new ValidationError('Refusing to overwrite a symbolic link', { fileName })
      }
      if (!targetStat.isFile()) {
        throw new ValidationError('Upload target is not a file', { fileName })
      }
      await this.access.assertWritable(requestedTarget, { mustExist: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_TRUNC |
      (fsConstants.O_NOFOLLOW ?? 0) |
      (fsConstants.O_NONBLOCK ?? 0)
    let handle
    try {
      handle = await open(target, flags, 0o666)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new ValidationError('Refusing to overwrite a symbolic link', { fileName })
      }
      throw error
    }
    try {
      const opened = await handle.stat()
      if (!opened.isFile()) throw new ValidationError('Upload target is not a file', { fileName })
      await handle.writeFile(buf)
    } finally {
      await handle.close()
    }
    return { path: target }
  }
}

async function readTextPrefix(filePath: string, size: number): Promise<string> {
  const maxBytes = Math.min(size, TEXT_PREVIEW_MAX_BYTES * 4)
  const buf = Buffer.allocUnsafe(maxBytes)
  const handle = await open(filePath, 'r')
  try {
    let offset = 0
    while (offset < maxBytes) {
      const { bytesRead } = await handle.read(buf, offset, maxBytes - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return buf.subarray(0, offset).toString('utf8').slice(0, TEXT_PREVIEW_MAX_BYTES)
  } finally {
    await handle.close()
  }
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8000))
  return sample.includes(0)
}

function contentRevision(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function extractDocxText(filePath: string, size: number): Promise<string> {
  if (size > DOCX_PREVIEW_MAX_BYTES) {
    return '[DOCX too large to preview]'
  }
  try {
    const buf = await readFile(filePath)
    const xml = extractZipEntry(buf, 'word/document.xml')
    if (!xml) return '[DOCX has no document.xml]'
    return xml
      .replace(/<w:p[^>]*>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim()
  } catch {
    return '[Unable to extract DOCX text]'
  }
}

/** Minimal ZIP local-file extractor for a single stored/deflated entry. */
function extractZipEntry(buf: Buffer, entryName: string): string | null {
  const nameBytes = Buffer.from(entryName, 'utf8')
  let offset = 0
  while (offset + 30 < buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break
    const method = buf.readUInt16LE(offset + 8)
    const compressedSize = buf.readUInt32LE(offset + 18)
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8')
    const dataStart = offset + 30 + nameLen + extraLen
    const dataEnd = dataStart + compressedSize
    if (name === entryName || nameBytes.equals(buf.subarray(offset + 30, offset + 30 + nameLen))) {
      const data = buf.subarray(dataStart, dataEnd)
      if (method === 0) return data.toString('utf8')
      if (method === 8) {
        return inflateRawSync(data, { maxOutputLength: DOCX_PREVIEW_MAX_BYTES }).toString('utf8')
      }
      return null
    }
    offset = dataEnd
  }
  return null
}
