import { eq } from 'drizzle-orm'
import { createError, getQuery, getRouterParams, setHeader } from 'h3'
import { file as fileTable } from '~~/server/db/schema'
import { useFileManagerConfig } from '~~/server/services/file/fileService'
import { getCacheControlHeader, parseProxyParams, selectVariant } from '~~/server/services/file/imageProxy'
import { parseImageVariantMap } from '~~/server/services/file/imageVariantValidation'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { getAuthSession, getSessionOrganizationId } from '~~/server/utils/auth'
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
    requesterOrgId = getSessionOrganizationId(session)
  } catch (error) {
    // Handle 404 errors (session not found) - this is expected for unauthenticated requests
    // accessing public assets (images without organizationId)
    if (error && typeof error === 'object' && 'statusCode' in error && (error as any).statusCode === 404) {
      // 404 is acceptable: no session exists, requesterOrgId remains null
      // This allows public assets (record.organizationId === null) to be served
      // Security: Images with organizationId will be rejected below if requesterOrgId is null
      requesterOrgId = null
    } else {
      // Fail-closed: Re-throw all non-404 errors (auth system failures, network issues, etc.)
      // These indicate system problems that should not be silently ignored
      console.error('[Image API] getAuthSession failed with non-404 error:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        error,
        fileId,
        targetPath: record.path
      })
      // Return 503 Service Unavailable for auth system failures, or re-throw if it's already an H3Error
      if (error && typeof error === 'object' && 'statusCode' in error) {
        throw error
      }
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable',
        message: 'Authentication service temporarily unavailable'
      })
    }
  }

  // If the image belongs to an organization, require authentication and matching organization ID
  // Images without organizationId are public and accessible to anyone
  if (record.organizationId) {
    if (!requesterOrgId || requesterOrgId !== record.organizationId) {
      throw createError({ statusCode: 404, statusMessage: 'Image not found' })
    }
  }

  const variants = parseImageVariantMap(record.variants)
  const variant = selectVariant(variants, width, format)
  const targetPath = variant?.path || record.path
  let object
  try {
    object = await provider.getObject(targetPath)
  } catch (err) {
    console.error('[Image API] Error retrieving image from storage provider:', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      error: err,
      targetPath
    })
    throw createError({ statusCode: 404, statusMessage: 'Image file not found in storage' })
  }
  const isVariant = Boolean(variant)

  setHeader(event, 'Content-Type', variant?.mime || record.mimeType || object.contentType || 'application/octet-stream')
  setHeader(event, 'Cache-Control', getCacheControlHeader(isVariant))

  return object.bytes
})
