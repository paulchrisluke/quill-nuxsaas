import type { ImageVariant, ImageVariantMap } from './imageTypes'
import { createError } from 'h3'

export const SUPPORTED_PROXY_FORMATS = new Set(['webp', 'avif', 'original'])

export const DEFAULT_MAX_PROXY_WIDTH = 2000

export const parseProxyParams = (
  query: { w?: string | string[], format?: string | string[] },
  options?: { maxWidth?: number }
) => {
  const widthRaw = Array.isArray(query.w) ? query.w[0] : query.w
  const formatRaw = Array.isArray(query.format) ? query.format[0] : query.format
  const maxWidth = Number.isFinite(options?.maxWidth) && (options?.maxWidth ?? 0) > 0
    ? (options!.maxWidth as number)
    : DEFAULT_MAX_PROXY_WIDTH

  let width: number | null = null
  if (widthRaw !== undefined) {
    const parsed = Number.parseInt(widthRaw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'w must be a positive integer' })
    }
    if (parsed > maxWidth) {
      throw createError({ statusCode: 400, statusMessage: `w must be at most ${maxWidth}` })
    }
    width = parsed
  }

  const format = formatRaw && typeof formatRaw === 'string' ? formatRaw : 'original'
  if (!SUPPORTED_PROXY_FORMATS.has(format)) {
    throw createError({ statusCode: 400, statusMessage: 'format must be webp, avif, or original' })
  }

  return { width, format }
}

export const selectVariant = (
  variants: ImageVariantMap | null | undefined,
  width: number | null,
  format: string
): ImageVariant | null => {
  if (!variants || !width || format === 'original') {
    return null
  }
  const key = `${width}.${format}`
  return variants[key] ?? null
}

export const getCacheControlHeader = (isVariant: boolean) => {
  return isVariant
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400'
}
