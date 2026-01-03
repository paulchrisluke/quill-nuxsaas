import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { listUserRepos } from '~~/server/services/integration/githubClient'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB()

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
      statusCode: 400,
      statusMessage: 'GitHub integration is missing a valid access token.'
    })
  }

  let repos
  try {
    repos = await listUserRepos(account.accessToken)
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to fetch repositories from GitHub. The access token may be expired or revoked.',
      cause: error
    })
  }

  return {
    repos,
    userId: user.id
  }
})
