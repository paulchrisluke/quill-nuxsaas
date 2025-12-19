import type { ImageDataLike, ImageVariantMap } from './imageTypes'
import { decode as decodeAvif, encode as encodeAvif } from '@jsquash/avif'
import { decode as decodeJpeg } from '@jsquash/jpeg'
import { decode as decodePng } from '@jsquash/png'
import resize from '@jsquash/resize'
import { decode as decodeWebp, encode as encodeWebp } from '@jsquash/webp'
import { and, eq } from 'drizzle-orm'
import { file as fileTable } from '~~/server/db/schema'
import { useDB } from '~~/server/utils/db'
import { useFileManagerConfig } from './fileService'
import { createStorageProvider } from './storage/factory'

const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable'

const SUPPORTED_MIME_DECODERS = new Map<string, (bytes: Uint8Array) => Promise<ImageDataLike>>([
  ['image/jpeg', decodeJpeg],
  ['image/png', decodePng],
  ['image/webp', decodeWebp],
  ['image/avif', decodeAvif]
])

const SUPPORTED_OUTPUT_FORMATS = new Set(['webp', 'avif'])

const toUint8Array = (input: Uint8Array | ArrayBuffer) => {
  return input instanceof Uint8Array ? input : new Uint8Array(input)
}

const toBase64 = (bytes: Uint8Array) => {
  if (typeof btoa === 'function') {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }
  throw new Error('Base64 encoding not supported in this runtime.')
}

const buildVariantPath = (path: string, width: number, format: string) => {
  const lastSlash = path.lastIndexOf('/')
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : ''
  const fileName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path
  const baseName = fileName.replace(/\.[^/.]+$/, '')
  const basePath = dir ? `${dir}/${baseName}` : baseName
  return `${basePath}/__v/${width}.${format}`
}

const clampQuality = (value: number | undefined) => {
  if (!Number.isFinite(value)) {
    return 80
  }
  return Math.min(100, Math.max(30, value ?? 80))
}

const calculateSize = (width: number, height: number, targetWidth: number) => {
  const ratio = targetWidth / width
  return {
    width: targetWidth,
    height: Math.max(1, Math.round(height * ratio))
  }
}

const encodeVariant = async (format: string, image: ImageDataLike, quality: number) => {
  if (format === 'webp') {
    return await encodeWebp(image, { quality })
  }
  if (format === 'avif') {
    return await encodeAvif(image, { quality })
  }
  throw new Error(`Unsupported output format: ${format}`)
}

const getExifOrientation = (bytes: Uint8Array): number | null => {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
    return null
  }

  let offset = 2
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xFF) {
      break
    }
    const marker = bytes[offset + 1]
    offset += 2
    if (marker === 0xDA) {
      break
    }
    if (marker === 0xE1) {
      if (offset + 1 >= bytes.length) {
        break
      }
      const length = (bytes[offset] << 8) + bytes[offset + 1]
      const segmentStart = offset + 2
      const segmentEnd = segmentStart + length - 2
      if (segmentEnd > bytes.length) {
        break
      }
      if (
        bytes[segmentStart] === 0x45
        && bytes[segmentStart + 1] === 0x78
        && bytes[segmentStart + 2] === 0x69
        && bytes[segmentStart + 3] === 0x66
      ) {
        const tiffOffset = segmentStart + 6
        const littleEndian = bytes[tiffOffset] === 0x49 && bytes[tiffOffset + 1] === 0x49
        const getShort = (index: number) => {
          return littleEndian
            ? bytes[index] + (bytes[index + 1] << 8)
            : (bytes[index] << 8) + bytes[index + 1]
        }
        const getLong = (index: number) => {
          return littleEndian
            ? (bytes[index]) + (bytes[index + 1] << 8) + (bytes[index + 2] << 16) + (bytes[index + 3] << 24)
            : (bytes[index] << 24) + (bytes[index + 1] << 16) + (bytes[index + 2] << 8) + bytes[index + 3]
        }
        const firstIFDOffset = getLong(tiffOffset + 4)
        if (!firstIFDOffset) {
          return null
        }
        const ifdStart = tiffOffset + firstIFDOffset
        if (ifdStart + 2 > bytes.length) {
          return null
        }
        const entries = getShort(ifdStart)
        for (let i = 0; i < entries; i++) {
          const entryOffset = ifdStart + 2 + i * 12
          if (entryOffset + 12 > bytes.length) {
            break
          }
          const tag = getShort(entryOffset)
          if (tag === 0x0112) {
            const value = getShort(entryOffset + 8)
            return value || null
          }
        }
      }
      offset = segmentEnd
      continue
    }

    if (offset + 1 >= bytes.length) {
      break
    }
    const size = (bytes[offset] << 8) + bytes[offset + 1]
    offset += size
  }

  return null
}

const applyExifOrientation = (image: ImageDataLike, orientation: number | null): ImageDataLike => {
  if (!orientation || orientation === 1) {
    return image
  }

  const { width, height, data } = image
  const swapDimensions = orientation >= 5 && orientation <= 8
  const outputWidth = swapDimensions ? height : width
  const outputHeight = swapDimensions ? width : height
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4)

  const setPixel = (x: number, y: number, idx: number) => {
    const outIndex = (y * outputWidth + x) * 4
    output[outIndex] = data[idx]
    output[outIndex + 1] = data[idx + 1]
    output[outIndex + 2] = data[idx + 2]
    output[outIndex + 3] = data[idx + 3]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      let newX = x
      let newY = y
      switch (orientation) {
        case 2:
          newX = width - 1 - x
          newY = y
          break
        case 3:
          newX = width - 1 - x
          newY = height - 1 - y
          break
        case 4:
          newX = x
          newY = height - 1 - y
          break
        case 5:
          newX = y
          newY = x
          break
        case 6:
          newX = height - 1 - y
          newY = x
          break
        case 7:
          newX = height - 1 - y
          newY = width - 1 - x
          break
        case 8:
          newX = y
          newY = width - 1 - x
          break
        default:
          newX = x
          newY = y
          break
      }
      setPixel(newX, newY, idx)
    }
  }

  return {
    width: outputWidth,
    height: outputHeight,
    data: output
  }
}

