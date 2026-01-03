import { and, eq } from 'drizzle-orm'
import { createError, readBody } from 'h3'
import * as schema from '~~/server/db/schema'
import { importMarkdownContent } from '~~/server/services/content/import'
import { fetchRepoFileContent, listRepoMarkdownFiles } from '~~/server/services/integration/githubClient'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { parseFrontmatterMarkdown } from '~~/server/utils/frontmatter'

interface ImportGithubRequestBody {
  repoFullName?: string
  contentPath?: string
  baseBranch?: string
  status?: string
}

const deriveTitleFromSlug = (slug: string) => {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const body = await readBody<ImportGithubRequestBody>(event)

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

  const integrationConfig = integration.config && typeof integration.config === 'object'
    ? integration.config as Record<string, any>
    : {}
  const importConfig = integrationConfig.import && typeof integrationConfig.import === 'object'
    ? integrationConfig.import as Record<string, any>
    : {}
  const publishConfig = integrationConfig.publish && typeof integrationConfig.publish === 'object'
    ? integrationConfig.publish as Record<string, any>
    : {}

  const repoFullName = body?.repoFullName
    || importConfig.repoFullName
    || publishConfig.repoFullName
  const contentPath = body?.contentPath
    || importConfig.contentPath
    || publishConfig.contentPath
  const baseBranch = body?.baseBranch
    || importConfig.baseBranch
    || publishConfig.baseBranch
    || 'main'
  const statusOverride = body?.status || importConfig.status || null

  if (!repoFullName || typeof repoFullName !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'repoFullName is required to import.'
    })
  }

  if (!contentPath || typeof contentPath !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'contentPath is required to import.'
    })
  }

  const files = await listRepoMarkdownFiles(
    account.accessToken,
    repoFullName,
    baseBranch,
    contentPath
  )

  if (!files.length) {
    return {
      success: true,
      imported: [],
      skipped: [],
      message: 'No markdown files found for import.'
    }
  }

  const imported: Array<{ path: string, contentId: string, slug: string }> = []
  const skipped: Array<{ path: string, reason: string }> = []

  for (const path of files) {
    try {
      const markdown = await fetchRepoFileContent(
        account.accessToken,
        repoFullName,
        path,
        baseBranch
      )
      const { frontmatter, body } = parseFrontmatterMarkdown(markdown)
      const filename = path.split('/').pop() || path
      const slugFromFile = filename.replace(/\.md$/, '')
      const slug = typeof frontmatter.slug === 'string' && frontmatter.slug.trim()
        ? frontmatter.slug.trim()
        : slugFromFile
      const title = typeof frontmatter.title === 'string' && frontmatter.title.trim()
        ? frontmatter.title.trim()
        : deriveTitleFromSlug(slug)

      const { content } = await importMarkdownContent(db, {
        organizationId,
        userId: user.id,
        title,
        slug,
        frontmatter,
        bodyMarkdown: body,
        status: statusOverride || (typeof frontmatter.status === 'string' ? frontmatter.status : null),
        contentType: typeof frontmatter.contentType === 'string' ? frontmatter.contentType : null,
        ingestMethod: 'github_import',
        source: {
          provider: 'github',
          repoFullName,
          path,
          baseBranch
        }
      })

      imported.push({ path, contentId: content.id, slug: content.slug })
    } catch (error: any) {
      skipped.push({ path, reason: error?.message || 'Import failed.' })
    }
  }

  return {
    success: true,
    imported,
    skipped
  }
})
