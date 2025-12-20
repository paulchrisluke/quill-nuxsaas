type DecoderInput = ArrayBuffer | ArrayBufferView | string | null | undefined

const normalizeEncoding = (encoding: string | undefined) => {
  const value = (encoding || 'utf-8').toLowerCase()
  if (value === 'utf8')
    return 'utf-8'
  if (value === 'utf16le' || value === 'ucs2')
    return 'utf-16le'
  if (value === 'latin1' || value === 'binary')
    return 'iso-8859-1'
  return value
}

const toUint8Array = (input: DecoderInput) => {
  if (input == null) {
    return new Uint8Array()
  }
  if (typeof input === 'string') {
    return null
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input)
  }
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
}

export class StringDecoder {
  private readonly decoder: TextDecoder

  constructor(encoding?: string) {
    const normalized = normalizeEncoding(encoding)
    this.decoder = new TextDecoder(normalized)
  }

  write(input?: DecoderInput): string {
    if (typeof input === 'string') {
      return input
    }
    const bytes = toUint8Array(input)
    if (!bytes || bytes.length === 0) {
      return ''
    }
    return this.decoder.decode(bytes, { stream: true })
  }

  end(input?: DecoderInput): string {
    const chunk = this.write(input)
    return chunk + this.decoder.decode()
  }
}

export default {
  StringDecoder
}
