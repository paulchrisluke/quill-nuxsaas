import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq, ne } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { publishToGithub } from '~~/server/services/publishing/github'
import { callChatCompletionsRaw } from '~~/server/utils/aiGateway'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { getSiteConfigFromMetadata } from '~~/shared/utils/siteConfig'
import { buildContentJsonExport, serializeFrontmatterMarkdown } from './export'
import { buildWorkspaceFilesPayload } from './workspaceFiles'

const normalizeOptionalString = (value?: string | null) => {
  if (!value || typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const parsePrCopy = (content: string | null | undefined) => {
  if (!content) {
    return null
  }
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed?.title === 'string' && typeof parsed?.body === 'string') {
      return {
        title: parsed.title.trim(),
        body: parsed.body.trim()
      }
    }
  } catch {
    return null
  }
  return null
}

const generatePrCopy = async (options: {
  title: string
  slug: string
  contentType: string
  repoFullName: string
  files: Array<{ path: string }>
}) => {
  const response = await callChatCompletionsRaw({
    messages: [
      {
        role: 'system',
        content: [
          'You write concise GitHub pull request metadata for content publishing.',
          'Return JSON with keys "title" and "body".',
          'Title should be <= 72 characters.',
          'Body should be 2-4 short bullet points in markdown.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          repo: options.repoFullName,
          title: options.title,
          slug: options.slug,
          contentType: options.contentType,
          files: options.files.map(file => file.path)
        })
      }
    ],
    temperature: 0.4,
    maxTokens: 220
  })

  const content = response.choices?.[0]?.message?.content
  return parsePrCopy(content)
}

interface PublishContentVersionOptions {
  organizationId: string
  contentId: string
  versionId?: string | null
  userId: string
}

export interface PublishContentResult {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  file: typeof schema.file.$inferSelect
  jsonFile?: typeof schema.file.$inferSelect | null
  publication: typeof schema.publication.$inferSelect
  filePayload: ReturnType<typeof buildWorkspaceFilesPayload>[number]
  external?: {
    github?: {
      branch: string
      prNumber: number
      prUrl: string
      integrationId: string
    }
  }
}

