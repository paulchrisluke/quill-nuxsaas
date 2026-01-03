import { createError, getQuery } from 'h3'
import { listRepoBranches } from '~~/server/services/integration/githubClient'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { getGithubIntegrationToken } from '~~/server/utils/github'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const query = getQuery(event)
  const repoFullName = typeof query.repoFullName === 'string' ? query.repoFullName : ''

  if (!repoFullName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'repoFullName is required.'
    })
  }

  const db = await useDB()
  let branches: string[]
  try {
    const token = await getGithubIntegrationToken(db, organizationId)
    branches = await listRepoBranches(token, repoFullName)
  } catch (error) {
    console.error('[github-branches] Failed to fetch branches', {
      organizationId,
      repoFullName,
      error
    })
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to fetch branches from GitHub.'
    })
  }

  return { branches }
})
