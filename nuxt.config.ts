// https://nuxt.com/docs/api/configuration/nuxt-config
import type { NuxtPage } from 'nuxt/schema'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineNuxtConfig } from 'nuxt/config'
import { generateRuntimeConfig } from './server/utils/runtimeConfig'

// Minimal Rollup plugin interface for type safety
interface RollupPlugin {
  name: string
  resolveId?: (source: string, importer: string | undefined) => string | null | undefined
}

console.log(`Current NODE_ENV: ${process.env.NODE_ENV}`)

const effectiveNitroPreset = (process.env.NODE_ENV === 'development' && !process.env.NUXT_FORCE_CLOUDFLARE_DEV)
  ? 'node-server'
  : (process.env.NUXT_NITRO_PRESET || 'node-server')

/**
 * Custom Rollup plugin to work around @jsquash relative import and WASM incompatibilities
 * when bundling for Cloudflare Workers.
 *
 * Problem: @jsquash packages use relative imports (e.g., "../../.." from workerHelpers.js)
 * and WASM files that don't resolve correctly during bundling for Cloudflare Workers.
 *
 * Solution: This plugin intercepts problematic imports and resolves them to the correct
 * filesystem paths based on the expected @jsquash package layout:
 * - workerHelpers.js references "../../.." to reach the package root
 * - Package root contains main .js files (excluding workerHelpers.js, .wasm, .d.ts)
 * - @jsquash/png uses bare "meta" imports that should resolve to "./meta.js"
 *
 * Expected package structure:
 *   @jsquash/png/
 *     ├── index.js (or similar main entry)
 *     ├── meta.js
 *     ├── workerHelpers.js
 *     └── ...
 */
function jsquashResolvePlugin(): RollupPlugin {
  return {
    name: 'jsquash-resolve',
    resolveId(source: string, importer: string | undefined) {
      if (!importer?.includes('@jsquash')) {
        return null
      }

      // Handle the problematic "../../.." import from workerHelpers.js
      if (source === '../../..') {
        const importerDir = dirname(importer)
        const pkgDir = resolve(importerDir, '../../..')

        try {
          if (existsSync(pkgDir)) {
            const files = readdirSync(pkgDir)
            const mainFile = files.find((f: string) =>
              f.endsWith('.js') &&
              !f.includes('workerHelpers') &&
              !f.includes('bg.wasm') &&
              !f.endsWith('.d.ts')
            )
            if (mainFile) {
              return resolve(pkgDir, mainFile)
            }
          }
        } catch (error) {
          console.warn('[jsquash-resolve] Failed to resolve "../../.." import:', {
            importer,
            source,
            error: error instanceof Error ? error.message : String(error)
          })
          return null
        }
      }

      // Handle bare module imports like "meta" that should resolve to "./meta.js"
      if (source === 'meta' && importer?.includes('@jsquash/png')) {
        const importerDir = dirname(importer)
        const metaPath = resolve(importerDir, './meta.js')
        try {
          if (existsSync(metaPath)) {
            return metaPath
          }
        } catch (error) {
          console.warn('[jsquash-resolve] Failed to resolve "meta" import:', {
            importer,
            source,
            error: error instanceof Error ? error.message : String(error)
          })
          return null
        }
      }

      return null
    }
  }
}

export default defineNuxtConfig({
  compatibilityDate: '2025-12-10',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: [
    '@nuxt/ui',
    '@nuxtjs/mdc',
    '@nuxt/eslint',
    '@nuxtjs/i18n',
    '@nuxtjs/seo',
    ...(process.env.NODE_ENV === 'test' ? ['@nuxt/test-utils/module'] : []),
    ...(process.env.NODE_ENV === 'test' ? [] : ['@nuxthub/core'])
  ],
  mdc: {
    highlight: {}
  },
  hub: {
    db: 'postgresql',
    kv: true,
    blob: true
  },
  i18n: {
    vueI18n: '~/i18n/i18n.config.ts',
    baseUrl: process.env.NUXT_APP_URL,
    locales: [
      { code: 'en', language: 'en-US', name: 'English' },
      { code: 'zh-CN', language: 'zh-CN', name: '简体中文' },
      { code: 'ja', language: 'ja-JP', name: '日本語' },
      { code: 'fr', language: 'fr-FR', name: 'Français' }
    ],
    defaultLocale: 'en',
    bundle: {
      optimizeTranslationDirective: false
    }
  },
  sitemap: {
    exclude: [
      '/admin/**',
      '/403',
      '/profile'
    ]
  },
  seo: {
    canonicalLowercase: false
  },
  robots: {
    disallow: [
      '/admin',
      '/profile'
    ]
  },
  eslint: {
    config: {
      standalone: false
    }
  },
  ogImage: {
    enabled: false
  },
  icon: {
    serverBundle: false,
    clientBundle: {
      scan: {
        globInclude: ['**\/*.{vue,jsx,tsx,md,mdc,mdx}', 'app/**/*.ts']
      }
    }
  },
  hooks: {
    'pages:extend': function (pages) {
      const pagesToRemove: NuxtPage[] = []
      pages.forEach((page) => {
        if (page.path.includes('component') || page.path.includes('/api')) {
          pagesToRemove.push(page)
        }
      })

      pagesToRemove.forEach((page: NuxtPage) => {
        pages.splice(pages.indexOf(page), 1)
      })
    }
  },
  runtimeConfig: generateRuntimeConfig(),
  app: {
    head: {
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1, maximum-scale=5.0, minimum-scale=1.0',
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicons/favicon-96x96.png', sizes: '96x96' },
        { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/favicons/apple-touch-icon.png' },
        { rel: 'manifest', href: '/favicons/site.webmanifest' }
      ],
      meta: [
        { name: 'apple-mobile-web-app-title', content: process.env.NUXT_APP_NAME }
      ]
    }
  },
  nitro: {
    preset: effectiveNitroPreset,
    ...(effectiveNitroPreset === 'cloudflare-module'
      ? {
          cloudflare: {
            deployConfig: true,
            nodeCompat: true
          }
        }
      : {}),
    rollupConfig: {
      external: effectiveNitroPreset != 'node-server' ? ['pg-native'] : undefined,
      plugins: effectiveNitroPreset === 'cloudflare-module' ? [jsquashResolvePlugin()] : undefined
    },
    esbuild: {
      options: {
        jsx: 'automatic',
        jsxImportSource: 'react'
      }
    },
    publicAssets: process.env.NUXT_APP_STORAGE === 'local'
      ? [{
          dir: resolve(process.env.NUXT_LOCAL_UPLOAD_DIR || './uploads'),
          baseURL: process.env.NUXT_LOCAL_PUBLIC_PATH || '/uploads'
        }]
      : undefined
  },
  sourcemap: {
    server: false,
    client: false
  },
  $production: {
    build: {
      transpile: ['zod']
    }
  }
}) as any
