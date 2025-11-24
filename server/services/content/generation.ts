import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { desc, eq } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import { composeBlogFromText } from '~~/server/utils/aiGateway'
import { CONTENT_STATUSES, CONTENT_TYPES, ensureUniqueContentSlug, slugifyTitle } from '~~/server/utils/content'
import { v7 as uuidv7 } from 'uuid'

interface GenerateContentOverrides {
  title?: string | null
  slug?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
}

export interface GenerateContentInput {
  organizationId: string
  userId: string
  text?: string | null
  sourceContentId?: string | null
  contentId?: string | null
  overrides?: GenerateContentOverrides
  systemPrompt?: string
  temperature?: number
}

export interface GenerateContentResult {
  content: typeof schema.content.$inferSelect
  version: typeof schema.contentVersion.$inferSelect
  markdown: string
  meta: Record<string, any>
}

export const generateContentDraft = async (
  db: NodePgDatabase<typeof schema>,
  input: GenerateContentInput
): Promise<GenerateContentResult> => {
  const {
    organizationId,
    userId,
    text,
    sourceContentId,
    contentId,
    overrides,
    systemPrompt,
    temperature
  } = input

  if (!organizationId || !userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'organization and user context are required'
    })
  }

  let sourceContent: typeof schema.sourceContent.$inferSelect | null = null

  if (sourceContentId) {
    const [row] = await db
      .select()
      .from(schema.sourceContent)
      .where(eq(schema.sourceContent.id, sourceContentId))
      .limit(1)

    if (!row || row.organizationId !== organizationId) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Source content not found for this organization'
      })
    }

    sourceContent = row
  }

  let existingContent: typeof schema.content.$inferSelect | null = null

  if (contentId) {
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.id, contentId))
      .limit(1)

    if (!row || row.organizationId !== organizationId) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Content not found for this organization'
      })
    }

    existingContent = row
  }

  const inputText = typeof text === 'string' && text.trim().length > 0
    ? text
    : (sourceContent?.sourceText ?? null)

  if (!inputText) {
    throw createError({
      statusCode: 400,
      statusMessage: 'text or sourceContentId with source_text is required'
    })
  }

  const resolvedTitle = typeof overrides?.title === 'string' && overrides.title.trim().length > 0
    ? overrides.title
    : (existingContent?.title ?? sourceContent?.title ?? 'New Codex Draft')

  const selectedContentType = overrides?.contentType && CONTENT_TYPES.includes(overrides.contentType)
    ? overrides.contentType
    : (existingContent?.contentType ?? 'blog_post')

  const selectedStatus = overrides?.status && CONTENT_STATUSES.includes(overrides.status)
    ? overrides.status
    : (existingContent?.status ?? 'draft')

  const primaryKeyword = typeof overrides?.primaryKeyword === 'string'
    ? overrides.primaryKeyword
    : (existingContent?.primaryKeyword ?? null)

  const targetLocale = typeof overrides?.targetLocale === 'string'
    ? overrides.targetLocale
    : (existingContent?.targetLocale ?? null)

  const resolvedSourceContentId = sourceContent?.id ?? existingContent?.sourceContentId ?? null

  const { markdown, meta } = await composeBlogFromText(inputText, {
    systemPrompt,
    temperature
  })

  const assets = {
    generator: {
      engine: meta.engine,
      model: meta.model,
      generatedAt: new Date().toISOString()
    },
    source: sourceContent
      ? {
        id: sourceContent.id,
        type: sourceContent.sourceType,
        externalId: sourceContent.externalId
      }
      : null
  }

  const seoSnapshot = {
    meta,
    primaryKeyword,
    targetLocale,
    contentType: selectedContentType
  }

  const result = await db.transaction(async (tx) => {
    let contentRecord = existingContent
    let slug = existingContent?.slug

    if (!contentRecord) {
      const baseSlug = overrides?.slug
        ? slugifyTitle(overrides.slug)
        : slugifyTitle(resolvedTitle)

      slug = await ensureUniqueContentSlug(tx, organizationId, baseSlug)

      const [createdContent] = await tx
        .insert(schema.content)
        .values({
          id: uuidv7(),
          organizationId,
          createdByUserId: userId,
          sourceContentId: resolvedSourceContentId,
          title: resolvedTitle,
          slug,
          status: selectedStatus,
          primaryKeyword,
          targetLocale,
          contentType: selectedContentType,
          currentVersionId: null
        })
        .returning()

      contentRecord = createdContent
    } else {
      slug = contentRecord.slug

      const shouldUpdateSource = resolvedSourceContentId !== contentRecord.sourceContentId
      const shouldUpdate =
        resolvedTitle !== contentRecord.title ||
        selectedStatus !== contentRecord.status ||
        primaryKeyword !== contentRecord.primaryKeyword ||
        targetLocale !== contentRecord.targetLocale ||
        shouldUpdateSource

      if (shouldUpdate) {
        const [updatedContent] = await tx
          .update(schema.content)
          .set({
            title: resolvedTitle,
            status: selectedStatus,
            primaryKeyword,
            targetLocale,
            sourceContentId: resolvedSourceContentId,
            updatedAt: new Date()
          })
          .where(eq(schema.content.id, contentRecord.id))
          .returning()

        contentRecord = updatedContent
      }
    }

    const [latestVersion] = await tx
      .select({ version: schema.contentVersion.version })
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.contentId, contentRecord.id))
      .orderBy(desc(schema.contentVersion.version))
      .limit(1)

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1
    const [newVersion] = await tx
      .insert(schema.contentVersion)
      .values({
        id: uuidv7(),
        contentId: contentRecord.id,
        version: nextVersionNumber,
        createdByUserId: userId,
        frontmatter: {
          title: resolvedTitle,
          slug,
          status: selectedStatus,
          contentType: selectedContentType,
          sourceContentId: resolvedSourceContentId
        },
        bodyMdx: markdown,
        bodyHtml: null,
        sections: null,
        assets,
        seoSnapshot
      })
      .returning()

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, contentRecord.id))
      .returning()

    return {
      content: updatedContent,
      version: newVersion
    }
  })

  return {
    content: result.content,
    version: result.version,
    markdown,
    meta
  }
}
