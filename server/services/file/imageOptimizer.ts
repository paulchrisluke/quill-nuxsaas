import type { ImageDataLike, ImageVariantMap } from './imageTypes'
import { decode as decodeAvif, encode as encodeAvif } from '@jsquash/avif'
import { decode as decodeJpeg } from '@jsquash/jpeg'
import decodePng from '@jsquash/png/decode.js'
import resize from '@jsquash/resize'
import { decode as decodeWebp, encode as encodeWebp } from '@jsquash/webp'
import { and, eq, inArray, lt, or } from 'drizzle-orm'
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
const STALE_PROCESSING_MINUTES = 10

const toUint8Array = (input: Uint8Array | ArrayBuffer) => {
  return input instanceof Uint8Array ? input : new Uint8Array(input)
}

const toBase64 = (bytes: Uint8Array) => {
  // Convert Uint8Array to binary string correctly handling all byte values (0-255)
  // Use String.fromCharCode with proper handling for all byte values
  // This works because btoa() expects Latin-1 encoding (ISO-8859-1) where code points 0-255 map directly
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    // String.fromCharCode correctly handles values 0-255 for Latin-1 encoding
    binary += String.fromCharCode(bytes[i] & 0xFF)
  }
  return btoa(binary)
}

const parseGifDimensions = (bytes: Uint8Array): { width: number, height: number } | null => {
  const byte = (index: number) => bytes[index] ?? 0

  if (bytes.length < 10) {
    return null
  }
  if (byte(0) !== 0x47 || byte(1) !== 0x49 || byte(2) !== 0x46) { // GIF
    return null
  }
  const width = byte(6) + (byte(7) << 8)
  const height = byte(8) + (byte(9) << 8)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
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
  if (width <= 0) {
    return { width: targetWidth, height: 1 }
  }
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
  const byte = (index: number) => bytes[index] ?? 0

  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
    return null
  }

  let offset = 2
  while (offset + 1 < bytes.length) {
    if (byte(offset) !== 0xFF) {
      break
    }
    const marker = byte(offset + 1)
    offset += 2
    if (marker === 0xDA) {
      break
    }
    if (marker === 0xE1) {
      if (offset + 1 >= bytes.length) {
        break
      }
      const length = (byte(offset) << 8) + byte(offset + 1)
      const segmentStart = offset + 2
      const segmentEnd = segmentStart + length - 2
      if (segmentEnd > bytes.length) {
        break
      }
      if (
        byte(segmentStart) === 0x45
        && byte(segmentStart + 1) === 0x78
        && byte(segmentStart + 2) === 0x69
        && byte(segmentStart + 3) === 0x66
      ) {
        const tiffOffset = segmentStart + 6
        const littleEndian = byte(tiffOffset) === 0x49 && byte(tiffOffset + 1) === 0x49
        const getShort = (index: number) => {
          return littleEndian
            ? byte(index) + (byte(index + 1) << 8)
            : (byte(index) << 8) + byte(index + 1)
        }
        const getLong = (index: number) => {
          return littleEndian
            ? byte(index) + (byte(index + 1) << 8) + (byte(index + 2) << 16) + (byte(index + 3) << 24)
            : (byte(index) << 24) + (byte(index + 1) << 16) + (byte(index + 2) << 8) + byte(index + 3)
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
    const size = (byte(offset) << 8) + byte(offset + 1)
    offset += size
  }

  return null
}

const applyExifOrientation = (image: ImageDataLike, orientation: number | null): ImageDataLike => {
  if (!orientation || orientation === 1) {
    return image
  }

  const { width, height, data } = image
  const expectedDataLength = width * height * 4

  // Validate image.data exists and has sufficient length
  if (!data || data.length < expectedDataLength) {
    throw new Error(
      `Invalid image data: expected length ${expectedDataLength} (${width}x${height}x4), but got ${data?.length ?? 0}`
    )
  }

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
  const widthMatch = svg.match(/width=["']?([0-9.]+)(px)?["']?/i)
  const heightMatch = svg.match(/height=["']?([0-9.]+)(px)?["']?/i)
  const width = widthMatch ? Number.parseFloat(widthMatch[1]) : null
  const height = heightMatch ? Number.parseFloat(heightMatch[1]) : null
  // Only use explicit dimensions if they're unitless or px (not %, em, etc.)
  const widthHasValidUnit = widthMatch && (!widthMatch[2] || widthMatch[2] === 'px')
  const heightHasValidUnit = heightMatch && (!heightMatch[2] || heightMatch[2] === 'px')
  if (width && height && widthHasValidUnit && heightHasValidUnit) {
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
  if (image.width <= 0 || image.height <= 0) {
    return null
  }
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

  const staleProcessingCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000)
  const isStaleProcessing = record.optimizationStatus === 'processing'
    && record.optimizationStartedAt
    && record.optimizationStartedAt < staleProcessingCutoff
  if (record.optimizationStatus === 'processing' && !isStaleProcessing) {
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
        optimizedAt: new Date(),
        optimizationStartedAt: null
      })
      .where(eq(fileTable.id, fileId))
    return
  }

  const leaseStartedAt = new Date()
  const [lease] = await db.update(fileTable)
    .set({
      optimizationStatus: 'processing',
      optimizationError: null,
      optimizationStartedAt: leaseStartedAt
    })
    .where(and(
      eq(fileTable.id, fileId),
      or(
        inArray(fileTable.optimizationStatus, ['pending', 'failed']),
        and(
          eq(fileTable.optimizationStatus, 'processing'),
          lt(fileTable.optimizationStartedAt, staleProcessingCutoff)
        )
      )
    ))
    .returning({ id: fileTable.id })

  if (!lease) {
    return
  }

  if (record.mimeType === 'image/svg+xml') {
    try {
      const original = await provider.getObject(record.path)
      const svgText = new TextDecoder().decode(original.bytes)
      const { width, height } = extractSvgDimensions(svgText)
      await db.update(fileTable)
        .set({
          width,
          height,
          optimizationStatus: 'done',
          optimizationError: null,
          optimizedAt: new Date(),
          optimizationStartedAt: null
        })
        .where(eq(fileTable.id, fileId))
    } catch (error) {
      await db.update(fileTable)
        .set({
          optimizationStatus: 'failed',
          optimizationError: error instanceof Error ? error.message : 'SVG processing failed',
          optimizationStartedAt: null
        })
        .where(eq(fileTable.id, fileId))
    }
    return
  }

  if (record.mimeType === 'image/gif') {
    try {
      const original = await provider.getObject(record.path)
      const bytes = toUint8Array(original.bytes)
      const dimensions = parseGifDimensions(bytes)
      // Always skip GIF optimization for MVP (animated GIFs must not be flattened).

      await db.update(fileTable)
        .set({
          width: dimensions?.width ?? null,
          height: dimensions?.height ?? null,
          optimizationStatus: 'done',
          optimizationError: null,
          optimizedAt: new Date(),
          optimizationStartedAt: null
        })
        .where(eq(fileTable.id, fileId))
    } catch (error) {
      await db.update(fileTable)
        .set({
          optimizationStatus: 'failed',
          optimizationError: error instanceof Error ? error.message : 'GIF processing failed',
          optimizationStartedAt: null
        })
        .where(eq(fileTable.id, fileId))
    }
    return
  }

  const decoder = SUPPORTED_MIME_DECODERS.get(record.mimeType)
  if (!decoder) {
    await db.update(fileTable)
      .set({
        optimizationStatus: 'failed',
        optimizationError: `Unsupported image mime type: ${record.mimeType}`,
        optimizationStartedAt: null
      })
      .where(eq(fileTable.id, fileId))
    return
  }

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

    const blurDataUrl = await generateBlurDataUrl(oriented) ?? undefined

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
        optimizedAt: new Date(),
        optimizationStartedAt: null
      })
      .where(eq(fileTable.id, fileId))
  } catch (error) {
    await db.update(fileTable)
      .set({
        optimizationStatus: 'failed',
        optimizationError: error instanceof Error ? error.message : 'Image optimization failed',
        optimizationStartedAt: null
      })
      .where(eq(fileTable.id, fileId))
  }
}
