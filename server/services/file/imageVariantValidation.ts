import type { ImageVariant, ImageVariantMap } from './imageTypes'

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const isImageVariant = (value: unknown): value is ImageVariant => {
  if (!isPlainObject(value)) {
    return false
  }

  return typeof value.path === 'string'
    && typeof value.url === 'string'
    && typeof value.width === 'number'
    && Number.isFinite(value.width)
    && typeof value.height === 'number'
    && Number.isFinite(value.height)
    && typeof value.bytes === 'number'
    && Number.isFinite(value.bytes)
    && typeof value.mime === 'string'
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
