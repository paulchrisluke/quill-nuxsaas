import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalStorageProvider } from '~~/server/services/file/storage/local'

// Set storage provider to local to avoid R2 config validation during test setup
process.env.NUXT_APP_STORAGE = 'local'

describe('localStorageProvider', () => {
  let testBaseDir: string
  let storage: LocalStorageProvider

  beforeAll(async () => {
    // Create a temporary directory for testing
    testBaseDir = await fs.mkdtemp(join(tmpdir(), 'local-storage-test-'))
    storage = new LocalStorageProvider(testBaseDir, '/uploads')
  })

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testBaseDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('delete', () => {
    it('should delete a regular file successfully', async () => {
      const fileName = 'test-file.txt'
      const filePath = join(testBaseDir, fileName)

      // Create a test file
      await fs.writeFile(filePath, 'test content')

      // Verify file exists
      await expect(fs.access(filePath)).resolves.toBeUndefined()

      // Delete the file
      await expect(storage.delete(fileName)).resolves.toBeUndefined()

      // Verify file is deleted
      await expect(fs.access(filePath)).rejects.toThrow()
    })

    it('should reject deletion of symlinks with clear error message', async () => {
      const fileName = 'symlink-target.txt'
      const symlinkName = 'symlink.txt'
      const targetPath = join(testBaseDir, fileName)
      const symlinkPath = join(testBaseDir, symlinkName)

      // Create a target file
      await fs.writeFile(targetPath, 'target content')

      // Create a symlink pointing to the target
      await fs.symlink(fileName, symlinkPath)

      // Verify symlink exists
      await expect(fs.access(symlinkPath)).resolves.toBeUndefined()

      // Attempt to delete the symlink - should throw error
      await expect(storage.delete(symlinkName)).rejects.toThrow(
        'Invalid path: symlink detected - security violation. Cannot delete symlinks.'
      )

      // Verify symlink still exists
      await expect(fs.access(symlinkPath)).resolves.toBeUndefined()

      // Clean up
      await fs.unlink(symlinkPath)
      await fs.unlink(targetPath)
    })

    it('should handle non-existent files gracefully', async () => {
      // Delete a non-existent file - should not throw
      await expect(storage.delete('non-existent-file.txt')).resolves.toBeUndefined()
    })

    it('should reject symlinks even if they point to valid files within base', async () => {
      const fileName = 'valid-target.txt'
      const symlinkName = 'valid-symlink.txt'
      const targetPath = join(testBaseDir, fileName)
      const symlinkPath = join(testBaseDir, symlinkName)

      // Create a target file within the base directory
      await fs.writeFile(targetPath, 'valid target')

      // Create a symlink pointing to the valid target
      await fs.symlink(fileName, symlinkPath)

      // Attempt to delete the symlink - should still reject it
      await expect(storage.delete(symlinkName)).rejects.toThrow(
        'Invalid path: symlink detected - security violation. Cannot delete symlinks.'
      )

      // Verify both symlink and target still exist
      await expect(fs.access(symlinkPath)).resolves.toBeUndefined()
      await expect(fs.access(targetPath)).resolves.toBeUndefined()

      // Clean up
      await fs.unlink(symlinkPath)
      await fs.unlink(targetPath)
    })
  })
})
