import type { NitroRuntimeConfig } from 'nitropack/types'
import type { FileManagerConfig, StorageProviderType } from '~~/server/services/file/types'
import { config } from 'dotenv'

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    fileManager: FileManagerConfig
  }
}

let runtimeConfigInstance: NitroRuntimeConfig

const parseNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const parseCommaList = (value: string | undefined) => {
  return (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

const clampQuality = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(100, Math.max(1, parsed))
}

const clampMaxProxyWidth = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(4000, parsed)
}

export const generateRuntimeConfig = () => ({
  preset: (process.env.NODE_ENV === 'development')
    ? 'node-server'
    : process.env.NUXT_NITRO_PRESET,
  betterAuthSecret: process.env.NUXT_BETTER_AUTH_SECRET,
  betterAuthTrustedOrigins: process.env.NUXT_BETTER_AUTH_TRUSTED_ORIGINS,
  // Stripe
  stripeSecretKey: process.env.NUXT_STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.NUXT_STRIPE_WEBHOOK_SECRET,

  // Resend
  resendApiKey: process.env.NUXT_RESEND_API_KEY,
  // Github
  githubClientId: process.env.NUXT_GH_CLIENT_ID,
  githubClientSecret: process.env.NUXT_GH_CLIENT_SECRET,
  // Google
  googleClientId: process.env.NUXT_GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.NUXT_GOOGLE_CLIENT_SECRET,
  // AI / LLM
  openAiApiKey: process.env.NUXT_OPENAI_API_KEY,
  openAiBlogModel: process.env.NUXT_OPENAI_BLOG_MODEL || 'gpt-4o-mini',
  openAiBlogTemperature: Number(process.env.NUXT_OPENAI_BLOG_TEMPERATURE) || 0.6,
  openAiBlogMaxOutputTokens: Number(process.env.NUXT_OPENAI_BLOG_MAX_OUTPUT_TOKENS) || 2200,
  cfAiGatewayToken: process.env.NUXT_CF_AI_GATEWAY_TOKEN,
  cfAiGatewayName: process.env.NUXT_CF_AI_GATEWAY_NAME || 'quill',
  cfAccountId: process.env.NUXT_CF_ACCOUNT_ID,

  // Google Maps
  googleMapsApiKey: process.env.NUXT_GOOGLE_MAPS_API_KEY,
  // DB
  redisUrl: process.env.NUXT_REDIS_URL,
  databaseUrl: process.env.DATABASE_URL,
  // File
  fileManager: {
    storage: {
      provider: process.env.NUXT_APP_STORAGE as StorageProviderType || 'r2',
      local: { // provider: 'local'
        uploadDir: process.env.NUXT_LOCAL_UPLOAD_DIR || './uploads',
        publicPath: process.env.NUXT_LOCAL_PUBLIC_PATH || '/uploads'
      },
      r2: { // provider: 'r2'
        accountId: process.env.NUXT_CF_ACCOUNT_ID!,
        accessKeyId: process.env.NUXT_CF_ACCESS_KEY_ID!,
        secretAccessKey: process.env.NUXT_CF_SECRET_ACCESS_KEY!,
        bucketName: process.env.NUXT_CF_R2_BUCKET_NAME!,
        publicUrl: process.env.NUXT_CF_R2_PUBLIC_URL!
      }
    },
    maxFileSize: parseNumber(process.env.NUXT_FILE_MAX_SIZE, 10 * 1024 * 1024),
    allowedMimeTypes: (() => {
      const parsed = parseCommaList(process.env.NUXT_FILE_ALLOWED_MIME_TYPES)
      if (parsed.length > 0) {
        return parsed
      }
      return [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/avif',
        'image/gif',
        'image/svg+xml',
        'application/pdf',
        'text/plain'
      ]
    })(),
    image: (() => {
      const parsedSizes = parseCommaList(process.env.NUXT_FILE_IMAGE_SIZES)
        .map(value => Number.parseInt(value, 10))
        .filter(size => Number.isFinite(size) && size > 0)
        .sort((a, b) => a - b)
      const normalizedSizes = parsedSizes.length > 0 ? parsedSizes : [150, 400, 800, 1200, 1600]

      const parsedFormats = parseCommaList(process.env.NUXT_FILE_IMAGE_FORMATS)
      const validFormats = parsedFormats.filter((format): format is 'webp' | 'avif' => format === 'webp' || format === 'avif')
      const normalizedFormats = (validFormats.length > 0 ? validFormats : ['webp']) as Array<'webp' | 'avif'>

      return {
        sizes: normalizedSizes,
        formats: normalizedFormats,
        quality: clampQuality(process.env.NUXT_FILE_IMAGE_QUALITY, 80),
        maxProxyWidth: clampMaxProxyWidth(process.env.NUXT_FILE_IMAGE_MAX_PROXY_WIDTH, 2000),
        enableProxy: process.env.NUXT_FILE_IMAGE_ENABLE_PROXY !== 'false',
        requireAltText: process.env.NUXT_FILE_REQUIRE_ALT_TEXT === 'true',
        altTextPlaceholder: process.env.NUXT_FILE_IMAGE_ALT_PLACEHOLDER || 'TODO: describe image'
      }
    })(),
    uploadRateLimit: {
      maxUploadsPerWindow: 100,
      windowSizeMinutes: 1
    }
  } satisfies FileManagerConfig,
  public: {
    baseURL: process.env.NUXT_APP_URL,
    appName: process.env.NUXT_APP_NAME,
    appEnv: process.env.NODE_ENV,
    appRepo: process.env.NUXT_APP_REPO,
    appNotifyEmail: process.env.NUXT_APP_NOTIFY_EMAIL,
    appContactEmail: process.env.NUXT_APP_CONTACT_EMAIL,
    googleMapsApiKeyPublic: process.env.NUXT_GOOGLE_MAPS_API_KEY_PUBLIC,
    payment: process.env.NUXT_PAYMENT || 'stripe',
    auth: {
      redirectUserTo: '/',
      redirectGuestTo: '/signin'
    }
  }
})

if (typeof useRuntimeConfig !== 'undefined') {
  runtimeConfigInstance = useRuntimeConfig() as NitroRuntimeConfig
} else {
  // for cli: npm run auth:schema
  config()
  runtimeConfigInstance = { nitro: {}, ...generateRuntimeConfig() } as NitroRuntimeConfig
}

export const runtimeConfig = runtimeConfigInstance
