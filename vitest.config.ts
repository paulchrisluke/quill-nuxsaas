import type { Buffer, BufferEncoding } from 'node:buffer'
import { createRequire } from 'node:module'
import { defineVitestConfig } from '@nuxt/test-utils/config'

const require = createRequire(import.meta.url)
const crypto = require('node:crypto')

if (typeof crypto.hash !== 'function') {
  crypto.hash = (
    algorithm: string,
    data: string | Buffer | ArrayBuffer | ArrayBufferView,
    outputEncoding?: BufferEncoding
  ) => {
    const normalizedData = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const hash = crypto.createHash(algorithm).update(normalizedData)
    return outputEncoding ? hash.digest(outputEncoding) : hash.digest()
  }
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
