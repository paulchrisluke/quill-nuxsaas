import type { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { defineVitestConfig } from '@nuxt/test-utils/config'

const require = createRequire(import.meta.url)
const crypto = require('node:crypto')

if (typeof crypto.hash !== 'function') {
  crypto.hash = (algorithm: string, data: string | Buffer) =>
    crypto.createHash(algorithm).update(data).digest('hex')
}

export default defineVitestConfig({
  test: {
    testTimeout: 30000,
    environment: 'nuxt',
    environmentOptions: {
      nuxt: {
        domEnvironment: 'happy-dom',
        overrides: {
        }
      }
    },
    coverage: {
      reporter: ['html'],
      reportsDirectory: '../tests/coverage'
    },
    setupFiles: './tests/setup.ts'
  }
})
