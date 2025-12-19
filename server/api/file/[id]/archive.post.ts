import { and, eq } from 'drizzle-orm'
import { createError, getHeader, getRequestIP, getRouterParam } from 'h3'
import * as schema from '~~/server/db/schema'
import { logAuditEvent } from '~~/server/utils/auditLogger'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)

  const id = getRouterParam(event, 'id')
  const fileId = validateUUID(id, 'id')

  const [file] = await db
    .select({
      id: schema.file.id,
      uploadedBy: schema.file.uploadedBy,
      organizationId: schema.file.organizationId,
      originalName: schema.file.originalName,
      fileName: schema.file.fileName,
      mimeType: schema.file.mimeType,
      size: schema.file.size,
      isActive: schema.file.isActive
    })
    .from(schema.file)
    .where(and(
      eq(schema.file.id, fileId),
      eq(schema.file.organizationId, organizationId)
    ))
    .limit(1)

  if (!file) {
    throw createError({
      statusCode: 404,
      statusMessage: 'File not found'
    })
  }

  if (file.uploadedBy !== user.id && user.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Access denied'
    })
  }

  const now = new Date()

  const [updatedFile] = await db
    .update(schema.file)
    .set({
      isActive: false,
      updatedAt: now
    })
    .where(and(
      eq(schema.file.id, fileId),
      eq(schema.file.organizationId, organizationId),
      eq(schema.file.isActive, true)
    ))
    .returning()

  await logAuditEvent({
    userId: user.id,
    category: 'file',
    action: 'archive',
    targetType: 'file',
    targetId: fileId,
    ipAddress: getRequestIP(event),
    userAgent: getHeader(event, 'user-agent'),
    details: JSON.stringify({
      organizationId,
      originalName: file.originalName,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      alreadyArchived: !updatedFile
    })
  })

  return { success: true, status: 'archived' }
})
