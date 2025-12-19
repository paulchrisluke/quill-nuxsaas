import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { ensureGoogleAccessToken } from '~~/server/services/integration/googleAuth'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
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

  try {
    const accessToken = await ensureGoogleAccessToken(db, account)
    return {
      accessToken
    }
  } catch (error: any) {
    console.error('[google-drive] Failed to refresh picker token', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'Unable to authorize Google Drive picker. Please reconnect the integration.'
    })
  }
})
