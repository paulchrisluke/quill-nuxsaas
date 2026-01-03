import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'

export const getGithubIntegrationToken = async (
  db: any,
  organizationId: string
) => {
  const integration = await db.query.integration.findFirst({
    where: and(
      eq(schema.integration.organizationId, organizationId),
      eq(schema.integration.type, 'github'),
      eq(schema.integration.isActive, true)
    )
  })

  if (!integration?.accountId) {
    throw createError({
      statusCode: 412,
      statusMessage: 'GitHub integration is not connected for this organization.'
    })
  }

  const [account] = await db
    .select({
      accessToken: schema.account.accessToken,
      providerId: schema.account.providerId
    })
    .from(schema.account)
    .where(eq(schema.account.id, integration.accountId))
    .limit(1)

  if (!account || account.providerId !== 'github' || !account.accessToken) {
    throw createError({
      statusCode: 412,
      statusMessage: 'GitHub integration is missing a valid access token.'
    })
  }

  return account.accessToken
}
