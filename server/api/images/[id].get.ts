import { eq } from 'drizzle-orm'
import { createError, getHeader, getQuery, getRouterParams, setHeader } from 'h3'
import { file as fileTable } from '~~/server/db/schema'
import { useFileManagerConfig } from '~~/server/services/file/fileService'
import { getCacheControlHeader, parseProxyParams, selectVariant } from '~~/server/services/file/imageProxy'
import { parseImageVariantMap } from '~~/server/services/file/imageVariantValidation'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event)
  const fileId = validateUUID(id, 'id')
  const db = await useDB(event)
  const config = useFileManagerConfig()
  if (config.image?.enableProxy === false) {
    throw createError({ statusCode: 404, statusMessage: 'Image proxy disabled' })
  }
  const { width, format } = parseProxyParams(getQuery(event), { maxWidth: config.image?.maxProxyWidth })
  const provider = await createStorageProvider(config.storage)

  const [record] = await db
    .select()
    .from(fileTable)
    .where(eq(fileTable.id, fileId))
    .limit(1)

  if (!record || !record.path || record.fileType !== 'image') {
    throw createError({ statusCode: 404, statusMessage: 'Image not found' })
  }

  // If the requester has an active session/org, enforce org ownership (prevents cross-org ID guessing).
  const hasAuthSignal = Boolean(getHeader(event, 'cookie') || getHeader(event, 'authorization'))
  if (hasAuthSignal) {
    try {
      const session = await getAuthSession(event)
      const organizationId = session?.session?.activeOrganizationId
        ?? session?.data?.session?.activeOrganizationId
        ?? session?.activeOrganizationId
        ?? null
      if (organizationId && record.organizationId && record.organizationId !== organizationId) {
        throw createError({ statusCode: 404, statusMessage: 'Image not found' })
      }
    } catch {
      // If auth resolution fails, fall back to public behavior.
    }
  }

  const variants = parseImageVariantMap(record.variants)
  const variant = selectVariant(variants, width, format)
  const targetPath = variant?.path || record.path
  const object = await provider.getObject(targetPath)
  const isVariant = Boolean(variant)

  setHeader(event, 'Content-Type', variant?.mime || record.mimeType || object.contentType || 'application/octet-stream')
  setHeader(event, 'Cache-Control', getCacheControlHeader(isVariant))

  return object.bytes
})
