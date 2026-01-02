import type * as schema from '~~/server/db/schema'
import type { ContentSection } from './generation/types'
import { slugifyTitle } from '~~/server/utils/content'
import { buildStructuredDataGraph, renderStructuredDataJsonLd } from './generation/structured-data'
import { isValidContentFrontmatter } from './generation/utils'

export interface WorkspaceFilePayload {
  id: string
  filename: string
  body: string
  frontmatter: Record<string, any>
  wordCount: number
  sectionsCount: number
  seoSnapshot: Record<string, any> | null
  seoPlan: Record<string, any> | null
  frontmatterKeywords: string[]
  seoKeywords: string[]
  tags: string[]
  schemaTypes: string[]
  generatorDetails: Record<string, any> | null
  generatorStages: string[]
  sourceDetails: typeof schema.sourceContent.$inferSelect | null
  sourceLink: string | null
  fullMarkdown: string
  contentId: string
  slug: string
  structuredData: string | null
  structuredDataGraph: Record<string, any> | null
  diffStats?: { additions: number, deletions: number } | null
}

const safeSlug = (input?: string | null) => {
  const trimmed = input?.trim()
  if (!trimmed) {
    return null
  }
  try {
    return slugifyTitle(trimmed)
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }
}

const sanitizeSegment = (segment?: string | null) => {
  const slug = safeSlug(segment)
  if (!slug) {
    return null
  }
  const scrubbed = slug.replace(/\./g, '')
  if (!scrubbed) {
    return null
  }
  return scrubbed
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter((item): item is string => Boolean(item))
}

export function resolveContentFilePath(
  content: typeof schema.content.$inferSelect,
  version: typeof schema.contentVersion.$inferSelect,
  options?: { organizationSlug?: string | null }
) {
  const frontmatterSlug = typeof version.frontmatter?.slug === 'string' ? version.frontmatter.slug : ''
  const contentSlug = typeof content.slug === 'string' ? content.slug : ''
  const fallbackSlug = content.id || 'draft'

  const resolvedSlug =
    sanitizeSegment(frontmatterSlug)
    || sanitizeSegment(contentSlug)
    || sanitizeSegment(fallbackSlug)
    || 'draft'

  const segments = ['content']
  const orgSegment = sanitizeSegment(options?.organizationSlug)
  if (orgSegment) {
    segments.push(orgSegment)
  }
  segments.push(resolvedSlug)

  return `${segments.join('/')}.md`
}

function resolveSourceLink(
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  assets: typeof schema.contentVersion.$inferSelect['assets']
) {
  const metadata = sourceContent?.metadata as Record<string, any> | undefined
  if (metadata?.originalUrl) {
    return metadata.originalUrl
  }
  if (sourceContent?.sourceType === 'youtube' && sourceContent.externalId) {
    return `https://www.youtube.com/watch?v=${sourceContent.externalId}`
  }
  const assetSource = assets && typeof assets === 'object' ? (assets as any).source : null
  if (assetSource?.originalUrl) {
    return assetSource.originalUrl
  }
  return null
}

export function buildWorkspaceFilesPayload(
  content: typeof schema.content.$inferSelect,
  version: typeof schema.contentVersion.$inferSelect,
  sourceContent: typeof schema.sourceContent.$inferSelect | null,
  options?: {
    organizationSlug?: string | null
    baseUrl?: string | null
    author?: { name: string, url?: string, image?: string } | null
    publisher?: { name: string, url?: string, logoUrl?: string } | null
    breadcrumbs?: { name: string, item: string }[] | null
    blog?: { name?: string, url?: string } | null
    categories?: { name: string, slug?: string }[] | null
  }
): WorkspaceFilePayload[] {
  const body = version.bodyMarkdown || ''
  const sections = Array.isArray(version.sections) ? version.sections as ContentSection[] : []
  const frontmatter = version.frontmatter && typeof version.frontmatter === 'object'
    ? version.frontmatter as Record<string, any>
    : {}
  const seoSnapshot = version.seoSnapshot && typeof version.seoSnapshot === 'object'
    ? version.seoSnapshot as Record<string, any>
    : null
  const seoPlan = seoSnapshot && typeof seoSnapshot.plan === 'object' ? seoSnapshot.plan : null
  const generatorDetails = version.assets && typeof version.assets === 'object' ? (version.assets as any).generator ?? null : null
  const generatorStages = Array.isArray(generatorDetails?.stages)
    ? generatorDetails.stages.filter((stage: any) => typeof stage === 'string').map((stage: string) => stage.trim()).filter(Boolean)
    : []
  const filename = resolveContentFilePath(content, version, { organizationSlug: options?.organizationSlug })
  const frontmatterKeywords = normalizeStringArray(frontmatter.keywords || frontmatter.tags || [])
  const tags = normalizeStringArray(frontmatter.tags)
  const schemaTypes = normalizeStringArray(frontmatter.schemaTypes)
  const seoKeywords = normalizeStringArray(seoPlan?.keywords)
  const wordCount = sections.reduce((total, section: any) => {
    const count = typeof section?.wordCount === 'number' ? section.wordCount : Number(section?.wordCount) || 0
    return total + count
  }, 0) || body.split(/\s+/).filter(Boolean).length

  const fullMarkdown = body

  const structuredDataGraph = isValidContentFrontmatter(frontmatter)
    ? buildStructuredDataGraph({
        frontmatter,
        seoSnapshot,
        sections,
        baseUrl: options?.baseUrl ?? undefined,
        contentId: content.id,
        author: options?.author ?? null,
        publisher: options?.publisher ?? null,
        breadcrumbs: options?.breadcrumbs ?? null,
        blog: options?.blog ?? null,
        categories: options?.categories ?? null,
        datePublished: content.publishedAt ?? version.createdAt ?? null,
        dateModified: content.updatedAt ?? version.createdAt ?? null
      })
    : null

  const structuredData = structuredDataGraph
    ? renderStructuredDataJsonLd(structuredDataGraph)
    : null

  // Extract slug from filename or use content slug
  const filenameSlug = filename.replace(/^content\/([^/]+\/)?/, '').replace(/\.md$/, '')
  const contentSlug = typeof content.slug === 'string' ? content.slug : filenameSlug

  // Extract diff stats from frontmatter if available
  const frontmatterDiff = frontmatter?.diffStats as { additions?: number, deletions?: number } | undefined
  const diffStats = frontmatterDiff && (frontmatterDiff.additions !== undefined || frontmatterDiff.deletions !== undefined)
    ? {
        additions: frontmatterDiff.additions !== undefined ? Number(frontmatterDiff.additions) || 0 : 0,
        deletions: frontmatterDiff.deletions !== undefined ? Number(frontmatterDiff.deletions) || 0 : 0
      }
    : null

  return [
    {
      id: version.id || filename,
      filename,
      body,
      frontmatter,
      wordCount,
      sectionsCount: sections.length,
      seoSnapshot,
      seoPlan,
      frontmatterKeywords,
      seoKeywords,
      tags,
      schemaTypes,
      generatorDetails,
      generatorStages,
      sourceDetails: sourceContent,
      sourceLink: resolveSourceLink(sourceContent, version.assets),
      fullMarkdown,
      contentId: content.id,
      slug: contentSlug,
      structuredData,
      structuredDataGraph,
      diffStats
    }
  ]
}
