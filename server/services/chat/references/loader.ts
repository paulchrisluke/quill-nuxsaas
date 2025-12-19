import type { ReferenceContent, ResolvedReference } from './types'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

interface LoaderContext {
  db: Awaited<ReturnType<typeof import('~~/server/utils/db').useDB>>
  organizationId: string
}

const MAX_TEXT_CHARS = 20000

const isTextLikeMime = (mimeType: string | null | undefined) => {
  if (!mimeType) {
    return false
  }
  const lower = mimeType.toLowerCase()
  return lower.startsWith('text/')
    || lower.includes('json')
    || lower.includes('markdown')
    || lower.includes('xml')
    || lower.includes('csv')
}

const truncateText = (value: string) => {
  if (value.length <= MAX_TEXT_CHARS) {
    return { text: value, truncated: false }
  }
  return { text: value.slice(0, MAX_TEXT_CHARS), truncated: true }
}

export async function loadReferenceContent(resolved: ResolvedReference[], context: LoaderContext): Promise<ReferenceContent[]> {
  const contents: ReferenceContent[] = []

  for (const reference of resolved) {
    if (reference.type === 'file') {
      let textContent: string | undefined
      let truncated = false
      if (isTextLikeMime(reference.metadata.mimeType)) {
        try {
          const response = await fetch(reference.metadata.url)
          if (response.ok) {
            const rawText = await response.text()
            const truncatedResult = truncateText(rawText)
            textContent = truncatedResult.text
            truncated = truncatedResult.truncated
          }
        } catch {
          textContent = undefined
        }
      }

      contents.push({
        type: 'file',
        token: reference.token,
        metadata: reference.metadata,
        textContent,
        truncated
      })
      continue
    }

    if (reference.type === 'content') {
      const [content] = await context.db
        .select({
          id: schema.content.id,
          slug: schema.content.slug,
          title: schema.content.title,
          status: schema.content.status,
          currentVersionId: schema.content.currentVersionId
        })
        .from(schema.content)
        .where(and(
          eq(schema.content.id, reference.id),
          eq(schema.content.organizationId, context.organizationId)
        ))
        .limit(1)

      if (!content?.currentVersionId) {
        contents.push({
          type: 'content',
          token: reference.token,
          metadata: reference.metadata,
          frontmatterSummary: null,
          sectionsSummary: []
        })
        continue
      }

      const [version] = await context.db
        .select({
          id: schema.contentVersion.id,
          frontmatter: schema.contentVersion.frontmatter,
          sections: schema.contentVersion.sections
        })
        .from(schema.contentVersion)
        .where(eq(schema.contentVersion.id, content.currentVersionId))
        .limit(1)

      const sections = Array.isArray(version?.sections) ? version.sections : []
      const sectionsSummary = sections.map((section: any) => ({
        id: section.id || section.section_id,
        title: section.title ?? null,
        type: section.type ?? null,
        index: section.index ?? null
      }))

      contents.push({
        type: 'content',
        token: reference.token,
        metadata: reference.metadata,
        frontmatterSummary: version?.frontmatter ?? null,
        sectionsSummary
      })
      continue
    }

    if (reference.type === 'section') {
      const [content] = await context.db
        .select({
          id: schema.content.id,
          slug: schema.content.slug,
          title: schema.content.title,
          currentVersionId: schema.content.currentVersionId
        })
        .from(schema.content)
        .where(and(
          eq(schema.content.id, reference.contentId),
          eq(schema.content.organizationId, context.organizationId)
        ))
        .limit(1)

      let version: { id: string, sections: Record<string, any>[] | null } | null = null
      if (content?.currentVersionId) {
        ;[version] = await context.db
          .select({
            id: schema.contentVersion.id,
            sections: schema.contentVersion.sections
          })
          .from(schema.contentVersion)
          .where(eq(schema.contentVersion.id, content.currentVersionId))
          .limit(1)
      }

      const sections = Array.isArray(version?.sections) ? version.sections : []
      const matchedSection = sections.find((section: any) => {
        const sectionId = section.id || section.section_id
        return sectionId === reference.id
      })

      contents.push({
        type: 'section',
        token: reference.token,
        metadata: reference.metadata,
        body: matchedSection?.body || ''
      })
      continue
    }

    if (reference.type === 'source') {
      const [source] = await context.db
        .select({
          id: schema.sourceContent.id,
          title: schema.sourceContent.title,
          sourceType: schema.sourceContent.sourceType,
          sourceText: schema.sourceContent.sourceText
        })
        .from(schema.sourceContent)
        .where(and(
          eq(schema.sourceContent.id, reference.id),
          eq(schema.sourceContent.organizationId, context.organizationId)
        ))
        .limit(1)

      const text = source?.sourceText || ''
      const truncatedResult = text ? truncateText(text) : { text: '', truncated: false }

      contents.push({
        type: 'source',
        token: reference.token,
        metadata: reference.metadata,
        textContent: truncatedResult.text || undefined,
        truncated: truncatedResult.truncated
      })
    }
  }

  return contents
}
