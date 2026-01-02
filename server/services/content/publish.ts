import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq, ne } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { buildWorkspaceFilesPayload } from './workspaceFiles'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { getSiteConfigFromMetadata } from '~~/shared/utils/siteConfig'

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
  publication: typeof schema.publication.$inferSelect
  filePayload: ReturnType<typeof buildWorkspaceFilesPayload>[number]
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
  const publisher = publisherDefaults
    ? { ...publisherDefaults, ...(siteConfig.publisher ?? {}) }
    : (siteConfig.publisher ?? null)
  const authorDefaults = author ? { name: author.name, image: author.image ?? undefined } : null
  const authorPayload = authorDefaults
    ? { ...authorDefaults, ...(siteConfig.author ?? {}) }
    : (siteConfig.author ?? null)
  const blog = siteConfig.blog ?? null
  const categories = siteConfig.categories ?? null

  const filesPayload = buildWorkspaceFilesPayload(
    contentRecord,
    versionRecord,
    sourceContentRecord,
    {
      organizationSlug: organization.slug,
      baseUrl: runtimeConfig.public.baseURL ?? null,
      author: authorPayload,
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
  try {
    const buffer = new TextEncoder().encode(filePayload.fullMarkdown)
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

    const publishedAt = new Date()
    const { updatedContent, publicationRecord } = await db.transaction(async (tx) => {
      await tx
        .update(schema.file)
        .set({ isActive: false })
        .where(and(
          eq(schema.file.path, filePayload.filename),
          eq(schema.file.contentId, contentRecord.id),
          ne(schema.file.id, uploadedFile!.id)
        ))

      const [contentUpdate] = await tx
        .update(schema.content)
        .set({
          status: 'published',
          publishedAt
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
          status: 'published',
          publishedAt,
          payloadSnapshot: {
            fileId: uploadedFile!.id,
            path: uploadedFile!.path,
            url: uploadedFile!.url ?? null,
            filename: filePayload.filename
          }
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
      publication: publicationRecord,
      filePayload
    }
  } catch (error) {
    if (uploadedFile) {
      await fileService.deleteFile(uploadedFile.id).catch(() => {})
    }
    throw error
  }
}
