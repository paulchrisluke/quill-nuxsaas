export interface ImageVariant {
  path: string
  url: string
  width: number
  height: number
  bytes: number
  mime: string
}

export type ImageVariantMap = Record<string, ImageVariant>

export interface ImageDataLike {
  width: number
  height: number
  data: Uint8ClampedArray
}
