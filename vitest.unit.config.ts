import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, valid } from 'semver'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('./', import.meta.url))

/**
 * Resolves the entry point for a pnpm dependency by finding the newest version.
 * Handles semver pre-release identifiers, build metadata, and numeric parts per semver rules.
 *
 * Note: This function uses synchronous I/O at module load time, which is necessary
 * for Vitest config initialization. The pnpm directory format assumption may be
 * fragile if pnpm changes its internal structure.
 */
const resolvePnpmDepEntry = (packageName: string, entryRelativePath: string): string | null => {
  try {
    const pnpmDir = join(rootDir, 'node_modules/.pnpm')
    const prefix = `${packageName}@`

    // Check if pnpm directory exists
    if (!existsSync(pnpmDir)) {
      console.warn(`[vitest.unit.config] pnpm directory not found: ${pnpmDir}`)
      return null
    }

    const entries = readdirSync(pnpmDir)
      .filter(name => name.startsWith(prefix))
      .map((name) => {
        // Extract version from "packageName@version" format
        // Handle pnpm patterns like "version_peerDep@peerVersion" by taking only the primary version
        const raw = name.slice(prefix.length)
        const version = raw.split('_')[0]
        return { name, version }
      })
      .filter(({ version }) => {
        // Filter out invalid semver versions
        // semver.valid returns null for invalid versions
        return valid(version) !== null
      })
      .sort((a, b) => compare(b.version, a.version)) // Sort descending (newest first) using semver.compare
      .map(entry => entry.name)

    if (entries.length === 0) {
      console.warn(`[vitest.unit.config] No pnpm entries found for package: ${packageName}`)
      return null
    }

    // Take the first match (newest version)
    const match = entries[0]
    const resolvedPath = join(pnpmDir, match, 'node_modules', packageName, entryRelativePath)

    if (!existsSync(resolvedPath)) {
      console.warn(`[vitest.unit.config] Resolved path does not exist: ${resolvedPath}`)
      return null
    }

    return resolvedPath
  } catch (error) {
    console.warn(`[vitest.unit.config] Failed to resolve pnpm dependency entry for ${packageName}:`, error)
    return null
  }
}

const h3Entry = resolvePnpmDepEntry('h3', 'dist/index.mjs')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~~\//, replacement: `${rootDir}/` },
      { find: /^~\//, replacement: `${rootDir}/` },
      ...(h3Entry ? [{ find: /^h3$/, replacement: h3Entry }] : [])
    ]
  },
  test: {
    environment: 'node',
    testTimeout: 30000,
    include: ['tests/unit/**/*.test.ts']
  }
})
