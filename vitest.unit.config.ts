import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('./', import.meta.url))

/**
 * Simple semver comparison function for sorting version strings.
 * Compares semantic versions correctly (e.g., "1.10.0" > "1.9.0").
 */
const compareVersions = (a: string, b: string): number => {
  const parseVersion = (version: string): number[] => {
    return version.split('.').map(Number.parseInt).filter(Number.isFinite)
  }

  const versionA = parseVersion(a)
  const versionB = parseVersion(b)
  const maxLength = Math.max(versionA.length, versionB.length)

  for (let i = 0; i < maxLength; i++) {
    const partA = versionA[i] ?? 0
    const partB = versionB[i] ?? 0
    if (partA !== partB) {
      return partA - partB
    }
  }

  return 0
}

const resolvePnpmDepEntry = (packageName: string, entryRelativePath: string) => {
  try {
    const pnpmDir = join(rootDir, 'node_modules/.pnpm')
    const prefix = `${packageName}@`
    const entries = readdirSync(pnpmDir)
      .filter(name => name.startsWith(prefix))
      .map((name) => {
        // Extract version from "packageName@version" format
        // Handle pnpm patterns like "version_peerDep@peerVersion" by taking only the primary version
        const raw = name.slice(prefix.length)
        const version = raw.split('_')[0]
        return { name, version }
      })
      .sort((a, b) => compareVersions(b.version, a.version)) // Sort descending (newest first)
      .map(entry => entry.name)

    if (entries.length === 0) {
      return null
    }

    // Take the first match (newest version)
    const match = entries[0]
    return join(pnpmDir, match, 'node_modules', packageName, entryRelativePath)
  } catch {
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
