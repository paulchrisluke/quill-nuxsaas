import { and, asc, count, eq } from 'drizzle-orm'
import { createError, setHeader } from 'h3'
import { file as fileTable } from '~~/server/db/schema'
import { useFileManagerConfig } from '~~/server/services/file/fileService'
import { parseImageVariantMap } from '~~/server/services/file/imageVariantValidation'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

const MAX_ITEMS_PER_SITEMAP = 50000

const xmlEscape = (value: string) => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export default defineEventHandler(async (event) => {
  try {
    const db = await useDB(event)
    const config = useFileManagerConfig()
    const provider = await createStorageProvider(config.storage)
    const query = getQuery(event)
    const page = query.page ? parseInt(String(query.page), 10) : 1

    if (page < 1 || !Number.isInteger(page)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid page parameter. Must be a positive integer.'
      })
    }

    const baseUrl = runtimeConfig.public.baseURL
    const basePath = '/api/sitemap-images.xml'

    // Get total count to determine if we need a sitemap index
    const [totalRow] = await db
      .select({ value: count() })
      .from(fileTable)
      .where(and(
        eq(fileTable.fileType, 'image'),
        eq(fileTable.isActive, true)
      ))

    const totalCount = totalRow?.value ?? 0
    const totalPages = Math.ceil(totalCount / MAX_ITEMS_PER_SITEMAP)

    // If total exceeds max items per sitemap and page is 1, return sitemap index
    if (totalCount > MAX_ITEMS_PER_SITEMAP && page === 1) {
      const sitemapIndexEntries = []

      // Generate sitemap index entries for pages 2..(totalPages + 1) (page 1 is index-only)
      for (let i = 2; i <= totalPages + 1; i++) {
        const sitemapUrl = `${baseUrl}${basePath}?page=${i}`
        sitemapIndexEntries.push(
          `<sitemap><loc>${xmlEscape(sitemapUrl)}</loc></sitemap>`
        )
      }

      const sitemapIndexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapIndexEntries.join('')}
</sitemapindex>`

      setHeader(event, 'Content-Type', 'application/xml')
      setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=3600')
      return sitemapIndexXml
    }

    // Validate page bounds based on whether we're using pagination
    if (totalCount > MAX_ITEMS_PER_SITEMAP) {
      // When paginated, valid content pages are 2..(totalPages + 1) (page 1 is index-only)
      if (page < 2 || page > totalPages + 1) {
        throw createError({
          statusCode: 404,
          statusMessage: `Page ${page} does not exist. Valid pages are 2-${totalPages + 1} (page 1 shows the sitemap index).`
        })
      }
    } else {
      // When not paginated, only page 1 is valid (totalPages will be 0 or 1)
      if (page > 1) {
        throw createError({
          statusCode: 404,
          statusMessage: `Page ${page} does not exist. Only page 1 is available when not paginated.`
        })
      }
    }

    // Calculate pagination
    // When paginated (totalCount > MAX_ITEMS_PER_SITEMAP), page 1 is the index,
    // so content pages start at page 2. Adjust offset to account for this.
    const offset = totalCount > MAX_ITEMS_PER_SITEMAP
      ? (page - 2) * MAX_ITEMS_PER_SITEMAP
      : (page - 1) * MAX_ITEMS_PER_SITEMAP
    const limit = MAX_ITEMS_PER_SITEMAP

    // Fetch paginated files
    const files = await db
      .select()
      .from(fileTable)
      .where(and(
        eq(fileTable.fileType, 'image'),
        eq(fileTable.isActive, true)
      ))
      .orderBy(asc(fileTable.createdAt), asc(fileTable.id))
      .limit(limit)
      .offset(offset)

    // Helper function to validate and normalize URLs
    const isValidUrl = (url: unknown): url is string => {
      if (typeof url !== 'string' || !url.trim()) {
        return false
      }
      try {
        const parsedUrl = new URL(url.trim())
        // Validate that the URL has a valid protocol
        return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
      } catch {
        return false
      }
    }

    const entries = files.map((record) => {
      // Get page URL (where the image appears) - use record.url as the page URL
      let pageUrl: string | null = null
      if (record.url && isValidUrl(record.url)) {
        pageUrl = record.url.trim()
      }

      // If no page URL, skip this record (we need a page URL for the <loc>)
      if (!pageUrl) {
        return ''
      }

      // Collect all image URLs (from file path and variants)
      const imageUrls = new Set<string>()

      // Get the main image URL from the file path
      try {
        const providerUrl = provider.getUrl(record.path)
        if (providerUrl && isValidUrl(providerUrl)) {
          imageUrls.add(providerUrl.trim())
        }
      } catch (error) {
        console.error('[sitemap-images] Failed to get URL from provider for record:', {
          id: record.id,
          path: record.path,
          error: error instanceof Error ? error.message : String(error)
        })
        // Continue - we might still have variants
      }

      // Parse variants with error handling
      let variants: ReturnType<typeof parseImageVariantMap> = null
      try {
        variants = parseImageVariantMap(record.variants)
      } catch (error) {
        console.error('[sitemap-images] Failed to parse image variants for record:', {
          id: record.id,
          error: error instanceof Error ? error.message : String(error)
        })
        // Continue without variants rather than skipping the entire record
      }

      if (variants) {
        for (const variant of Object.values(variants)) {
          if (variant && variant.url && isValidUrl(variant.url)) {
            imageUrls.add(variant.url.trim())
          }
        }
      }

      // Filter out invalid/empty image URLs and build image elements
      const imageElements = [...imageUrls]
        .filter(url => url && url.trim().length > 0)
        .map(url => `<image:image><image:loc>${xmlEscape(url)}</image:loc></image:image>`)
        .join('')

      // If no valid image URLs, skip this record
      if (!imageElements) {
        return ''
      }

      // Use page URL for <loc>, image URLs go in <image:image> elements
      const loc = xmlEscape(pageUrl)
      return `<url><loc>${loc}</loc>${imageElements}</url>`
    }).filter(Boolean)

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries.join('')}</urlset>`

    setHeader(event, 'Content-Type', 'application/xml')
    setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=3600')
    return xml
  } catch (error) {
    // Log error for debugging
    console.error('[sitemap-images] Error generating sitemap:', error)

    // If it's already an H3 error, rethrow it
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }

    // Otherwise, return a 500 error
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal server error while generating sitemap'
    })
  }
})
