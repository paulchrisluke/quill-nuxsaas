import { createError } from 'h3'
import { listUserRepos } from '~~/server/services/integration/githubClient'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { getGithubIntegrationToken } from '~~/server/utils/github'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB()

  let repos
  try {
    const token = await getGithubIntegrationToken(db, organizationId)
    repos = await listUserRepos(token)
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
