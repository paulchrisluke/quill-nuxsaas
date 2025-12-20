import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ContentBodyUpdateInput, ContentBodyUpdateResult, ContentSection } from './types'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { slugifyTitle } from '~~/server/utils/content'
import { calculateDiffStats } from '../diff'
import { invalidateWorkspaceCache } from '../workspaceCache'
import { extractMarkdownFromEnrichedMdx } from './assembly'
import { extractFrontmatterFromVersion } from './frontmatter'
import { deriveSchemaMetadata, validateSchemaMetadata } from './schemaMetadata'
import { normalizeContentSections } from './sections'
import { countWords } from './utils'

const HEADING_REGEX = /^(#{2,6})\s+(\S.*)$/

const normalizeTitleKey = (title: string) => title.trim().toLowerCase()

const buildExistingSectionMap = (sections: ContentSection[]) => {
  const map = new Map<string, ContentSection[]>()
  sections.forEach((section) => {
    const key = normalizeTitleKey(section.title || '')
    if (!key) {
      return
    }
    const existing = map.get(key) || []
    existing.push(section)
    map.set(key, existing)
  })
  return map
}

export const parseSectionsFromMarkdown = (params: {
  markdown: string
  existingSections?: ContentSection[]
}): ContentSection[] => {
  const raw = extractMarkdownFromEnrichedMdx(params.markdown || '')
  const lines = raw.split('\n')
  const sections: Array<{
    title: string
    level: number
    bodyLines: string[]
  }> = []

  let introLines: string[] = []
  let current: { title: string, level: number, bodyLines: string[] } | null = null

  for (const line of lines) {
    const match = line.match(HEADING_REGEX)
    if (match) {
      if (current) {
        sections.push(current)
      } else if (introLines.length) {
        sections.push({
          title: '',
          level: 2,
          bodyLines: introLines
        })
      }
      introLines = []
      current = {
        title: match[2]?.trim() || '',
        level: match[1].length,
        bodyLines: []
      }
      continue
    }

    if (current) {
      current.bodyLines.push(line)
    } else {
      introLines.push(line)
    }
  }

  if (current) {
    sections.push(current)
  } else if (introLines.length) {
    sections.push({
      title: '',
      level: 2,
      bodyLines: introLines
    })
  }

  const existingMap = buildExistingSectionMap(params.existingSections || [])

  return sections.map((section, index) => {
    const title = section.title || ''
    const body = section.bodyLines.join('\n').trim()
    const key = normalizeTitleKey(title)
    const existingMatch = key ? existingMap.get(key)?.shift() : undefined
    const id = existingMatch?.id || uuidv7()
    const level = Math.min(Math.max(section.level || 2, 2), 6)
    const anchor = title ? slugifyTitle(title) : `section-${index + 1}`
    const type = existingMatch?.type || (level >= 3 ? 'subsection' : (title ? 'body' : 'intro'))

    return {
      id,
      index,
      type,
      title,
      level,
      anchor,
      body,
      summary: existingMatch?.summary || null,
      wordCount: countWords(body),
      meta: existingMatch?.meta || {}
    }
  })
}

export const updateContentBodyManual = async (
  db: NodePgDatabase<typeof schema>,
  input: ContentBodyUpdateInput
): Promise<ContentBodyUpdateResult> => {
  const { organizationId, userId, contentId, markdown, mode } = input
  const rawMarkdown = extractMarkdownFromEnrichedMdx(markdown || '')

  if (mode === 'chat') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Writes are not allowed in chat mode'
    })
  }

  if (!organizationId || !userId || !contentId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'organization, user, and content context are required'
    })
  }

  if (!rawMarkdown.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'markdown is required to update content'
    })
  }

  const [record] = await db
    .select({
      content: schema.content,
      version: schema.contentVersion,
      sourceContent: schema.sourceContent
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, contentId)
    ))
    .limit(1)

  if (!record || !record.content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found for this organization'
    })
  }

  if (!record.version) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This draft has no version to update yet'
    })
  }

  const currentVersion = record.version
  const existingSections = normalizeContentSections(
    currentVersion.sections,
    currentVersion.bodyMdx ?? null
  )

  let frontmatter = extractFrontmatterFromVersion({
    content: record.content,
    version: currentVersion
  })

  const updatedSections = parseSectionsFromMarkdown({
    markdown: rawMarkdown,
    existingSections
  })

  frontmatter = deriveSchemaMetadata(frontmatter, updatedSections)
  const schemaValidation = validateSchemaMetadata(frontmatter)
  const diffStats = calculateDiffStats(currentVersion.bodyMdx || '', rawMarkdown)
  const slug = currentVersion.frontmatter?.slug || record.content.slug
  const previousSeoSnapshot = currentVersion.seoSnapshot ?? {}

  const existingAssets = (currentVersion.assets !== null && typeof currentVersion.assets === 'object')
    ? currentVersion.assets as Record<string, any>
    : {}

  const assets = {
    ...existingAssets,
    generator: {
      ...(existingAssets.generator || {}),
      engine: 'codex-pipeline',
      generatedAt: new Date().toISOString(),
      stages: ['manual_edit']
    }
  }

  const seoSnapshot = {
    ...previousSeoSnapshot,
    primaryKeyword: frontmatter.primaryKeyword,
    targetLocale: frontmatter.targetLocale,
    contentType: frontmatter.contentType,
    schemaTypes: frontmatter.schemaTypes,
    schemaValidation,
    manualEditAt: new Date().toISOString()
  }

  const result = await db.transaction(async (tx) => {
    const [latestVersion] = await tx
      .select({ version: schema.contentVersion.version })
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.contentId, record.content.id))
      .orderBy(desc(schema.contentVersion.version))
      .limit(1)

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1

    const [newVersion] = await tx
      .insert(schema.contentVersion)
      .values({
        id: uuidv7(),
        contentId: record.content.id,
        version: nextVersionNumber,
        createdByUserId: userId,
        frontmatter: {
          title: frontmatter.title,
          description: frontmatter.description ?? (currentVersion.frontmatter as Record<string, any> | null)?.description,
          slug,
          tags: frontmatter.tags,
          keywords: frontmatter.keywords,
          status: frontmatter.status,
          contentType: frontmatter.contentType,
          schemaTypes: frontmatter.schemaTypes,
          sourceContentId: frontmatter.sourceContentId,
          primaryKeyword: frontmatter.primaryKeyword,
          targetLocale: frontmatter.targetLocale,
          diffStats: {
            additions: diffStats.additions,
            deletions: diffStats.deletions
          }
        },
        bodyMdx: rawMarkdown,
        bodyHtml: null,
        sections: updatedSections,
        assets,
        seoSnapshot
      })
      .returning()

    if (!newVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create content version'
      })
    }

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, record.content.id))
      .returning()

    if (!updatedContent) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content record'
      })
    }

    return {
      content: updatedContent,
      version: newVersion
    }
  })

  try {
    invalidateWorkspaceCache(organizationId, result.content.id)
  } catch (error) {
    console.error('Failed to invalidate workspace cache', error)
  }

  return {
    content: result.content,
    version: result.version,
    markdown: rawMarkdown,
    diffStats
  }
}
