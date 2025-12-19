import type { Buffer } from 'node:buffer'
import type { StorageProvider } from '../types'
import { promises as fs } from 'node:fs'
import { dirname, resolve as resolvePath, sep } from 'node:path'

export class LocalStorageProvider implements StorageProvider {
  name = 'local'
  private baseDir: string
  private baseDirWithSep: string
  private publicPath: string

  constructor(uploadDir: string, publicPath: string) {
    this.baseDir = resolvePath(uploadDir)
    this.baseDirWithSep = this.baseDir.endsWith(sep) ? this.baseDir : `${this.baseDir}${sep}`
    this.publicPath = publicPath
  }

  async upload(file: Buffer, fileName: string, _mimeType: string): Promise<{ path: string, url?: string }> {
    const filePath = this.resolvePathSafe(fileName)
    const dir = dirname(filePath)

    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, file)

    return {
      path: fileName,
      url: `${this.publicPath}/${fileName}`
    }
  }

  private resolvePathSafe(path: string) {
    const resolvedPath = resolvePath(this.baseDir, path)
    if (resolvedPath === this.baseDir || resolvedPath.startsWith(this.baseDirWithSep)) {
      return resolvedPath
    }
    throw new Error('Invalid path: path traversal detected')
  }

  async getObject(path: string): Promise<{ bytes: Uint8Array, contentType?: string | null, cacheControl?: string | null }> {
    const filePath = this.resolvePathSafe(path)
    const data = await fs.readFile(filePath)
    return { bytes: new Uint8Array(data), contentType: null, cacheControl: null }
  }

  async putObject(path: string, bytes: Uint8Array, _contentType: string, _cacheControl?: string): Promise<void> {
    const filePath = this.resolvePathSafe(path)
    const dir = dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, bytes)
  }

  async delete(path: string): Promise<void> {
    const filePath = this.resolvePathSafe(path)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        throw error
      }
    }
  }

  getUrl(path: string): string {
    return `${this.publicPath}/${path}`
  }

  async exists(path: string): Promise<boolean> {
    try {
      const filePath = this.resolvePathSafe(path)
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
