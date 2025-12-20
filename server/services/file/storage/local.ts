import type { Buffer } from 'node:buffer'
import type { FileHandle } from 'node:fs/promises'
import type { StorageProvider } from '../types'
import { constants, promises as fs } from 'node:fs'
import { dirname, resolve as resolvePath, sep } from 'node:path'

export class LocalStorageProvider implements StorageProvider {
  name = 'local'
  private baseDir: string
  private baseDirWithSep: string
  private baseDirRealPath: string | null = null
  private baseDirRealPathWithSep: string | null = null
  private publicPath: string

  constructor(uploadDir: string, publicPath: string) {
    this.baseDir = resolvePath(uploadDir)
    this.baseDirWithSep = this.baseDir.endsWith(sep) ? this.baseDir : `${this.baseDir}${sep}`
    this.publicPath = publicPath
  }

  private async getBaseDirRealPath(): Promise<string> {
    if (this.baseDirRealPath === null) {
      try {
        this.baseDirRealPath = await fs.realpath(this.baseDir)
        this.baseDirRealPathWithSep = this.baseDirRealPath.endsWith(sep) ? this.baseDirRealPath : `${this.baseDirRealPath}${sep}`
      } catch {
        // If baseDir doesn't exist yet, use the original path
        // It will be validated when the directory is created
        this.baseDirRealPath = this.baseDir
        this.baseDirRealPathWithSep = this.baseDirWithSep
      }
    }
    return this.baseDirRealPath
  }

  private async getBaseDirRealPathWithSep(): Promise<string> {
    await this.getBaseDirRealPath()
    return this.baseDirRealPathWithSep!
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
      await this.verifyPathWithinBase(realPath)

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
      await this.verifyPathWithinBase(realPath)

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
        await this.verifyPathWithinBase(dir)
        // Create parent directories
        await fs.mkdir(dir, { recursive: true })
        // Immediately after creation, check for symlink race condition
        const createdStats = await fs.lstat(dir)
        if (createdStats.isSymbolicLink()) {
          throw new Error('Invalid path: symlink detected after directory creation - security violation')
        }
        // After creation, verify the real path
        const createdRealPath = await fs.realpath(dir)
        await this.verifyPathWithinBase(createdRealPath)
        return createdRealPath
      }
      throw error
    })

    // For existing paths, also check for symlinks
    const existingStats = await fs.lstat(dir)
    if (existingStats.isSymbolicLink()) {
      throw new Error('Invalid path: symlink detected - security violation')
    }

    await this.verifyPathWithinBase(realParent)
  }

  private async verifyPathWithinBase(candidate: string): Promise<void> {
    // Compare against both the original baseDir and its realpath
    // This handles cases where the baseDir path contains symlinks (e.g., /var -> /private/var on macOS)
    const baseDirRealPath = await this.getBaseDirRealPath()
    const baseDirRealPathWithSep = await this.getBaseDirRealPathWithSep()

    const isWithinOriginal = candidate === this.baseDir || candidate.startsWith(this.baseDirWithSep)
    const isWithinRealPath = candidate === baseDirRealPath || candidate.startsWith(baseDirRealPathWithSep)

    if (!isWithinOriginal && !isWithinRealPath) {
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
        // ELOOP indicates a symlink was encountered - this is a security error
        if (error?.code === 'ELOOP') {
          throw new Error('Invalid path: symlink detected - security violation')
        }
        // Check for multiple error codes that indicate O_NOFOLLOW is unsupported
        // Different platforms may return different error codes
        if (error?.code === 'EOPNOTSUPP' || error?.code === 'EINVAL' || error?.code === 'ENOTSUP') {
          // O_NOFOLLOW not supported on this platform - perform symlink check manually
          const stats = await fs.lstat(resolvedPath)
          if (stats.isSymbolicLink()) {
            throw new Error('Invalid path: symlink detected - security violation')
          }
          // Safe to open without O_NOFOLLOW since we've verified it's not a symlink
          handle = await fs.open(resolvedPath, constants.O_RDONLY)
        } else {
          throw error
        }
      }

      // Now verify the opened file is safe
      const realPath = await fs.realpath(resolvedPath)
      await this.verifyPathWithinBase(realPath)

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
      await this.verifyPathWithinBase(realPath)

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
      await this.verifyPathWithinBase(realPath)

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

    // First check if the original path exists
    // Use lstat (not stat) to avoid following symlinks
    try {
      await fs.lstat(resolvedPath)
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        // File doesn't exist, that's fine
        return
      }
      throw error
    }

    // Resolve the actual filesystem path (following symlinks) for safety validation
    const realPath = await fs.realpath(resolvedPath).catch(async (error: any) => {
      if (error?.code === 'ENOENT') {
        // File doesn't exist, that's fine
        return null
      }
      throw error
    })

    // If file doesn't exist, we're done
    if (realPath === null) {
      return
    }

    // Validate the canonical path is within base to ensure the target is safe
    await this.verifyPathWithinBase(realPath)

    // Unlink the original resolvedPath (the user-specified path) so symlinks are removed, not their targets
    try {
      await fs.unlink(resolvedPath)
    } catch (error: any) {
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
      await this.verifyPathWithinBase(realPath)

      // Check access using the validated path
      await fs.access(realPath)
      return true
    } catch {
      return false
    }
  }
}
