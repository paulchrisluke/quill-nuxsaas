import { describe, expect, it } from 'vitest'
import { extractImageSourcesFromHtml, resolveStoragePathFromUrl } from '~~/server/services/file/imageUrlMapper'

describe('imageUrlMapper', () => {
  it('resolves storage paths from known base URLs', () => {
    const baseUrls = ['https://cdn.example.com', '/uploads']
    const path = resolveStoragePathFromUrl('https://cdn.example.com/2024-01-01/abc.jpg', baseUrls)
    expect(path).toBe('2024-01-01/abc.jpg')

    const localPath = resolveStoragePathFromUrl('/uploads/2024-01-01/def.png', baseUrls)
    expect(localPath).toBe('2024-01-01/def.png')
  })

  it('returns null for unknown image URLs', () => {
    const baseUrls = ['https://cdn.example.com']
    const path = resolveStoragePathFromUrl('https://other.example.com/file.jpg', baseUrls)
    expect(path).toBeNull()
  })

  it('normalizes urls by stripping protocol/query/fragment', () => {
    const baseUrls = ['https://cdn.example.com']
    const path = resolveStoragePathFromUrl('http://cdn.example.com/dir/file.png?token=123#hash', baseUrls)
    expect(path).toBe('dir/file.png')
  })

  it('returns null for invalid inputs', () => {
    expect(resolveStoragePathFromUrl('', [])).toBeNull()
    expect(resolveStoragePathFromUrl('   ', ['https://cdn.example.com'])).toBeNull()
  })

  it('extracts image sources from HTML', () => {
    const html = '<p><img src="https://cdn.example.com/a.jpg" alt="A"><img src="/uploads/b.png"></p>'
    const sources = extractImageSourcesFromHtml(html)
    expect(sources).toEqual(['https://cdn.example.com/a.jpg', '/uploads/b.png'])
  })
})
