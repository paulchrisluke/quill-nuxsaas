import { eq } from 'drizzle-orm'
import { createError, getQuery, getRouterParams, setHeader } from 'h3'
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

  let requesterOrgId: string | null = null
  try {
    const session = await getAuthSession(event)
    requesterOrgId = session?.session?.activeOrganizationId
      ?? session?.data?.session?.activeOrganizationId
      ?? session?.activeOrganizationId
      ?? null
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error && (error as any).statusCode === 404) {
      throw error
    }
    // Swallow auth resolution failures to keep proxy functional for public assets.
  }

  if (requesterOrgId && record.organizationId && record.organizationId !== requesterOrgId) {
    throw createError({ statusCode: 404, statusMessage: 'Image not found' })
  }

  const variants = parseImageVariantMap(record.variants)
  const variant = selectVariant(variants, width, format)
  const targetPath = variant?.path || record.path
  let object
  try {
    object = await provider.getObject(targetPath)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Image file not found in storage' })
  }
  const isVariant = Boolean(variant)

  setHeader(event, 'Content-Type', variant?.mime || record.mimeType || object.contentType || 'application/octet-stream')
  setHeader(event, 'Cache-Control', getCacheControlHeader(isVariant))

  return object.bytes
})
