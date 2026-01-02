import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams } from 'h3'
import * as schema from '~~/server/db/schema'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const { id } = getRouterParams(event)
  const fileId = validateUUID(id, 'id')

  const db = await useDB(event)

  const [record] = await db
    .select({
      id: schema.file.id,
      originalName: schema.file.originalName,
      fileName: schema.file.fileName,
      mimeType: schema.file.mimeType,
      fileType: schema.file.fileType,
      size: schema.file.size,
      url: schema.file.url,
      contentId: schema.file.contentId,
      isActive: schema.file.isActive,
      createdAt: schema.file.createdAt,
      updatedAt: schema.file.updatedAt
    })
    .from(schema.file)
    .where(and(
      eq(schema.file.id, fileId),
      eq(schema.file.organizationId, organizationId)
    ))
    .limit(1)

  if (!record || record.isActive === false) {
    throw createError({
      statusCode: 404,
      statusMessage: 'File not found'
    })
  }

  return {
    file: {
      id: record.id,
      originalName: record.originalName,
      fileName: record.fileName,
      mimeType: record.mimeType,
      fileType: record.fileType,
      size: record.size,
      url: record.url ?? null,
      contentId: record.contentId ?? null,
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
      updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt
    }
  }
})