const extractSvgDimensions = (svg: string) => {
  const widthMatch = svg.match(/width=["']?([0-9.]+)(?:px)?["']?/i)
  const heightMatch = svg.match(/height=["']?([0-9.]+)(?:px)?["']?/i)
  const width = widthMatch ? Number.parseFloat(widthMatch[1]) : null
  const height = heightMatch ? Number.parseFloat(heightMatch[1]) : null
  if (width && height) {
    return { width, height }
  }
  const viewBoxMatch = svg.match(/viewBox=["']?\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*["']?/i)
  if (viewBoxMatch) {
    const viewWidth = Number.parseFloat(viewBoxMatch[3])
    const viewHeight = Number.parseFloat(viewBoxMatch[4])
    if (Number.isFinite(viewWidth) && Number.isFinite(viewHeight)) {
      return { width: viewWidth, height: viewHeight }
    }
  }
  return { width: null, height: null }
}

const generateBlurDataUrl = async (image: ImageDataLike) => {
  const targetWidth = 16
  const resized = await resize(image, {
    width: targetWidth,
    height: Math.max(1, Math.round((image.height / image.width) * targetWidth))
  })
  const encoded = await encodeWebp(resized, { quality: 30 })
  const base64 = toBase64(toUint8Array(encoded))
  return `data:image/webp;base64,${base64}`
}

export async function optimizeImageInBackground(fileId: string) {
  const db = await useDB()
  const config = useFileManagerConfig()
  const provider = await createStorageProvider(config.storage)

  const [record] = await db.select().from(fileTable).where(eq(fileTable.id, fileId)).limit(1)
  if (!record) {
    return
  }

  if (record.optimizationStatus === 'done' && record.variants) {
    return
  }

  if (record.fileType !== 'image' || !record.mimeType?.startsWith('image/')) {
    await db.update(fileTable)
      .set({
        optimizationStatus: 'done',
        optimizationError: null,
        optimizedAt: new Date()
      })
      .where(eq(fileTable.id, fileId))
    return
  }

  if (record.mimeType === 'image/svg+xml') {
    const original = await provider.getObject(record.path)
    const svgText = new TextDecoder().decode(original.bytes)
    const { width, height } = extractSvgDimensions(svgText)
    await db.update(fileTable)
      .set({
        width,
        height,
        optimizationStatus: 'done',
        optimizationError: null,
        optimizedAt: new Date()
      })
      .where(eq(fileTable.id, fileId))
    return
  }

  const decoder = SUPPORTED_MIME_DECODERS.get(record.mimeType)
  if (!decoder) {
    await db.update(fileTable)
      .set({
        optimizationStatus: 'failed',
        optimizationError: `Unsupported image mime type: ${record.mimeType}`
      })
      .where(eq(fileTable.id, fileId))
    return
  }

  await db.update(fileTable)
    .set({
      optimizationStatus: 'processing',
      optimizationError: null
    })
    .where(eq(fileTable.id, fileId))

  try {
    const original = await provider.getObject(record.path)
    const bytes = toUint8Array(original.bytes)
    const decoded = await decoder(bytes)
    const orientation = record.mimeType === 'image/jpeg' ? getExifOrientation(bytes) : null
    const oriented = applyExifOrientation(decoded, orientation)
    const quality = clampQuality(config.image?.quality)
    const sizes = [...new Set((config.image?.sizes || []).filter(size => size > 0))].sort((a, b) => a - b)
    const formats = (config.image?.formats || ['webp']).filter(format => SUPPORTED_OUTPUT_FORMATS.has(format))
    const variants: ImageVariantMap = {}

    const blurDataUrl = await generateBlurDataUrl(oriented)

    for (const format of formats) {
      for (const width of sizes) {
        if (width >= oriented.width) {
          continue
        }
        const resized = await resize(oriented, calculateSize(oriented.width, oriented.height, width))
        const encoded = await encodeVariant(format, resized, quality)
        const encodedBytes = toUint8Array(encoded)
        const path = buildVariantPath(record.path, width, format)
        const mime = format === 'avif' ? 'image/avif' : 'image/webp'
        await provider.putObject(path, encodedBytes, mime, CACHE_CONTROL_IMMUTABLE)

        variants[`${width}.${format}`] = {
          path,
          url: provider.getUrl(path),
          width: resized.width,
          height: resized.height,
          bytes: encodedBytes.length,
          mime
        }
      }
    }

    await db.update(fileTable)
      .set({
        width: oriented.width,
        height: oriented.height,
        blurDataUrl,
        variants,
        optimizationStatus: 'done',
        optimizationError: null,
        optimizedAt: new Date()
      })
      .where(and(eq(fileTable.id, fileId), eq(fileTable.isActive, true)))
  } catch (error) {
    await db.update(fileTable)
      .set({
        optimizationStatus: 'failed',
        optimizationError: error instanceof Error ? error.message : 'Image optimization failed'
      })
      .where(eq(fileTable.id, fileId))
  }
}
