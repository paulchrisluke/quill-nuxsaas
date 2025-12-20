import { describe, expect, it } from 'vitest'
import { getCacheControlHeader, parseProxyParams, selectVariant } from '~~/server/services/file/imageProxy'

describe('imageProxy utils', () => {
  it('parses proxy params with width and format', () => {
    const result = parseProxyParams({ w: '800', format: 'webp' })
    expect(result).toEqual({ width: 800, format: 'webp' })
  })

  it('defaults to original format when missing', () => {
    const result = parseProxyParams({})
    expect(result).toEqual({ width: null, format: 'original' })
  })

  it('rejects widths over the max', () => {
    expect(() => parseProxyParams({ w: '5000', format: 'webp' })).toThrow()
  })

  it('selects exact variant match', () => {
    const variant = selectVariant({
      '800.webp': {
        path: '2024/uuid/__v/800.webp',
        url: 'https://cdn.example.com/2024/uuid/__v/800.webp',
        width: 800,
        height: 600,
        bytes: 1234,
        mime: 'image/webp'
      }
    }, 800, 'webp')
    expect(variant?.path).toContain('800.webp')
  })

  it('returns null when no variant exists', () => {
    const variant = selectVariant({}, 800, 'webp')
    expect(variant).toBeNull()
  })

  it('returns cache headers for variants and originals', () => {
    expect(getCacheControlHeader(true)).toContain('immutable')
    expect(getCacheControlHeader(false)).toContain('max-age=86400')
  })
})
