import type {
  AmbiguousReference,
  ReferenceCandidate,
  ReferenceResolutionResult,
  ReferenceToken,
  ResolvedReference,
  UnresolvedReference
} from './types'
import { and, eq, or, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

interface ResolveContext {
  db: Awaited<ReturnType<typeof import('~~/server/utils/db').useDB>>
  organizationId: string
  currentContentId?: string | null
  userId?: string | null
  mode: 'chat' | 'agent'
}

interface MatchResult<T> {
  match: T | null
  ambiguous: T[]
  priority: 'exact' | 'prefix' | 'substring' | null
}

const normalizeValue = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

const escapeLikePattern = (value: string): string => {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

const selectBestMatch = <T>(identifier: string, candidates: T[], getKeys: (candidate: T) => Array<string | null | undefined>): MatchResult<T> => {
  const normalized = normalizeValue(identifier)
  const matches: Array<{ item: T, priority: 'exact' | 'prefix' | 'substring' }> = []

  for (const candidate of candidates) {
    const keys = getKeys(candidate).map(key => normalizeValue(key)).filter(Boolean)
    let priority: 'exact' | 'prefix' | 'substring' | null = null

    for (const key of keys) {
      if (key === normalized) {
        priority = 'exact'
        break
      }
      if (key.startsWith(normalized)) {
        priority = priority ?? 'prefix'
      } else if (key.includes(normalized)) {
        priority = priority ?? 'substring'
      }
    }

    if (priority) {
      matches.push({ item: candidate, priority })
    }
  }

  if (!matches.length) {
    return { match: null, ambiguous: [], priority: null }
  }

  const priorityOrder: Array<'exact' | 'prefix' | 'substring'> = ['exact', 'prefix', 'substring']
  const bestPriority = priorityOrder.find(item => matches.some(match => match.priority === item)) ?? null

  if (!bestPriority) {
    return { match: null, ambiguous: [], priority: null }
  }

  const bestMatches = matches.filter(match => match.priority === bestPriority).map(match => match.item)

  if (bestMatches.length === 1) {
    return { match: bestMatches[0], ambiguous: [], priority: bestPriority }
  }

  return { match: null, ambiguous: bestMatches, priority: bestPriority }
}

const buildCandidate = (candidate: ReferenceCandidate): ReferenceCandidate => candidate

const LIMIT_MATCHES = 25

const fetchFileCandidates = async (context: ResolveContext, identifier: string) => {
  const normalized = normalizeValue(identifier)
  const escaped = escapeLikePattern(normalized)
  return await context.db
    .select({
      id: schema.file.id,
      originalName: schema.file.originalName,
      fileName: schema.file.fileName,
      mimeType: schema.file.mimeType,
      fileType: schema.file.fileType,
      size: schema.file.size,
      url: schema.file.url
    })
    .from(schema.file)
    .where(and(
      eq(schema.file.organizationId, context.organizationId),
      eq(schema.file.isActive, true),
      or(
        sql`lower(${schema.file.fileName}) like ${`%${escaped}%`} escape '\\'`,
        sql`lower(${schema.file.originalName}) like ${`%${escaped}%`} escape '\\'`
      )
    ))
    .orderBy(sql`${schema.file.updatedAt} DESC`)
    .limit(LIMIT_MATCHES)
}

const fetchContentCandidates = async (context: ResolveContext, identifier: string) => {
  const normalized = normalizeValue(identifier)
  const escaped = escapeLikePattern(normalized)
  return await context.db
    .select({
      id: schema.content.id,
      slug: schema.content.slug,
      title: schema.content.title,
      status: schema.content.status,
      currentVersionId: schema.content.currentVersionId
    })
    .from(schema.content)
    .where(and(
      eq(schema.content.organizationId, context.organizationId),
      sql`lower(${schema.content.slug}) like ${`%${escaped}%`} escape '\\'`
    ))
    .orderBy(sql`${schema.content.updatedAt} DESC`)
    .limit(LIMIT_MATCHES)
}

const fetchSourceCandidates = async (context: ResolveContext, identifier: string) => {
  const normalized = normalizeValue(identifier)
  const escaped = escapeLikePattern(normalized)
  return await context.db
    .select({
      id: schema.sourceContent.id,
      title: schema.sourceContent.title,
      sourceType: schema.sourceContent.sourceType,
      externalId: schema.sourceContent.externalId
    })
    .from(schema.sourceContent)
    .where(and(
      eq(schema.sourceContent.organizationId, context.organizationId),
      or(
        sql`lower(${schema.sourceContent.externalId}) like ${`%${escaped}%`} escape '\\'`,
        sql`lower(${schema.sourceContent.title}) like ${`%${escaped}%`} escape '\\'`
      )
    ))
    .orderBy(sql`${schema.sourceContent.updatedAt} DESC`)
    .limit(LIMIT_MATCHES)
}

const toCandidateList = (candidates: Array<{ id: string, label: string, reference: string, subtitle?: string }>, type: ReferenceCandidate['type']) => {
  return candidates.slice(0, 5).map(candidate => buildCandidate({
    type,
    id: candidate.id,
    label: candidate.label,
    subtitle: candidate.subtitle,
    reference: candidate.reference
  }))
}

const resolveFileToken = async (token: ReferenceToken, context: ResolveContext) => {
  const candidates = await fetchFileCandidates(context, token.identifier)
  const match = selectBestMatch(token.identifier, candidates, candidate => [candidate.fileName, candidate.originalName])

  if (match.match) {
    const file = match.match
    return {
      resolved: {
        type: 'file',
        id: file.id,
        token,
        metadata: {
          id: file.id,
          originalName: file.originalName,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileType: file.fileType,
          size: file.size,
          url: file.url
        }
      } satisfies ResolvedReference
    }
  }

  if (match.ambiguous.length > 1) {
    const candidateList = toCandidateList(match.ambiguous.map(file => ({
      id: file.id,
      label: file.fileName || file.originalName,
      subtitle: file.originalName !== file.fileName ? file.originalName : undefined,
      reference: file.fileName || file.originalName
    })), 'file')

    return {
      ambiguous: {
        token,
        candidates: candidateList
      } satisfies AmbiguousReference
    }
  }

  return {
    unresolved: {
      token,
      reason: 'not_found'
    } satisfies UnresolvedReference
  }
}

const resolveContentToken = async (token: ReferenceToken, context: ResolveContext) => {
  const candidates = await fetchContentCandidates(context, token.identifier)
  const match = selectBestMatch(token.identifier, candidates, candidate => [candidate.slug])

  if (match.match) {
    const content = match.match
    const baseResolved: ResolvedReference = {
      type: 'content',
      id: content.id,
      token,
      metadata: {
        id: content.id,
        slug: content.slug,
        title: content.title,
        status: content.status
      }
    }

    if (token.anchor && content.currentVersionId) {
      const [version] = await context.db
        .select({
          id: schema.contentVersion.id,
          sections: schema.contentVersion.sections
        })
        .from(schema.contentVersion)
        .where(eq(schema.contentVersion.id, content.currentVersionId))
        .limit(1)

      const sections = Array.isArray(version?.sections) ? version.sections : []
      const normalizedAnchor = normalizeValue(token.anchor.value)

      const matchedSection = sections.find((section: any) => {
        const sectionId = normalizeValue(section.id || section.section_id)
        const sectionTitle = normalizeValue(section.title)
        const sectionType = normalizeValue(section.type)
        if (token.anchor?.kind === 'hash') {
          return sectionId === normalizedAnchor
        }
        return sectionTitle === normalizedAnchor || sectionType === normalizedAnchor
      })

      if (matchedSection) {
        return {
          resolved: {
            type: 'section',
            id: matchedSection.id || matchedSection.section_id,
            contentId: content.id,
            token,
            metadata: {
              sectionId: matchedSection.id || matchedSection.section_id,
              title: matchedSection.title ?? null,
              type: matchedSection.type ?? null,
              index: matchedSection.index ?? null,
              contentId: content.id,
              contentSlug: content.slug,
              contentTitle: content.title
            }
          } satisfies ResolvedReference
        }
      }

      const suggestions = sections
        .filter((section: any) => section?.id || section?.section_id)
        .slice(0, 5)
        .map((section: any) => buildCandidate({
          type: 'section',
          id: section.id || section.section_id,
          label: section.title || section.type || section.id || section.section_id,
          subtitle: content.title,
          reference: `${content.slug}#${section.id || section.section_id}`
        }))

      return {
        resolved: baseResolved,
        unresolved: {
          token,
          reason: 'section_not_found',
          suggestions: suggestions.length ? suggestions : undefined
        } satisfies UnresolvedReference
      }
    }

    return { resolved: baseResolved }
  }

  if (match.ambiguous.length > 1) {
    const candidateList = toCandidateList(match.ambiguous.map(content => ({
      id: content.id,
      label: content.slug,
      subtitle: content.title,
      reference: content.slug
    })), 'content')

    return {
      ambiguous: {
        token,
        candidates: candidateList
      } satisfies AmbiguousReference
    }
  }

  return {
    unresolved: {
      token,
      reason: 'not_found'
    } satisfies UnresolvedReference
  }
}

const resolveSourceToken = async (token: ReferenceToken, context: ResolveContext, identifier: string) => {
  const candidates = await fetchSourceCandidates(context, identifier)
  const match = selectBestMatch(identifier, candidates, candidate => [candidate.externalId, candidate.title])

  if (match.match) {
    const source = match.match
    return {
      resolved: {
        type: 'source',
        id: source.id,
        token,
        metadata: {
          id: source.id,
          title: source.title,
          sourceType: source.sourceType
        }
      } satisfies ResolvedReference
    }
  }

  if (match.ambiguous.length > 1) {
    const candidateList = toCandidateList(match.ambiguous.map(source => ({
      id: source.id,
      label: source.title || source.externalId || 'Untitled source',
      subtitle: source.sourceType,
      reference: `source:${source.externalId || source.title || source.id}`
    })), 'source')

    return {
      ambiguous: {
        token,
        candidates: candidateList
      } satisfies AmbiguousReference
    }
  }

  return {
    unresolved: {
      token,
      reason: 'not_found'
    } satisfies UnresolvedReference
  }
}

export async function resolveReferences(tokens: ReferenceToken[], context: ResolveContext): Promise<ReferenceResolutionResult> {
  const resolved: ResolvedReference[] = []
  const unresolved: UnresolvedReference[] = []
  const ambiguous: AmbiguousReference[] = []

  for (const token of tokens) {
    const identifier = token.identifier.trim()
    if (!identifier) {
      unresolved.push({ token, reason: 'invalid' })
      continue
    }

    const lowerIdentifier = identifier.toLowerCase()
    if (lowerIdentifier.startsWith('source:') || lowerIdentifier.startsWith('source/')) {
      const sourceIdentifier = identifier.replace(/^source[:/]/i, '')
      const result = await resolveSourceToken(token, context, sourceIdentifier)
      if (result.resolved) {
        resolved.push(result.resolved)
      }
      if (result.unresolved) {
        unresolved.push(result.unresolved)
      }
      if (result.ambiguous) {
        ambiguous.push(result.ambiguous)
      }
      continue
    }

    const prefersFile = identifier.includes('.')

    if (prefersFile) {
      const fileResult = await resolveFileToken(token, context)
      if (fileResult.resolved) {
        resolved.push(fileResult.resolved)
        continue
      }
      if (fileResult.ambiguous) {
        ambiguous.push(fileResult.ambiguous)
        continue
      }

      const contentResult = await resolveContentToken(token, context)
      if (contentResult.resolved) {
        resolved.push(contentResult.resolved)
      }
      if (contentResult.unresolved) {
        unresolved.push(contentResult.unresolved)
      }
      if (contentResult.ambiguous) {
        ambiguous.push(contentResult.ambiguous)
      }
      continue
    }

    const contentResult = await resolveContentToken(token, context)
    if (contentResult.resolved) {
      resolved.push(contentResult.resolved)
    }
    if (contentResult.ambiguous) {
      ambiguous.push(contentResult.ambiguous)
    }
    if (contentResult.resolved || contentResult.ambiguous) {
      continue
    }

    const fileResult = await resolveFileToken(token, context)
    if (fileResult.resolved) {
      resolved.push(fileResult.resolved)
    }
    if (fileResult.ambiguous) {
      ambiguous.push(fileResult.ambiguous)
    }
    // Prefer content unresolved (since prefersFile is false), fallback to file unresolved
    if (contentResult.unresolved) {
      unresolved.push(contentResult.unresolved)
    } else if (fileResult.unresolved) {
      unresolved.push(fileResult.unresolved)
    }
  }

  return { tokens, resolved, unresolved, ambiguous }
}

export const _testing = {
  selectBestMatch
}
