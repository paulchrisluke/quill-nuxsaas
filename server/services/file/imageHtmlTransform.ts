import { and, eq, inArray } from 'drizzle-orm'
import { file as fileTable } from '~~/server/db/schema'
import { useDB } from '~~/server/utils/db'
import { useFileManagerConfig } from './fileService'
import { extractImageSourcesFromHtml, normalizeBaseUrl, resolveStoragePathFromUrl } from './imageUrlMapper'
import { createStorageProvider } from './storage/factory'

const parseAttributes = (tag: string) => {
  const attrs: Record<string, string> = {}
  const attrRegex = /([a-z0-9:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi
  for (const match of tag.matchAll(attrRegex)) {
    const name = match[1]?.toLowerCase()
    if (!name || name === 'img') {
      continue
    }
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[name] = value
  }
  return attrs
}

const escapeAttribute = (value: string) => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const buildProxySrcset = (fileId: string, sizes: number[], format: string) => {
  return sizes
    .map(size => `/api/images/${fileId}?w=${size}&format=${format} ${size}w`)
    .join(', ')
}

const normalizeSizes = (sizes: number[]) => {
  return [...new Set(sizes)].filter(size => size > 0).sort((a, b) => a - b)
}

export async function transformHtmlImages(html: string) {
  if (!html || !html.includes('<img')) {
    return html
  }

  const config = useFileManagerConfig()
  if (config.image?.enableProxy === false) {
    return html
  }

  const storage = await createStorageProvider(config.storage)
  const baseUrls = new Set<string>()
  if (config.storage.r2?.publicUrl) {
    baseUrls.add(normalizeBaseUrl(config.storage.r2.publicUrl))
  }
  if (config.storage.s3?.publicUrl) {
    baseUrls.add(normalizeBaseUrl(config.storage.s3.publicUrl))
  }
  if (config.storage.local?.publicPath) {
    baseUrls.add(normalizeBaseUrl(config.storage.local.publicPath))
  }
  baseUrls.add(normalizeBaseUrl(storage.getUrl('')))

  const sources = extractImageSourcesFromHtml(html)
  const candidates = sources
    .map(src => resolveStoragePathFromUrl(src, [...baseUrls]))
    .filter((path): path is string => path !== null)

  if (candidates.length === 0) {
    return html
  }

  const db = await useDB()
  const uniquePaths = [...new Set(candidates)]
  const records = await db
    .select()
    .from(fileTable)
    .where(and(
      eq(fileTable.isActive, true),
      inArray(fileTable.path, uniquePaths)
    ))

  const fileByPath = new Map(records.map(record => [record.path, record]))
  if (fileByPath.size === 0) {
    return html
  }

  const sizes = normalizeSizes(config.image?.sizes ?? [])
  const formats = (config.image?.formats ?? ['webp']).filter(format => format === 'webp' || format === 'avif')

  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const attrs = parseAttributes(tag)
    const src = attrs.src
    if (!src) {
      return tag
    }
    const resolvedPath = resolveStoragePathFromUrl(src, [...baseUrls])
    if (!resolvedPath) {
      return tag
    }
    const record = fileByPath.get(resolvedPath)
    if (!record) {
      return tag
    }

    const originalUrl = record.url || storage.getUrl(record.path)
    const width = record.width
    const height = record.height
    const alt = attrs.alt || ''
    const className = attrs.class ? `class="${escapeAttribute(attrs.class)}"` : ''
    const sizesAttrValue = sizes.length > 0 ? '100vw' : null

    const imgAttrs = [
      `src="${escapeAttribute(originalUrl)}"`,
      alt ? `alt="${escapeAttribute(alt)}"` : 'alt=""',
      width ? `width="${width}"` : '',
      height ? `height="${height}"` : '',
      'loading="lazy"',
      'decoding="async"',
      className ? className.trim() : '',
      sizesAttrValue ? `sizes="${sizesAttrValue}"` : ''
    ].filter(Boolean).join(' ')

    const sourcesMarkup = formats.map((format) => {
      const srcset = buildProxySrcset(record.id, sizes, format)
      if (!srcset) {
        return ''
      }
      const mime = format === 'avif' ? 'image/avif' : 'image/webp'
      return `<source type="${mime}" srcset="${escapeAttribute(srcset)}"${sizesAttrValue ? ` sizes="${sizesAttrValue}"` : ''}>`
    }).filter(Boolean).join('')

    return `<picture>${sourcesMarkup}<img ${imgAttrs}></picture>`
  })
}
