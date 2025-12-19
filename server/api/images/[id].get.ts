import { eq } from 'drizzle-orm'
import { createError, getQuery, getRouterParams, setHeader } from 'h3'
import { file as fileTable } from '~~/server/db/schema'
import { useFileManagerConfig } from '~~/server/services/file/fileService'
import { getCacheControlHeader, parseProxyParams, selectVariant } from '~~/server/services/file/imageProxy'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { useDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const fileId = validateUUID(id, 'id')
  const { width, format } = parseProxyParams(getQuery(event))
  const db = await useDB(event)
  const config = useFileManagerConfig()
  if (config.image?.enableProxy === false) {
    throw createError({ statusCode: 404, statusMessage: 'Image proxy disabled' })
  }
  const provider = await createStorageProvider(config.storage)

  const [record] = await db
    .select()
    .from(fileTable)
    .where(eq(fileTable.id, fileId))
    .limit(1)

  if (!record || !record.path || record.fileType !== 'image') {
    throw createError({ statusCode: 404, statusMessage: 'Image not found' })
  }

  const variant = selectVariant(record.variants as any, width, format)
  const targetPath = variant?.path || record.path
  const object = await provider.getObject(targetPath)
  const isVariant = Boolean(variant)

  setHeader(event, 'Content-Type', variant?.mime || record.mimeType || object.contentType || 'application/octet-stream')
  setHeader(event, 'Cache-Control', getCacheControlHeader(isVariant))

  return object.bytes
})
