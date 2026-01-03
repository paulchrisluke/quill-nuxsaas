import { createError, getQuery } from 'h3'
import { listRepoMarkdownDirectories } from '~~/server/services/integration/githubClient'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { getGithubIntegrationToken } from '~~/server/utils/github'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const query = getQuery(event)
  const repoFullName = typeof query.repoFullName === 'string' ? query.repoFullName : ''
  const baseBranch = typeof query.baseBranch === 'string' ? query.baseBranch : 'main'

  if (!repoFullName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'repoFullName is required.'
    })
  }

  const db = await useDB()
  const token = await getGithubIntegrationToken(db, organizationId)

  try {
    const paths = await listRepoMarkdownDirectories(token, repoFullName, baseBranch)
    return {
      paths
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error && 'statusMessage' in error) {
      throw error
    }
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to fetch repository paths from GitHub.',
      cause: error
    })
  }
})