export async function publishContentVersion(
  db: NodePgDatabase<typeof schema>,
  options: PublishContentVersionOptions
): Promise<PublishContentResult> {
  const { organizationId, contentId, versionId, userId } = options
  const [organization] = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      logo: schema.organization.logo,
      metadata: schema.organization.metadata
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)

  if (!organization) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Organization not found'
    })
  }

  const [contentRecord] = await db
    .select()
    .from(schema.content)
    .where(and(
      eq(schema.content.id, contentId),
      eq(schema.content.organizationId, organizationId)
    ))
    .limit(1)

  if (!contentRecord) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  const resolvedVersionId = versionId ?? contentRecord.currentVersionId

  if (!resolvedVersionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content has no version to publish'
    })
  }

  const [versionRecord] = await db
    .select()
    .from(schema.contentVersion)
    .where(and(
      eq(schema.contentVersion.id, resolvedVersionId),
      eq(schema.contentVersion.contentId, contentId)
    ))
    .limit(1)

  if (!versionRecord) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content version not found'
    })
  }

  const [author] = await db
    .select({ name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, contentRecord.createdByUserId))
    .limit(1)

  const sourceContentId =
    (versionRecord.frontmatter as Record<string, any> | null | undefined)?.sourceContentId
    || contentRecord.sourceContentId

  let sourceContentRecord: typeof schema.sourceContent.$inferSelect | null = null
  if (sourceContentId) {
    const [record] = await db
      .select()
      .from(schema.sourceContent)
      .where(and(
        eq(schema.sourceContent.id, sourceContentId),
        eq(schema.sourceContent.organizationId, organizationId)
      ))
      .limit(1)
    sourceContentRecord = record ?? null
  }

  const siteConfig = getSiteConfigFromMetadata(organization.metadata)
  const publisherDefaults = {
    name: organization.name,
    url: organization.slug && runtimeConfig.public.baseURL
      ? `${runtimeConfig.public.baseURL.replace(/\/+$/, '')}/${organization.slug}`
      : undefined,
    logoUrl: organization.logo ?? undefined
  }
  const publisher = { ...publisherDefaults, ...(siteConfig.publisher ?? {}) }
  const authorDefaults = author ? { name: author.name, image: author.image ?? undefined } : null
  const authorPayload = authorDefaults
    ? { ...authorDefaults, ...(siteConfig.author ?? {}) }
    : (siteConfig.author ?? null)
  const normalizedAuthor = authorPayload && typeof authorPayload.name === 'string' && authorPayload.name.trim().length > 0
    ? { ...authorPayload, name: authorPayload.name.trim() }
    : null
  const blog = siteConfig.blog ?? null
  const categories = siteConfig.categories ?? null

  const filesPayload = buildWorkspaceFilesPayload(
    contentRecord,
    versionRecord,
    sourceContentRecord,
    {
      organizationSlug: organization.slug,
      baseUrl: runtimeConfig.public.baseURL ?? null,
      author: normalizedAuthor,
      publisher,
      breadcrumbs: siteConfig.breadcrumbs ?? null,
      blog,
      categories
    }
  )
  const filePayload = filesPayload[0]

  if (!filePayload || !filePayload.fullMarkdown.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No content available to publish'
    })
  }

  const storageConfig = useFileManagerConfig()
  const storageProvider = await createStorageProvider(storageConfig.storage)
  const fileService = new FileService(storageProvider)

  let uploadedFile: typeof schema.file.$inferSelect | null = null
  let uploadedJsonFile: typeof schema.file.$inferSelect | null = null
  let githubPublishResult: {
    branch: string
    prNumber: number
    prUrl: string
    integrationId: string
  } | null = null

  const markdownExport = serializeFrontmatterMarkdown(
    filePayload.frontmatter,
    filePayload.fullMarkdown
  )
  const publishedAt = new Date()
  const jsonExportPayload = buildContentJsonExport({
    content: {
      id: contentRecord.id,
      slug: contentRecord.slug,
      title: contentRecord.title,
      status: contentRecord.status,
      contentType: contentRecord.contentType,
      publishedAt,
      updatedAt: contentRecord.updatedAt
    },
    version: {
      id: versionRecord.id,
      contentId: versionRecord.contentId,
      version: versionRecord.version,
      createdAt: versionRecord.createdAt,
      frontmatter: versionRecord.frontmatter ?? null,
      bodyMarkdown: versionRecord.bodyMarkdown
    },
    filePayload,
    author: normalizedAuthor,
    publisher
  })
  const jsonExport = `${JSON.stringify(jsonExportPayload, null, 2)}\n`

  const jsonFilename = filePayload.filename.endsWith('.md')
    ? filePayload.filename.replace(/\.md$/, '.json')
    : `${filePayload.filename}.json`
  try {
    const buffer = new TextEncoder().encode(markdownExport)
    uploadedFile = await fileService.uploadFile(
      buffer,
      filePayload.filename,
      'text/markdown',
      userId,
      undefined,
      undefined,
      {
        fileName: filePayload.filename,
        overrideOriginalName: filePayload.filename,
        contentId: contentRecord.id,
        organizationId
      }
    )

    const jsonBuffer = new TextEncoder().encode(jsonExport)
    uploadedJsonFile = await fileService.uploadFile(
      jsonBuffer,
      jsonFilename,
      'application/json',
      userId,
      undefined,
      undefined,
      {
        fileName: jsonFilename,
        overrideOriginalName: jsonFilename,
        contentId: contentRecord.id,
        organizationId
      }
    )

    const [githubIntegration] = await db
      .select()
      .from(schema.integration)
      .where(and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.type, 'github'),
        eq(schema.integration.isActive, true)
      ))
      .limit(1)

    const publishConfig = githubIntegration?.config && typeof githubIntegration.config === 'object'
      ? (githubIntegration.config as Record<string, any>).publish
      : null

    if (githubIntegration && publishConfig && publishConfig.enabled) {
      if (!githubIntegration.accountId) {
        throw createError({
          statusCode: 400,
          statusMessage: 'GitHub integration is missing an account.'
        })
      }
      if (typeof publishConfig.repoFullName !== 'string' || !publishConfig.repoFullName.trim()) {
        throw createError({
          statusCode: 400,
          statusMessage: 'GitHub publish requires a repoFullName.'
        })
      }

      const [account] = await db
        .select({
          accessToken: schema.account.accessToken,
          providerId: schema.account.providerId
        })
        .from(schema.account)
        .where(eq(schema.account.id, githubIntegration.accountId))
        .limit(1)

      if (!account || account.providerId !== 'github' || !account.accessToken) {
        throw createError({
          statusCode: 400,
          statusMessage: 'GitHub integration is missing a valid access token.'
        })
      }

      const contentPath = typeof publishConfig.contentPath === 'string'
        ? publishConfig.contentPath
        : 'content'
      const jsonPath = typeof publishConfig.jsonPath === 'string'
        ? publishConfig.jsonPath
        : contentPath

      const markdownPath = `${contentPath.replace(/\/+$/, '')}/${filePayload.slug}.md`
      const jsonPathFile = `${jsonPath.replace(/\/+$/, '')}/${filePayload.slug}.json`

      const requestedTitle = normalizeOptionalString(publishConfig.prTitle)
      const requestedBody = normalizeOptionalString(publishConfig.prBody)
      let aiPrCopy: { title: string, body: string } | null = null

      if (!requestedTitle || !requestedBody) {
        try {
          aiPrCopy = await generatePrCopy({
            title: contentRecord.title,
            slug: filePayload.slug,
            contentType: contentRecord.contentType,
            repoFullName: publishConfig.repoFullName,
            files: [
              { path: markdownPath },
              { path: jsonPathFile }
            ]
          })
        } catch (error) {
          console.error('[publish] Failed to generate PR copy', error)
        }
      }

      const prTitle = requestedTitle
        || aiPrCopy?.title
        || `Publish: ${contentRecord.title || filePayload.slug}`
      const prBody = requestedBody
        || aiPrCopy?.body
        || 'Automated publish from Quillio.'

      const githubResult = await publishToGithub(account.accessToken, {
        repoFullName: publishConfig.repoFullName,
        baseBranch: publishConfig.baseBranch,
        contentPath,
        jsonPath,
        branchPrefix: publishConfig.branchPrefix,
        prTitle,
        prBody
      }, {
        slug: filePayload.slug,
        title: contentRecord.title,
        files: [
          { path: markdownPath, content: markdownExport },
          { path: jsonPathFile, content: jsonExport }
        ]
      })

      githubPublishResult = {
        ...githubResult,
        integrationId: githubIntegration.id
      }
    }

    const publicationStatus = githubPublishResult ? 'pending' : 'published'
    const contentStatus = githubPublishResult ? contentRecord.status : 'published'
    const contentPublishedAt = githubPublishResult ? contentRecord.publishedAt : publishedAt
    const publicationPublishedAt = publishedAt

    const { updatedContent, publicationRecord } = await db.transaction(async (tx) => {
      await tx
        .update(schema.file)
        .set({ isActive: false })
        .where(and(
          eq(schema.file.path, filePayload.filename),
          eq(schema.file.contentId, contentRecord.id),
          ne(schema.file.id, uploadedFile!.id)
        ))

      await tx
        .update(schema.file)
        .set({ isActive: false })
        .where(and(
          eq(schema.file.path, jsonFilename),
          eq(schema.file.contentId, contentRecord.id),
          ne(schema.file.id, uploadedJsonFile!.id)
        ))

      const [contentUpdate] = await tx
        .update(schema.content)
        .set({
          status: contentStatus,
          publishedAt: contentPublishedAt
        })
        .where(eq(schema.content.id, contentRecord.id))
        .returning()

      if (!contentUpdate) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to update content record'
        })
      }

      const [publication] = await tx
        .insert(schema.publication)
        .values({
          organizationId,
          contentId: contentRecord.id,
          contentVersionId: versionRecord.id,
          status: publicationStatus,
          publishedAt: publicationPublishedAt,
          payloadSnapshot: {
            fileId: uploadedFile!.id,
            path: uploadedFile!.path,
            url: uploadedFile!.url ?? null,
            filename: filePayload.filename,
            jsonFileId: uploadedJsonFile!.id,
            jsonPath: uploadedJsonFile!.path,
            jsonUrl: uploadedJsonFile!.url ?? null,
            jsonFilename
          },
          integrationId: githubPublishResult?.integrationId ?? null,
          externalId: githubPublishResult?.prNumber
            ? String(githubPublishResult.prNumber)
            : null,
          responseSnapshot: githubPublishResult
            ? {
                github: {
                  prUrl: githubPublishResult.prUrl,
                  prNumber: githubPublishResult.prNumber,
                  branch: githubPublishResult.branch
                }
              }
            : null
        })
        .returning()

      if (!publication) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Failed to write publication record'
        })
      }

      return {
        updatedContent: contentUpdate,
        publicationRecord: publication
      }
    })

    return {
      content: updatedContent,
      version: versionRecord,
      file: uploadedFile,
      jsonFile: uploadedJsonFile,
      publication: publicationRecord,
      filePayload,
      external: githubPublishResult
        ? { github: githubPublishResult }
        : undefined
    }
  } catch (error) {
    if (uploadedFile) {
      await fileService.deleteFile(uploadedFile.id).catch(() => {})
    }
    if (uploadedJsonFile) {
      await fileService.deleteFile(uploadedJsonFile.id).catch(() => {})
    }
    throw error
  }
}
