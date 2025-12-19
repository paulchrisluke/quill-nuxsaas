import type { Buffer } from 'node:buffer'
import type { StorageProvider } from '../types'
import { AwsClient } from 'aws4fetch'

export class S3CompatibleStorageProvider implements StorageProvider {
  name = ''
  private client: AwsClient | null = null
  private bucketName: string
  private publicUrl?: string
  private provider: 's3' | 'r2'
  private config: any
  private endpoint = ''

  constructor(config: {
    provider: 's3' | 'r2'
    region?: string
    accountId?: string
    accessKeyId: string
    secretAccessKey: string
    bucketName: string
    publicUrl?: string
    endpoint?: string
  }) {
    this.provider = config.provider
    this.bucketName = config.bucketName
    this.publicUrl = config.publicUrl
    this.config = config
    if (this.provider === 'r2') {
      this.name = 's3-r2'
    } else if (this.provider === 's3') {
      this.name = 's3'
    } else {
      this.name = 's3-compatible'
    }
  }

  private initializeClient() {
    if (this.client) {
      return
    }

    let region: string

    if (this.config.provider === 'r2') {
      if (!this.config.accountId) {
        throw new Error('Account ID is required for R2 storage')
      }
      this.endpoint = `https://${this.config.accountId}.r2.cloudflarestorage.com`
      region = 'auto'
    } else {
      this.endpoint = this.config.endpoint || 'https://s3.amazonaws.com'
      region = this.config.region || 'us-east-1'
    }

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
      const text = await response.text()
      return text ? ` - ${text.substring(0, 500)}` : ''
    } catch {
      try {
        const arrayBuffer = await response.arrayBuffer()
        return arrayBuffer.byteLength > 0 ? ` - [${arrayBuffer.byteLength} bytes]` : ''
      } catch {
        return ''
      }
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
      url: this.publicUrl ? `${this.publicUrl}/${fileName}` : undefined
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
    if (this.publicUrl) {
      return `${this.publicUrl}/${path}`
    }

    if (this.provider === 'r2') {
      return `https://${this.bucketName}.r2.dev/${path}`
    }

    return `https://${this.bucketName}.s3.amazonaws.com/${path}`
  }

  async exists(path: string): Promise<boolean> {
    this.ensureInitialized()

    try {
      const encodedPath = this.encodePath(path)
      const url = `${this.endpoint}/${this.bucketName}/${encodedPath}`

      const response = await this.client!.fetch(url, {
        method: 'HEAD'
      })

      // Consume response body to release connection
      await response.arrayBuffer()

      return response.ok
    } catch {
      return false
    }
  }
}
