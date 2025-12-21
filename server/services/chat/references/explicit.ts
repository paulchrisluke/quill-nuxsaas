import type { ReferenceSelection, ReferenceToken, ResolvedReference } from './types'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

interface ExplicitResolveContext {
  db: Awaited<ReturnType<typeof import('~~/server/utils/db').useDB>>
  organizationId: string
}

const normalizeIdentifier = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

const buildSelectionToken = (selection: ReferenceSelection): ReferenceToken => {
  const identifier = selection.identifier?.trim()
    || selection.label?.trim()
    || selection.id
  const raw = `@${identifier}`
  return {
    raw,
    identifier,
    startIndex: 0,
    endIndex: raw.length
  }
}

export const buildSelectionIdentifierSet = (selections: ReferenceSelection[]) => {
  const identifiers = new Set<string>()
  for (const selection of selections) {
    if (selection.identifier) {
      identifiers.add(normalizeIdentifier(selection.identifier))
    }
    if (selection.label) {
      identifiers.add(normalizeIdentifier(selection.label))
    }
    identifiers.add(normalizeIdentifier(selection.id))
  }
  return identifiers
}

export async function resolveExplicitSelections(
  selections: ReferenceSelection[],
  context: ExplicitResolveContext
): Promise<ResolvedReference[]> {
  const resolved: ResolvedReference[] = []

  for (const selection of selections) {
    const token = buildSelectionToken(selection)

    if (selection.type === 'file') {
      const [file] = await context.db
        .select({
          id: schema.file.id,
          originalName: schema.file.originalName,
          fileName: schema.file.fileName,
          fileType: schema.file.fileType,
          mimeType: schema.file.mimeType,
          size: schema.file.size,
          url: schema.file.url
        })
        .from(schema.file)
        .where(and(
          eq(schema.file.id, selection.id),
          eq(schema.file.organizationId, context.organizationId),
          eq(schema.file.isActive, true)
        ))
        .limit(1)

      if (file) {
        resolved.push({
          type: 'file',
          id: file.id,
          token,
          metadata: {
            id: file.id,
            originalName: file.originalName || '',
            fileName: file.fileName || '',
            fileType: file.fileType || '',
            mimeType: file.mimeType || '',
            size: file.size || 0,
            url: file.url || ''
          }
        })
      }
      continue
    }

    if (selection.type === 'content') {
      const [content] = await context.db
        .select({
          id: schema.content.id,
          slug: schema.content.slug,
          title: schema.content.title,
          status: schema.content.status
        })
        .from(schema.content)
        .where(and(
          eq(schema.content.id, selection.id),
          eq(schema.content.organizationId, context.organizationId)
        ))
        .limit(1)

      if (content) {
        resolved.push({
          type: 'content',
          id: content.id,
          token,
          metadata: {
            id: content.id,
            slug: content.slug || '',
            title: content.title || '',
            status: content.status || ''
          }
        })
      }
      continue
    }

    if (selection.type === 'section') {
      const contentId = selection.contentId
      if (!contentId) {
        continue
      }

      const [content] = await context.db
        .select({
          id: schema.content.id,
          slug: schema.content.slug,
          title: schema.content.title,
          currentVersionId: schema.content.currentVersionId
        })
        .from(schema.content)
        .where(and(
          eq(schema.content.id, contentId),
          eq(schema.content.organizationId, context.organizationId)
        ))
        .limit(1)

      if (!content?.currentVersionId) {
        continue
      }

      const [version] = await context.db
        .select({
          sections: schema.contentVersion.sections
        })
        .from(schema.contentVersion)
        .where(eq(schema.contentVersion.id, content.currentVersionId))
        .limit(1)

      const sections = Array.isArray(version?.sections) ? version.sections : []
      const hasSection = sections.some((section: Record<string, any>) => {
        const sectionId = section.id || section.section_id
        return typeof sectionId === 'string' && sectionId === selection.id
      })

      if (!hasSection) {
        continue
      }

      resolved.push({
        type: 'section',
        id: selection.id,
        contentId: content.id,
        token,
        metadata: {
          sectionId: selection.id,
          contentId: content.id,
          contentSlug: content.slug || '',
          contentTitle: content.title || ''
        }
      })
      continue
    }

    if (selection.type === 'source') {
      const [source] = await context.db
        .select({
          id: schema.sourceContent.id,
          title: schema.sourceContent.title,
          sourceType: schema.sourceContent.sourceType
        })
        .from(schema.sourceContent)
        .where(and(
          eq(schema.sourceContent.id, selection.id),
          eq(schema.sourceContent.organizationId, context.organizationId)
        ))
        .limit(1)

      if (source) {
        resolved.push({
          type: 'source',
          id: source.id,
          token,
          metadata: {
            id: source.id,
            title: source.title || '',
            sourceType: source.sourceType || ''
          }
        })
      }
      continue
    }
  }

  return resolved
}
