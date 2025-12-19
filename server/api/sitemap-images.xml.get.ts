import { and, eq } from 'drizzle-orm'
import { setHeader } from 'h3'
import { file as fileTable } from '~~/server/db/schema'
import { useFileManagerConfig } from '~~/server/services/file/fileService'
import { parseImageVariantMap } from '~~/server/services/file/imageVariantValidation'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { useDB } from '~~/server/utils/db'

const xmlEscape = (value: string) => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export default defineEventHandler(async (event) => {
  const db = await useDB(event)
  const config = useFileManagerConfig()
  const provider = await createStorageProvider(config.storage)

  const files = await db
    .select()
    .from(fileTable)
    .where(and(
      eq(fileTable.fileType, 'image'),
      eq(fileTable.isActive, true)
    ))

  const entries = files.map((record) => {
    const urls = new Set<string>()
    const originalUrl = record.url || provider.getUrl(record.path)
    if (!originalUrl) {
      return ''
    }
    urls.add(originalUrl)

    const variants = parseImageVariantMap(record.variants)
    if (variants) {
      for (const variant of Object.values(variants)) {
        if (variant?.url) {
          urls.add(String(variant.url))
        }
      }
    }

    if (urls.size === 0) {
      return ''
    }

    const images = [...urls]
      .map(url => `<image:image><image:loc>${xmlEscape(url)}</image:loc></image:image>`)
      .join('')

    if (!images) {
      return ''
    }

    const loc = xmlEscape(originalUrl)
    return `<url><loc>${loc}</loc>${images}</url>`
  }).filter(Boolean)

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries.join('')}</urlset>`

  setHeader(event, 'Content-Type', 'application/xml')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=3600')
  return xml
})
