import type { Buffer } from 'node:buffer'
import type { FileHandle } from 'node:fs/promises'
import type { StorageProvider } from '../types'
import { constants, promises as fs } from 'node:fs'
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
    const resolvedPath = resolvePath(this.baseDir, fileName)
    const dir = dirname(resolvedPath)

    // Validate and ensure parent directory exists atomically
    await this.ensureParentDirSafe(dir)

    // Open file with exclusive creation flag to prevent TOCTOU
    // O_CREAT | O_EXCL ensures the file doesn't exist and is created atomically
    let handle: FileHandle | null = null
    try {
      handle = await fs.open(resolvedPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)

      // Verify the opened file is within base directory by checking its realpath
      // Use the resolved path (which we validated the parent of) to verify
      const realPath = await fs.realpath(resolvedPath)
      this.verifyPathWithinBase(realPath)

      // Verify the file descriptor points to the expected file by checking inode
      const handleStats = await handle.stat()
      const realPathStats = await fs.stat(realPath)
      if (handleStats.ino !== realPathStats.ino) {
        throw new Error('Invalid path: inode mismatch detected')
      }

      // Write file using the handle
      await handle.writeFile(file)
      await handle.close()
      handle = null
    } catch (error: any) {
      if (handle) {
        await handle.close().catch(() => {})
      }
      if (error?.code === 'EEXIST') {
        // File already exists, try to overwrite safely
        return this.uploadOverwrite(file, fileName)
      }
      throw error
    }

    return {
      path: fileName,
      url: `${this.publicPath}/${fileName}`
    }
  }

  private async uploadOverwrite(file: Buffer, fileName: string): Promise<{ path: string, url?: string }> {
    const resolvedPath = resolvePath(this.baseDir, fileName)

    // For overwrite, open existing file atomically, then verify
    let handle: FileHandle | null = null
    try {
      // Open file (following symlinks is OK for overwrite)
      handle = await fs.open(resolvedPath, constants.O_WRONLY)

      // Verify the opened file is safe
      const realPath = await fs.realpath(resolvedPath)
      this.verifyPathWithinBase(realPath)

      // Verify inode matches to ensure we opened the expected file
      const handleStats = await handle.stat()
      const realPathStats = await fs.stat(realPath)
      if (handleStats.ino !== realPathStats.ino) {
        throw new Error('Invalid path: inode mismatch detected')
      }

      // Truncate and write
      await handle.truncate(0)
      await handle.writeFile(file)
      await handle.close()
      handle = null
    } catch (error: any) {
      if (handle) {
        await handle.close().catch(() => {})
      }
      throw error
    }

    return {
      path: fileName,
      url: `${this.publicPath}/${fileName}`
    }
  }

  private async ensureParentDirSafe(dir: string): Promise<void> {
    // Validate parent directory path
    const realParent = await fs.realpath(dir).catch(async (error: any) => {
      if (error?.code === 'ENOENT') {
        // Parent doesn't exist, validate the logical path
        this.verifyPathWithinBase(dir)
        // Create parent directories
        await fs.mkdir(dir, { recursive: true })
        // After creation, verify the real path
        const createdRealPath = await fs.realpath(dir)
        this.verifyPathWithinBase(createdRealPath)
        return createdRealPath
      }
      throw error
    })

    this.verifyPathWithinBase(realParent)
  }

  private verifyPathWithinBase(candidate: string): void {
    if (candidate !== this.baseDir && !candidate.startsWith(this.baseDirWithSep)) {
      throw new Error('Invalid path: path traversal detected')
    }
  }

  async getObject(path: string): Promise<{ bytes: Uint8Array, contentType?: string | null, cacheControl?: string | null }> {
    const resolvedPath = resolvePath(this.baseDir, path)

    // Open file atomically first, then verify
    let handle: FileHandle | null = null
    try {
      // Try to open with O_NOFOLLOW first to prevent following symlinks
      try {
        handle = await fs.open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW)
      } catch (error: any) {
        // If O_NOFOLLOW not supported, open normally and verify after
        if (error?.code === 'EOPNOTSUPP' || error?.code === 'ELOOP') {
          handle = await fs.open(resolvedPath, constants.O_RDONLY)
        } else {
          throw error
        }
      }

      // Now verify the opened file is safe
      const realPath = await fs.realpath(resolvedPath)
      this.verifyPathWithinBase(realPath)

      // Verify inode matches to ensure we opened the expected file
      const handleStats = await handle.stat()
      const realPathStats = await fs.stat(realPath)
      if (handleStats.ino !== realPathStats.ino) {
        throw new Error('Invalid path: inode mismatch detected')
      }

      // Read using the handle
      const data = await handle.readFile()
      await handle.close()
      handle = null

      return { bytes: new Uint8Array(data), contentType: null, cacheControl: null }
    } catch (error: any) {
      if (handle) {
        await handle.close().catch(() => {})
      }
      throw error
    }
  }

  async putObject(path: string, bytes: Uint8Array, _contentType: string, _cacheControl?: string): Promise<void> {
    const resolvedPath = resolvePath(this.baseDir, path)
    const dir = dirname(resolvedPath)

    // Validate and ensure parent directory exists atomically
    await this.ensureParentDirSafe(dir)

    // Try exclusive creation first
    let handle: FileHandle | null = null
    try {
      handle = await fs.open(resolvedPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)

      // Verify the opened file is safe
      const realPath = await fs.realpath(resolvedPath)
      this.verifyPathWithinBase(realPath)

      // Verify inode matches
      const handleStats = await handle.stat()
      const realPathStats = await fs.stat(realPath)
      if (handleStats.ino !== realPathStats.ino) {
        throw new Error('Invalid path: inode mismatch detected')
      }

      await handle.writeFile(bytes)
      await handle.close()
      handle = null
    } catch (error: any) {
      if (handle) {
        await handle.close().catch(() => {})
      }
      if (error?.code === 'EEXIST') {
        // File exists, overwrite safely
        await this.putObjectOverwrite(resolvedPath, bytes)
      } else {
        throw error
      }
    }
  }

  private async putObjectOverwrite(resolvedPath: string, bytes: Uint8Array): Promise<void> {
    let handle: FileHandle | null = null
    try {
      // Open file (following symlinks is OK for overwrite)
      handle = await fs.open(resolvedPath, constants.O_WRONLY)

      // Verify the opened file is safe
      const realPath = await fs.realpath(resolvedPath)
      this.verifyPathWithinBase(realPath)

      // Verify inode matches to ensure we opened the expected file
      const handleStats = await handle.stat()
      const realPathStats = await fs.stat(realPath)
      if (handleStats.ino !== realPathStats.ino) {
        throw new Error('Invalid path: inode mismatch detected')
      }

      await handle.truncate(0)
      await handle.writeFile(bytes)
      await handle.close()
      handle = null
    } catch (error: any) {
      if (handle) {
        await handle.close().catch(() => {})
      }
      throw error
    }
  }

  async delete(path: string): Promise<void> {
    const resolvedPath = resolvePath(this.baseDir, path)

    // Open file atomically first, then verify
    let handle: FileHandle | null = null
    try {
      try {
        handle = await fs.open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW)
      } catch (error: any) {
        if (error?.code === 'EOPNOTSUPP' || error?.code === 'ELOOP') {
          handle = await fs.open(resolvedPath, constants.O_RDONLY)
        } else if (error?.code === 'ENOENT') {
          // File doesn't exist, nothing to delete
          return
        } else {
          throw error
        }
      }

      // Verify the opened file is safe
      const realPath = await fs.realpath(resolvedPath)
      this.verifyPathWithinBase(realPath)

      // Verify inode matches
      const handleStats = await handle.stat()
      const realPathStats = await fs.stat(realPath)
      if (handleStats.ino !== realPathStats.ino) {
        throw new Error('Invalid path: inode mismatch detected')
      }

      await handle.close()
      handle = null

      // Now safe to delete
      await fs.unlink(resolvedPath)
    } catch (error: any) {
      if (handle) {
        await handle.close().catch(() => {})
      }
      if ((error as any).code === 'ENOENT') {
        // File doesn't exist, that's fine
        return
      }
      throw error
    }
  }

  getUrl(path: string): string {
    return `${this.publicPath}/${path}`
  }

  async exists(path: string): Promise<boolean> {
    const resolvedPath = resolvePath(this.baseDir, path)

    try {
      // Validate path
      const realPath = await fs.realpath(resolvedPath)
      this.verifyPathWithinBase(realPath)

      // Check access using the validated path
      await fs.access(realPath)
      return true
    } catch {
      return false
    }
  }
}
