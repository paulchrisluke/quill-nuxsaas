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
    .replace(/'/g, '&#39;')
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

export async function transformHtmlImages(html: string, options?: { organizationId?: string }) {
  if (!html || !/<img\b/i.test(html)) {
    return html
  }

  const organizationId = options?.organizationId?.trim()
  if (!organizationId) {
    // Safety default: without org context, do not rewrite HTML.
    return html
  }

  const config = useFileManagerConfig()
  if (config.image?.enableProxy === false) {
    return html
  }

  let storage: Awaited<ReturnType<typeof createStorageProvider>> | null = null
  try {
    storage = await createStorageProvider(config.storage)
  } catch (error) {
    console.error('Failed to create storage provider in transformHtmlImages:', error)
    return html
  }

  const baseUrls = new Set<string>()
  if (config.storage.r2?.publicUrl) {
    baseUrls.add(normalizeBaseUrl(config.storage.r2.publicUrl))
  }
  if (config.storage.local?.publicPath) {
    baseUrls.add(normalizeBaseUrl(config.storage.local.publicPath))
  }
  if (storage) {
    baseUrls.add(normalizeBaseUrl(storage.getUrl('')))
  }

  const sources = extractImageSourcesFromHtml(html)
  const candidates = sources
    .map(src => resolveStoragePathFromUrl(src, [...baseUrls]))
    .filter((path): path is string => path !== null)

  if (candidates.length === 0) {
    return html
  }

  const db = await useDB()
  const uniquePaths = [...new Set(candidates)]
  let records
  try {
    records = await db
      .select()
      .from(fileTable)
      .where(and(
        eq(fileTable.isActive, true),
        eq(fileTable.organizationId, organizationId),
        inArray(fileTable.path, uniquePaths)
      ))
  } catch (error) {
    console.error('Failed to query file records in transformHtmlImages:', {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
      candidateCount: candidates.length,
      uniquePathCount: uniquePaths.length
    })
    return html
  }

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
    if (src.startsWith('/api/images/')) {
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

    // Skip raster transformations for SVG files
    const isSVG = record.mimeType === 'image/svg+xml'
    if (isSVG) {
      // For SVGs, just update the src to use the proxy and preserve other attributes
      const imgAttrs: Record<string, string> = { ...attrs }
      imgAttrs.src = `/api/images/${record.id}`
      if (!imgAttrs.loading) {
        imgAttrs.loading = 'lazy'
      }
      if (!imgAttrs.width && record.width) {
        imgAttrs.width = String(record.width)
      }
      if (!imgAttrs.height && record.height) {
        imgAttrs.height = String(record.height)
      }
      const imgAttrString = Object.entries(imgAttrs)
        .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
        .join(' ')
      return `<img ${imgAttrString}>`
    }

    const proxyBase = `/api/images/${record.id}`
    const resolvedAlt = (attrs.alt || '').trim()

    // Determine sizes attribute: use provided value, or infer from image dimensions, or default to 100vw
    let sizesAttrValue = (attrs.sizes || '').trim()
    if (!sizesAttrValue && sizes.length > 0) {
      // For small images (icons, thumbnails), use a more appropriate default than 100vw
      if (record.width && record.width < 200) {
        // Small images are likely displayed at or near their natural size
        sizesAttrValue = `${record.width}px`
      } else {
        // Larger images may be responsive, default to viewport width
        sizesAttrValue = '100vw'
      }
    }

    const imgAttrs: Record<string, string> = { ...attrs }
    delete imgAttrs.src
    delete imgAttrs.srcset
    delete imgAttrs.sizes

    imgAttrs.alt = resolvedAlt || ''
    if (!imgAttrs.loading) {
      imgAttrs.loading = 'lazy'
    }
    if (!imgAttrs.decoding) {
      imgAttrs.decoding = 'async'
    }
    if (!imgAttrs.width && record.width) {
      imgAttrs.width = String(record.width)
    }
    if (!imgAttrs.height && record.height) {
      imgAttrs.height = String(record.height)
    }

    const imgAttrString = [
      `src="${escapeAttribute(proxyBase)}"`,
      sizesAttrValue ? `sizes="${escapeAttribute(sizesAttrValue)}"` : '',
      ...Object.entries(imgAttrs).map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    ].filter(Boolean).join(' ')

    const sourcesMarkup = formats
      .map((format) => {
        const srcset = buildProxySrcset(record.id, sizes, format)
        if (!srcset || srcset.trim() === '') {
          return null
        }
        const mime = format === 'avif' ? 'image/avif' : 'image/webp'
        const sizesAttr = sizesAttrValue ? ` sizes="${escapeAttribute(sizesAttrValue)}"` : ''
        return `<source type="${mime}" srcset="${escapeAttribute(srcset)}"${sizesAttr}>`
      })
      .filter((markup): markup is string => markup !== null && markup !== '')
      .join('')

    return `<picture>${sourcesMarkup}<img ${imgAttrString}></picture>`
  })
}
