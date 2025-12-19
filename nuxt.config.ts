// https://nuxt.com/docs/api/configuration/nuxt-config
import type { NuxtPage } from 'nuxt/schema'
import type { Plugin } from 'rollup'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineNuxtConfig } from 'nuxt/config'
import { generateRuntimeConfig } from './server/utils/runtimeConfig'

console.log(`Current NODE_ENV: ${process.env.NODE_ENV}`)

const effectiveNitroPreset = (process.env.NODE_ENV === 'development' && !process.env.NUXT_FORCE_CLOUDFLARE_DEV)
  ? 'node-server'
  : (process.env.NUXT_NITRO_PRESET || 'node-server')

// Custom Rollup plugin to handle problematic relative imports in jsquash packages
function jsquashResolvePlugin(): Plugin {
  return {
    name: 'jsquash-resolve',
    resolveId(source, importer) {
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
        } catch {
          // If we can't resolve, return null to let other plugins handle it
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
        } catch {
          // Fall through
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
