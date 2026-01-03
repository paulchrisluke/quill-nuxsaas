import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { CONTENT_STATUSES, CONTENT_TYPES, ensureUniqueContentSlug, slugifyTitle } from '~~/server/utils/content'

export interface ImportMarkdownInput {
  organizationId: string
  userId: string
  title: string
  slug: string
  frontmatter: Record<string, any>
  bodyMarkdown: string
  status?: string | null
  contentType?: string | null
  ingestMethod?: string | null
  source?: Record<string, any> | null
}

export const importMarkdownContent = async (
  db: NodePgDatabase<typeof schema>,
  input: ImportMarkdownInput
) => {
  const title = input.title.trim() || 'Untitled content'
  const baseSlug = input.slug ? slugifyTitle(input.slug) : slugifyTitle(title)
  const slug = await ensureUniqueContentSlug(db, input.organizationId, baseSlug)

  const status = input.status && CONTENT_STATUSES.includes(input.status as any)
    ? input.status
    : 'draft'
  const contentType = input.contentType && CONTENT_TYPES.includes(input.contentType as any)
    ? input.contentType
    : 'blog_post'

  const contentId = uuidv7()
  const versionId = uuidv7()

  const result = await db.transaction(async (tx) => {
    const [content] = await tx
      .insert(schema.content)
      .values({
        id: contentId,
        organizationId: input.organizationId,
        createdByUserId: input.userId,
        slug,
        title,
        status: status as typeof CONTENT_STATUSES[number],
        contentType: contentType as typeof CONTENT_TYPES[number],
        ingestMethod: input.ingestMethod ?? null,
        currentVersionId: versionId,
        publishedAt: status === 'published' ? new Date() : null
      })
      .returning()

    const [version] = await tx
      .insert(schema.contentVersion)
      .values({
        id: versionId,
        contentId,
        version: 1,
        createdByUserId: input.userId,
        frontmatter: input.frontmatter ?? null,
        bodyMarkdown: input.bodyMarkdown ?? '',
        assets: input.source ? { source: input.source } : null
      })
      .returning()

    return { content, version }
  })

  if (!result.content || !result.version) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create imported content.'
    })
  }

  return result
}
