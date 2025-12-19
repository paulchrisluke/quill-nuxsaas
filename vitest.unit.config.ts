import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('./', import.meta.url))

const resolvePnpmDepEntry = (packageName: string, entryRelativePath: string) => {
  try {
    const pnpmDir = join(rootDir, 'node_modules/.pnpm')
    const entries = readdirSync(pnpmDir)
      .filter(name => name.startsWith(`${packageName}@`))
      .sort()
    const match = entries[0]
    if (!match) {
      return null
    }
    return join(pnpmDir, match, 'node_modules', packageName, entryRelativePath)
  } catch {
    return null
  }
}

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~~\//, replacement: `${rootDir}` },
      { find: /^~\//, replacement: `${rootDir}` },
      ...(resolvePnpmDepEntry('h3', 'dist/index.mjs')
        ? [{ find: /^h3$/, replacement: resolvePnpmDepEntry('h3', 'dist/index.mjs')! }]
        : [])
    ]
  },
  test: {
    environment: 'node',
    testTimeout: 30000,
    include: ['tests/unit/**/*.test.ts']
  }
})
