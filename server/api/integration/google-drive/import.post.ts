import { createError, getHeader, getRequestIP, readBody } from 'h3'
import { importGoogleDriveFile } from '~~/server/services/integration/googleDriveFileImporter'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

interface ImportRequestBody {
  fileId?: string
  fileName?: string
  mimeType?: string
  contentId?: string | null
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const body = await readBody<ImportRequestBody>(event)

  if (!body?.fileId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fileId is required.'
    })
  }

  const contentId = typeof body.contentId === 'string' && body.contentId.trim().length ? body.contentId.trim() : null

  const db = await useDB()
  const { file } = await importGoogleDriveFile({
    db,
    organizationId,
    userId: user.id,
    fileId: body.fileId,
    contentId,
    fileName: body.fileName ?? null,
    mimeType: body.mimeType ?? null,
    ipAddress: getRequestIP(event),
    userAgent: getHeader(event, 'user-agent') ?? undefined
  })

  return {
    success: true,
    file
  }
})
