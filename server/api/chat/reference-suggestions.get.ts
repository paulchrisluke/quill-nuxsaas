import { and, desc, eq } from 'drizzle-orm'
import { getQuery } from 'h3'
import * as schema from '~~/server/db/schema'
import { requireActiveOrganization } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

const DEFAULT_LIMIT = 10

export default defineEventHandler(async (event) => {
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)
  const query = getQuery(event)
  const contentId = typeof query.contentId === 'string' ? query.contentId : null

  const [files, contents] = await Promise.all([
    db
      .select({
        id: schema.file.id,
        originalName: schema.file.originalName,
        fileName: schema.file.fileName,
        fileType: schema.file.fileType,
        mimeType: schema.file.mimeType,
        size: schema.file.size,
        url: schema.file.url,
        updatedAt: schema.file.updatedAt
      })
      .from(schema.file)
      .where(and(
        eq(schema.file.organizationId, organizationId),
        eq(schema.file.isActive, true)
      ))
      .orderBy(desc(schema.file.updatedAt))
      .limit(DEFAULT_LIMIT),
    db
      .select({
        id: schema.content.id,
        slug: schema.content.slug,
        title: schema.content.title,
        status: schema.content.status,
        updatedAt: schema.content.updatedAt
      })
      .from(schema.content)
      .where(eq(schema.content.organizationId, organizationId))
      .orderBy(desc(schema.content.updatedAt))
      .limit(DEFAULT_LIMIT)
  ])

  let sections: Array<{
    id: string
    title?: string | null
    type?: string | null
    index?: number | null
    contentId: string
    contentSlug: string
    contentTitle: string
  }> = []

  if (contentId) {
    const [content] = await db
      .select({
        id: schema.content.id,
        slug: schema.content.slug,
        title: schema.content.title,
        currentVersionId: schema.content.currentVersionId
      })
      .from(schema.content)
      .where(and(
        eq(schema.content.id, contentId),
        eq(schema.content.organizationId, organizationId)
      ))
      .limit(1)

    if (content?.currentVersionId) {
      const [version] = await db
        .select({
          id: schema.contentVersion.id,
          sections: schema.contentVersion.sections
        })
        .from(schema.contentVersion)
        .where(eq(schema.contentVersion.id, content.currentVersionId))
        .limit(1)

      const rawSections = Array.isArray(version?.sections) ? version.sections : []
      sections = rawSections
        .filter((section: any) => section?.id || section?.section_id)
        .map((section: any) => ({
          id: section.id || section.section_id,
          title: section.title ?? null,
          type: section.type ?? null,
          index: section.index ?? null,
          contentId: content.id,
          contentSlug: content.slug,
          contentTitle: content.title
        }))
        .slice(0, DEFAULT_LIMIT)
    }
  }

  return {
    files: files.map(file => ({
      id: file.id,
      label: file.fileName || file.originalName,
      subtitle: file.originalName !== file.fileName ? file.originalName : undefined,
      fileName: file.fileName,
      originalName: file.originalName,
      fileType: file.fileType,
      mimeType: file.mimeType,
      size: file.size,
      url: file.url,
      insertText: file.fileName || file.originalName
    })),
    contents: contents.map(content => ({
      id: content.id,
      slug: content.slug,
      title: content.title,
      status: content.status,
      label: content.slug,
      subtitle: content.title,
      insertText: content.slug
    })),
    sections: sections.map(section => ({
      id: section.id,
      title: section.title,
      type: section.type,
      index: section.index,
      contentId: section.contentId,
      contentSlug: section.contentSlug,
      contentTitle: section.contentTitle,
      label: section.title || section.type || section.id,
      subtitle: section.contentTitle,
      insertText: `${section.contentSlug}#${section.id}`
    }))
  }
})
