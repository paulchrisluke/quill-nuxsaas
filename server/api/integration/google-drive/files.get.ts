import { and, eq } from 'drizzle-orm'
import { createError, getQuery } from 'h3'
import * as schema from '~~/server/db/schema'
import { ensureGoogleAccessToken } from '~~/server/services/integration/googleAuth'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB()
  const query = getQuery(event)

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

  const limitParam = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : undefined
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(limitParam!, MAX_LIMIT))
    : DEFAULT_LIMIT
  const pageToken = typeof query.pageToken === 'string' ? query.pageToken : undefined

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

  const params: Record<string, any> = {
    pageSize: limit,
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,thumbnailLink,modifiedTime,webViewLink,size),nextPageToken',
    q: 'mimeType contains \'image/\' and trashed = false',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  }

  if (pageToken) {
    params.pageToken = pageToken
  }

  const response = await $fetch<{ files?: GoogleDriveFile[], nextPageToken?: string }>('https://www.googleapis.com/drive/v3/files', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    query: params
  }).catch((error: any) => {
    console.error('[google-drive] Failed to fetch file list', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'Unable to fetch files from Google Drive.'
    })
  })

  const files = (response.files ?? []).map(file => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    thumbnailLink: file.thumbnailLink ?? null,
    modifiedTime: file.modifiedTime ?? null,
    webViewLink: file.webViewLink ?? null,
    size: file.size ? Number(file.size) : null
  }))

  return {
    files,
    nextPageToken: response.nextPageToken ?? null
  }
})

interface GoogleDriveFile {
  id: string
  name: string
  mimeType: string
  thumbnailLink?: string
  modifiedTime?: string
  webViewLink?: string
  size?: string
}
