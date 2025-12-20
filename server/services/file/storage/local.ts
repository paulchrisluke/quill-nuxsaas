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
    const filePath = await this.resolvePathSafe(fileName)
    const dir = dirname(filePath)

    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, file)

    return {
      path: fileName,
      url: `${this.publicPath}/${fileName}`
    }
  }

  private async resolvePathSafe(path: string) {
    const resolvedPath = resolvePath(this.baseDir, path)
    const isWithinBase = (candidate: string) => candidate === this.baseDir || candidate.startsWith(this.baseDirWithSep)
    const verifyOrThrow = (candidate: string) => {
      if (!isWithinBase(candidate)) {
        throw new Error('Invalid path: path traversal detected')
      }
      return candidate
    }

    try {
      const realPath = await fs.realpath(resolvedPath)
      return verifyOrThrow(realPath)
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        // Verify parent directory's real path to prevent symlink attacks
        const parentDir = dirname(resolvedPath)
        try {
          const realParent = await fs.realpath(parentDir)
          verifyOrThrow(realParent)
        } catch (parentError: any) {
          // Parent doesn't exist either - verify logical path only
          if (parentError?.code !== 'ENOENT') {
            throw parentError
          }
        }
        return verifyOrThrow(resolvedPath)
      }
      throw error
    }
  }

  async getObject(path: string): Promise<{ bytes: Uint8Array, contentType?: string | null, cacheControl?: string | null }> {
    const filePath = await this.resolvePathSafe(path)
    const data = await fs.readFile(filePath)
    return { bytes: new Uint8Array(data), contentType: null, cacheControl: null }
  }

  async putObject(path: string, bytes: Uint8Array, _contentType: string, _cacheControl?: string): Promise<void> {
    const filePath = await this.resolvePathSafe(path)
    const dir = dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, bytes)
  }

  async delete(path: string): Promise<void> {
    const filePath = await this.resolvePathSafe(path)
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
      const filePath = await this.resolvePathSafe(path)
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
