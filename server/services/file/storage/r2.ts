import type { Buffer } from 'node:buffer'
import type { StorageProvider } from '../types'
import { AwsClient } from 'aws4fetch'

export class R2StorageProvider implements StorageProvider {
  name = ''
  private client: AwsClient | null = null
  private bucketName: string
  private publicUrl?: string
  private config: {
    provider: 'r2'
    accountId?: string
    accessKeyId: string
    secretAccessKey: string
    bucketName: string
    publicUrl?: string
  }

  private endpoint = ''

  constructor(config: {
    provider: 'r2'
    accountId?: string
    accessKeyId: string
    secretAccessKey: string
    bucketName: string
    publicUrl?: string
  }) {
    this.bucketName = config.bucketName
    this.publicUrl = config.publicUrl
    this.config = config
    this.name = 'r2'
  }

  private initializeClient() {
    if (this.client) {
      return
    }

    if (!this.config.accountId) {
      throw new Error('Account ID is required for R2 storage')
    }
    this.endpoint = `https://${this.config.accountId}.r2.cloudflarestorage.com`
    const region = 'auto'

    this.client = new AwsClient({
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region,
      service: 's3'
    })
  }

  private ensureInitialized() {
    if (!this.client) {
      this.initializeClient()
    }
  }

  private encodePath(path: string): string {
    // Split path by '/', encode each segment, then join back with '/'
    return path.split('/').map(segment => encodeURIComponent(segment)).join('/')
  }

  private async getErrorDetails(response: Response): Promise<string> {
    try {
      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength === 0) {
        return ''
      }

      // Try to decode as UTF-8 text
      try {
        const decoder = new TextDecoder('utf-8', { fatal: false })
        const text = decoder.decode(arrayBuffer)
        const trimmed = text.trim()
        return trimmed ? ` - ${trimmed.substring(0, 500)}` : ` - [${arrayBuffer.byteLength} bytes]`
      } catch {
        // If text decoding fails, return byte length
        return ` - [${arrayBuffer.byteLength} bytes]`
      }
    } catch {
      return ''
    }
  }

  async upload(file: Buffer, fileName: string, mimeType: string): Promise<{ path: string, url?: string }> {
    this.ensureInitialized()

    const encodedPath = this.encodePath(fileName)
    const url = `${this.endpoint}/${this.bucketName}/${encodedPath}`

    const response = await this.client!.fetch(url, {
      method: 'PUT',
      body: new Uint8Array(file),
      headers: {
        'Content-Type': mimeType
      }
    })

    if (!response.ok) {
      const errorDetails = await this.getErrorDetails(response)
      throw new Error(`Upload failed: ${response.status} ${response.statusText}${errorDetails}`)
    }

    // Consume response body on success to release connection
    await response.arrayBuffer()

    return {
      path: fileName,
      url: this.publicUrl ? `${this.publicUrl}/${encodedPath}` : undefined
    }
  }

  async getObject(path: string): Promise<{ bytes: Uint8Array, contentType?: string | null, cacheControl?: string | null }> {
    this.ensureInitialized()

    const encodedPath = this.encodePath(path)
    const url = `${this.endpoint}/${this.bucketName}/${encodedPath}`
    const response = await this.client!.fetch(url)

    if (!response.ok) {
      const errorDetails = await this.getErrorDetails(response)
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}${errorDetails}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return {
      bytes: new Uint8Array(arrayBuffer),
      contentType: response.headers.get('Content-Type'),
      cacheControl: response.headers.get('Cache-Control')
    }
  }

  async putObject(path: string, bytes: Uint8Array, contentType: string, cacheControl?: string): Promise<void> {
    this.ensureInitialized()

    const encodedPath = this.encodePath(path)
    const url = `${this.endpoint}/${this.bucketName}/${encodedPath}`

    const response = await this.client!.fetch(url, {
      method: 'PUT',
      body: bytes as BodyInit,
      headers: {
        'Content-Type': contentType,
        ...(cacheControl ? { 'Cache-Control': cacheControl } : {})
      }
    })

    if (!response.ok) {
      const errorDetails = await this.getErrorDetails(response)
      throw new Error(`Upload failed: ${response.status} ${response.statusText}${errorDetails}`)
    }

    // Consume response body on success to release connection
    await response.arrayBuffer()
  }

  async delete(path: string): Promise<void> {
    this.ensureInitialized()

    const encodedPath = this.encodePath(path)
    const url = `${this.endpoint}/${this.bucketName}/${encodedPath}`

    const response = await this.client!.fetch(url, {
      method: 'DELETE'
    })

    if (!response.ok && response.status !== 404) {
      const errorDetails = await this.getErrorDetails(response)
      throw new Error(`Delete failed: ${response.status} ${response.statusText}${errorDetails}`)
    }

    // Consume response body on success to release connection
    await response.arrayBuffer()
  }

  getUrl(path: string): string {
    // Encode the path to handle spaces, unicode, and special characters
    const encodedPath = this.encodePath(path).replace(/^\//, '') // Strip leading slash

    if (this.publicUrl) {
      // Ensure publicUrl doesn't have a trailing slash, then append encoded path
      const baseUrl = this.publicUrl.replace(/\/$/, '')
      return `${baseUrl}/${encodedPath}`
    }

    // Fallback to r2.dev URL with encoded path
    return `https://${this.bucketName}.r2.dev/${encodedPath}`
  }

  async exists(path: string): Promise<boolean> {
    this.ensureInitialized()

    try {
      const encodedPath = this.encodePath(path)
      const url = `${this.endpoint}/${this.bucketName}/${encodedPath}`

      const response = await this.client!.fetch(url, {
        method: 'HEAD'
      })

      return response.ok
    } catch {
      return false
    }
  }
}
