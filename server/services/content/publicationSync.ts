import { and, desc, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { fetchPullRequest } from '~~/server/services/integration/githubClient'

const SYNC_COOLDOWN_MS = 60 * 1000
const lastSyncAttempts = new Map<string, number>()
const SYNC_CLEANUP_INTERVAL_MS = 60 * 1000
const SYNC_CACHE_TTL_MS = 5 * 60 * 1000

setInterval(() => {
  const cutoff = Date.now() - SYNC_CACHE_TTL_MS
  for (const [key, timestamp] of lastSyncAttempts.entries()) {
    if (timestamp < cutoff) {
      lastSyncAttempts.delete(key)
    }
  }
}, SYNC_CLEANUP_INTERVAL_MS)

export const syncGithubPublicationStatus = async (
  db: any,
  organizationId: string,
  contentId: string
) => {
  const cooldownKey = `${organizationId}:${contentId}`
  const lastAttempt = lastSyncAttempts.get(cooldownKey)
  const now = Date.now()
  if (lastAttempt && now - lastAttempt < SYNC_COOLDOWN_MS) {
    return false
  }

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

  let pr
  try {
    pr = await fetchPullRequest(account.accessToken, repoFullName, prNumber)
  } catch (error) {
    console.error('Failed to fetch PR from GitHub:', error)
    return false
  }

  if (!pr.merged_at) {
    return false
  }

  const mergedAt = new Date(pr.merged_at)

  try {
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
    lastSyncAttempts.set(cooldownKey, now)
  } catch (error) {
    console.error('Failed to update publication status:', error)
    return false
  }

  return true
}
