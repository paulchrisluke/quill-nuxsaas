import type { ImageVariant, ImageVariantMap } from './imageTypes'

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const isImageVariant = (value: unknown): value is ImageVariant => {
  if (!isPlainObject(value)) {
    return false
  }

  return typeof value.path === 'string'
    && value.path.length > 0
    && typeof value.url === 'string'
    && value.url.length > 0
    && typeof value.width === 'number'
    && Number.isFinite(value.width)
    && value.width > 0
    && typeof value.height === 'number'
    && Number.isFinite(value.height)
    && value.height > 0
    && typeof value.bytes === 'number'
    && Number.isFinite(value.bytes)
    && value.bytes > 0
    && typeof value.mime === 'string'
    && value.mime.length > 0
}

export const parseImageVariantMap = (value: unknown): ImageVariantMap | null => {
  if (value == null) {
    return null
  }
  if (!isPlainObject(value)) {
    return null
  }

  const output: ImageVariantMap = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isImageVariant(entry)) {
      output[key] = entry
    }
  }

  return Object.keys(output).length > 0 ? output : null
}
