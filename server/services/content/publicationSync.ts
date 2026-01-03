import { and, desc, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { fetchPullRequest } from '~~/server/services/integration/githubClient'

export const syncGithubPublicationStatus = async (
  db: any,
  organizationId: string,
  contentId: string
) => {
  const [publication] = await db
    .select()
    .from(schema.publication)
    .where(and(
      eq(schema.publication.organizationId, organizationId),
      eq(schema.publication.contentId, contentId),
      eq(schema.publication.status, 'pending')
    ))
    .orderBy(desc(schema.publication.createdAt))
    .limit(1)

  if (!publication?.integrationId) {
    return false
  }

  const responseSnapshot = publication.responseSnapshot && typeof publication.responseSnapshot === 'object'
    ? publication.responseSnapshot as Record<string, any>
    : null
  const githubSnapshot = responseSnapshot?.github && typeof responseSnapshot.github === 'object'
    ? responseSnapshot.github as Record<string, any>
    : null
  const prNumber = Number(githubSnapshot?.prNumber || publication.externalId)

  if (!Number.isFinite(prNumber)) {
    return false
  }

  const [integration] = await db
    .select()
    .from(schema.integration)
    .where(eq(schema.integration.id, publication.integrationId))
    .limit(1)

  if (!integration?.accountId) {
    return false
  }

  const integrationConfig = integration.config && typeof integration.config === 'object'
    ? integration.config as Record<string, any>
    : {}
  const publishConfig = integrationConfig.publish && typeof integrationConfig.publish === 'object'
    ? integrationConfig.publish as Record<string, any>
    : {}
  const repoFullName = typeof publishConfig.repoFullName === 'string'
    ? publishConfig.repoFullName
    : null

  if (!repoFullName) {
    return false
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
    return false
  }

  const pr = await fetchPullRequest(account.accessToken, repoFullName, prNumber)

  if (!pr.merged_at) {
    return false
  }

  const mergedAt = new Date(pr.merged_at)

  await db.transaction(async (tx: any) => {
    await tx
      .update(schema.publication)
      .set({
        status: 'published',
        publishedAt: mergedAt
      })
      .where(eq(schema.publication.id, publication.id))

    await tx
      .update(schema.content)
      .set({
        status: 'published',
        publishedAt: mergedAt
      })
      .where(eq(schema.content.id, contentId))
  })

  return true
}
