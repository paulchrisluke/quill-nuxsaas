import type { FileManagerConfig, StorageProvider } from '../types'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { LocalStorageProvider } from './local'
import { R2StorageProvider } from './r2'

const ensureR2Config = (config: NonNullable<FileManagerConfig['storage']['r2']>) => {
  const missing: string[] = []
  if (!config.accountId)
    missing.push('NUXT_CF_ACCOUNT_ID')
  if (!config.accessKeyId)
    missing.push('NUXT_CF_ACCESS_KEY_ID')
  if (!config.secretAccessKey)
    missing.push('NUXT_CF_SECRET_ACCESS_KEY')
  if (!config.bucketName)
    missing.push('NUXT_CF_R2_BUCKET_NAME')
  // Note: publicUrl is optional - if not provided, getUrl() will fall back to r2.dev URL
  if (missing.length > 0) {
    throw new Error(`Missing R2 configuration values: ${missing.join(', ')}`)
  }
}

export async function createStorageProvider(config: FileManagerConfig['storage']): Promise<StorageProvider> {
  switch (config.provider) {
    case 'local':
      if (!config.local) {
        throw new Error('Local storage configuration is required')
      }
      if (runtimeConfig.preset === 'cloudflare-module') {
        throw new Error('Local storage is not supported on Cloudflare Workers. Please switch to R2.')
      }
      return new LocalStorageProvider(config.local.uploadDir, config.local.publicPath)

    case 'r2':
      if (!config.r2) {
        throw new Error('R2 storage configuration is required')
      }
      ensureR2Config(config.r2)
      return new R2StorageProvider({
        provider: 'r2',
        ...config.r2
      })

    default:
      throw new Error(`Unsupported storage provider: ${config.provider}`)
  }
}
