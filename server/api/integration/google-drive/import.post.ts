import { Buffer } from 'node:buffer'
import { and, eq } from 'drizzle-orm'
import { createError, readBody } from 'h3'
import * as schema from '~~/server/db/schema'
import { ensureGoogleAccessToken } from '~~/server/services/integration/googleAuth'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'

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

  const db = await useDB()

  const integration = await db.query.integration.findFirst({
    where: and(
      eq(schema.integration.organizationId, organizationId),
      eq(schema.integration.type, 'google_drive'),
      eq(schema.integration.isActive, true)
    )
  })

  if (!integration?.accountId) {
    throw createError({
      statusCode: 412,
      statusMessage: 'Google Drive integration is not connected for this organization.'
    })
  }

  const [account] = await db
    .select()
    .from(schema.account)
    .where(eq(schema.account.id, integration.accountId))
    .limit(1)

  if (!account) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Google Drive integration account not found.'
    })
  }

  const storageProvider = await createStorageProvider(useFileManagerConfig().storage)
  const fileService = new FileService(storageProvider)

  const contentId = typeof body.contentId === 'string' && body.contentId.trim().length ? body.contentId.trim() : null

  let accessToken: string
  try {
    accessToken = await ensureGoogleAccessToken(db, account)
  } catch (error: any) {
    console.error('[google-drive] Failed to ensure access token', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to refresh Google Drive credentials.'
    })
  }

  const metadata = await $fetch<{
    id: string
    name: string
    mimeType: string
    size?: string
  }>(`https://www.googleapis.com/drive/v3/files/${body.fileId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    query: {
      fields: 'id,name,mimeType,size',
      supportsAllDrives: true
    }
  }).catch((error: any) => {
    console.error('[google-drive] Failed to fetch metadata', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'Unable to fetch file metadata from Google Drive.'
    })
  })

  if (!metadata.mimeType?.startsWith('image/')) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Only image files can be imported from Google Drive.'
    })
  }

  const arrayBuffer = await $fetch<ArrayBuffer>(`https://www.googleapis.com/drive/v3/files/${metadata.id}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    query: {
      alt: 'media',
      supportsAllDrives: true,
      acknowledgeAbuse: false
    },
    responseType: 'arrayBuffer'
  }).catch((error: any) => {
    console.error('[google-drive] Failed to download file content', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'Unable to download the selected Google Drive file.'
    })
  })

  const fileBuffer = Buffer.from(arrayBuffer)
  const fileName = metadata.name || body.fileName || `drive-file-${metadata.id}`
  const mimeType = metadata.mimeType || body.mimeType || 'application/octet-stream'

  const file = await fileService.uploadFile(
    fileBuffer,
    fileName,
    mimeType,
    user.id,
    getRequestIP(event),
    getHeader(event, 'user-agent'),
    {
      organizationId,
      contentId: contentId ?? undefined
    }
  )

  return {
    success: true,
    file
  }
})
