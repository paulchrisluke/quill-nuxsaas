import { and, desc, eq } from 'drizzle-orm'
import { createError, readBody } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { importMarkdownContent } from '~~/server/services/content/import'
import { fetchRepoFileContent, listRepoMarkdownFiles } from '~~/server/services/integration/githubClient'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { CONTENT_STATUSES, CONTENT_TYPES, ensureUniqueContentSlug } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { parseFrontmatterMarkdown } from '~~/server/utils/frontmatter'
import { getSiteConfigFromMetadata } from '~~/shared/utils/siteConfig'

interface ImportGithubRequestBody {
  repoFullName?: string
  contentPath?: string
  baseBranch?: string
  status?: string
}

const normalizeKeywordList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map(entry => typeof entry === 'string' ? entry.trim() : '')
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
  }
  return []
}

const resolveImageUrl = (value: unknown, baseUrl: string | null) => {
  if (typeof value !== 'string') {
    return value
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  if (!baseUrl) {
    return trimmed
  }
  return new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, baseUrl).toString()
}

const normalizeImportedFrontmatter = (frontmatter: Record<string, any>, baseUrl: string | null) => {
  const normalized = { ...frontmatter }
  if (normalized.desc && !normalized.description) {
    normalized.description = normalized.desc
  }
  normalized.keywords = normalizeKeywordList(normalized.keywords)
  if (normalized.image) {
    normalized.image = resolveImageUrl(normalized.image, baseUrl)
  }
  if (normalized.authorImage) {
    normalized.authorImage = resolveImageUrl(normalized.authorImage, baseUrl)
  }
  return normalized
}

const rewriteMarkdownImageUrls = (markdown: string, baseUrl: string | null) => {
  if (!baseUrl) {
    return markdown
  }
  const replaceRelative = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed
    }
    return new URL(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, baseUrl).toString()
  }

  const markdownImagePattern = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+['"][^'"]*['"])?\s*\)/g
  const markdownRefPattern = /^\[([^\]]+)\]:\s*(\S+)(?:\s+['"][^'"]*['"])?\s*$/gm
  const htmlImagePattern = /<img\s[^>]*src=["']([^"']+)["'][^>]*>/gi

  const rewrittenMarkdown = markdown.replace(markdownImagePattern, (match, url) => {
    const absolute = replaceRelative(url)
    return match.replace(url, absolute)
  })

  const rewrittenRefs = rewrittenMarkdown.replace(markdownRefPattern, (match, label, url) => {
    const absolute = replaceRelative(url)
    return match.replace(url, absolute)
  })

  return rewrittenRefs.replace(htmlImagePattern, (match, url) => {
    const absolute = replaceRelative(url)
    return match.replace(url, absolute)
  })
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

  const [organizationRecord] = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)

  const siteConfig = getSiteConfigFromMetadata(organizationRecord?.metadata)
  const baseUrl = integration?.baseUrl
    || siteConfig.publisher?.url
    || siteConfig.blog?.url
    || null

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
      updated: [],
      message: 'No markdown files found for import.'
    }
  }

  const imported: Array<{ path: string, contentId: string, slug: string }> = []
  const updated: Array<{ path: string, contentId: string, slug: string }> = []
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
      const normalizedFrontmatter = normalizeImportedFrontmatter(frontmatter, baseUrl)
      const normalizedBody = rewriteMarkdownImageUrls(body, baseUrl)
      const filename = path.split('/').pop() || path
      const slugFromFile = filename.replace(/\.md$/, '')
      const slug = typeof normalizedFrontmatter.slug === 'string' && normalizedFrontmatter.slug.trim()
        ? normalizedFrontmatter.slug.trim()
        : slugFromFile
      const title = typeof normalizedFrontmatter.title === 'string' && normalizedFrontmatter.title.trim()
        ? normalizedFrontmatter.title.trim()
        : deriveTitleFromSlug(slug)

      const externalId = `${repoFullName}:${baseBranch}:${path}`

      const [sourceContent] = await db
        .select()
        .from(schema.sourceContent)
        .where(and(
          eq(schema.sourceContent.organizationId, organizationId),
          eq(schema.sourceContent.sourceType, 'github'),
          eq(schema.sourceContent.externalId, externalId)
        ))
        .limit(1)

      const sourceRecord = sourceContent ?? (await db
        .insert(schema.sourceContent)
        .values({
          organizationId,
          createdByUserId: user.id,
          sourceType: 'github',
          externalId,
          title,
          sourceText: null,
          metadata: {
            repoFullName,
            path,
            baseBranch
          },
          ingestStatus: 'ingested'
        })
        .returning())
        .at(0)

      const [existingContent] = sourceRecord
        ? await db
            .select()
            .from(schema.content)
            .where(eq(schema.content.sourceContentId, sourceRecord.id))
            .limit(1)
        : [null]

      if (existingContent) {
        const statusCandidate = statusOverride || (typeof normalizedFrontmatter.status === 'string' ? normalizedFrontmatter.status : null)
        const status = statusCandidate && CONTENT_STATUSES.includes(statusCandidate as any)
          ? statusCandidate
          : existingContent.status
        const contentTypeCandidate = typeof normalizedFrontmatter.contentType === 'string' ? normalizedFrontmatter.contentType : null
        const contentType = contentTypeCandidate && CONTENT_TYPES.includes(contentTypeCandidate as any)
          ? contentTypeCandidate
          : existingContent.contentType

        const nextSlug = slug !== existingContent.slug
          ? await ensureUniqueContentSlug(db, organizationId, slug)
          : existingContent.slug

        const [latestVersion] = await db
          .select({ version: schema.contentVersion.version })
          .from(schema.contentVersion)
          .where(eq(schema.contentVersion.contentId, existingContent.id))
          .orderBy(desc(schema.contentVersion.version))
          .limit(1)

        const nextVersion = (latestVersion?.version ?? 0) + 1
        const versionId = uuidv7()

        await db.transaction(async (tx) => {
          const [version] = await tx
            .insert(schema.contentVersion)
            .values({
              id: versionId,
              contentId: existingContent.id,
              version: nextVersion,
              createdByUserId: user.id,
              frontmatter: normalizedFrontmatter,
              bodyMarkdown: normalizedBody,
              assets: {
                source: {
                  provider: 'github',
                  repoFullName,
                  path,
                  baseBranch
                }
              }
            })
            .returning()

          if (!version) {
            throw createError({
              statusCode: 500,
              statusMessage: 'Failed to create updated content version.'
            })
          }

          await tx
            .update(schema.content)
            .set({
              title,
              slug: nextSlug,
              status: status as typeof CONTENT_STATUSES[number],
              contentType: contentType as typeof CONTENT_TYPES[number],
              ingestMethod: 'github_import',
              currentVersionId: versionId,
              publishedAt: status === 'published'
                ? (existingContent.publishedAt ?? new Date())
                : null
            })
            .where(eq(schema.content.id, existingContent.id))
        })

        updated.push({ path, contentId: existingContent.id, slug: nextSlug })
        continue
      }

      const { content } = await importMarkdownContent(db, {
        organizationId,
        userId: user.id,
        title,
        slug,
        frontmatter: normalizedFrontmatter,
        bodyMarkdown: normalizedBody,
        sourceContentId: sourceRecord?.id ?? null,
        status: statusOverride || (typeof normalizedFrontmatter.status === 'string' ? normalizedFrontmatter.status : null),
        contentType: typeof normalizedFrontmatter.contentType === 'string' ? normalizedFrontmatter.contentType : null,
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
    skipped,
    updated
  }
})
