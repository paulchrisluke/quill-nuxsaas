import type { ReferenceContent, ResolvedReference } from './types'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

interface LoaderContext {
  db: Awaited<ReturnType<typeof import('~~/server/utils/db').useDB>>
  organizationId: string
}

interface RawSection {
  id?: string
  section_id?: string
  title?: string | null
  type?: string | null
  index?: number | null
  body?: string | null
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
        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          controller.abort()
        }, 5000) // 5 second timeout

        try {
          const response = await fetch(reference.metadata.url, {
            signal: controller.signal
          })
          if (response.ok) {
            const rawText = await response.text()
            const truncatedResult = truncateText(rawText)
            textContent = truncatedResult.text
            truncated = truncatedResult.truncated
          }
        } catch (error) {
          console.error('[references] Failed to fetch file reference:', reference.metadata.url, error)
          // Treat abort as failed fetch (textContent remains undefined)
          textContent = undefined
        } finally {
          clearTimeout(timeoutId)
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
      let content: {
        id: string
        slug: string | null
        title: string | null
        status: string | null
        currentVersionId: string | null
      } | undefined
      try {
        ;[content] = await context.db
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
      } catch (error) {
        console.error('[references] Failed to load content reference:', reference.id, error)
        continue
      }

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

      let version: { id: string, frontmatter: Record<string, any> | null, sections: RawSection[] | null } | undefined
      try {
        ;[version] = await context.db
          .select({
            id: schema.contentVersion.id,
            frontmatter: schema.contentVersion.frontmatter,
            sections: schema.contentVersion.sections
          })
          .from(schema.contentVersion)
          .where(eq(schema.contentVersion.id, content.currentVersionId))
          .limit(1)
      } catch (error) {
        console.error('[references] Failed to load content version:', content.currentVersionId, error)
        continue
      }

      const sections = Array.isArray(version?.sections) ? version.sections : []
      const sectionsSummary = sections.map((section: RawSection) => ({
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
      let content: {
        id: string
        slug: string | null
        title: string | null
        currentVersionId: string | null
      } | undefined
      try {
        ;[content] = await context.db
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
      } catch (error) {
        console.error('[references] Failed to load section content:', reference.contentId, error)
        continue
      }

      let version: { id: string, sections: RawSection[] | null } | null = null
      if (content?.currentVersionId) {
        try {
          ;[version] = await context.db
            .select({
              id: schema.contentVersion.id,
              sections: schema.contentVersion.sections
            })
            .from(schema.contentVersion)
            .where(eq(schema.contentVersion.id, content.currentVersionId))
            .limit(1)
        } catch (error) {
          console.error('[references] Failed to load section version:', content.currentVersionId, error)
          continue
        }
      }

      const sections = Array.isArray(version?.sections) ? version.sections : []
      const matchedSection = sections.find((section: RawSection) => {
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
      let source: {
        id: string
        title: string | null
        sourceType: string | null
        sourceText: string | null
      } | undefined
      try {
        ;[source] = await context.db
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
      } catch (error) {
        console.error('[references] Failed to load source reference:', reference.id, error)
        continue
      }

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
