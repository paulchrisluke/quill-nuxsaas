import type { Buffer } from 'node:buffer'

export interface StorageProvider {
  name: string
  upload: (file: Buffer, fileName: string, mimeType: string) => Promise<{ path: string, url?: string }>
  getObject: (path: string) => Promise<{ bytes: Uint8Array, contentType?: string | null, cacheControl?: string | null }>
  putObject: (path: string, bytes: Uint8Array, contentType: string, cacheControl?: string) => Promise<void>
  delete: (path: string) => Promise<void>
  getUrl: (path: string) => string
  exists: (path: string) => Promise<boolean>
}

export type StorageProviderType = 'local' | 'r2'

export interface FileManagerConfig {
  storage: {
    provider: StorageProviderType
    local?: {
      uploadDir: string
      publicPath: string
    }
    r2?: {
      accountId: string
      accessKeyId: string
      secretAccessKey: string
      bucketName: string
      publicUrl?: string
    }
  }
  maxFileSize?: number
  allowedMimeTypes?: string[]
  image?: {
    sizes?: number[]
    formats?: Array<'webp' | 'avif'>
    quality?: number
    maxProxyWidth?: number
    enableProxy?: boolean
    requireAltText?: boolean
    altTextPlaceholder?: string
  }
  uploadRateLimit?: {
    maxUploadsPerWindow: number // Maximum number of uploads allowed per window
    windowSizeMinutes: number // Size of the time window in minutes
  }
}
