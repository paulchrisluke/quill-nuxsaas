import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ContentSection, ImageSuggestion } from './types'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { useFileManagerConfig } from '~~/server/services/file/fileService'
import { clamp, insertHtmlAtLine, insertMarkdownAtLine } from './utils'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const findHeadingLine = (markdown: string, sectionTitle: string | null | undefined): number | null => {
  if (!sectionTitle) {
    return null
  }
  const normalizedTitle = sectionTitle.trim().toLowerCase()
  if (!normalizedTitle) {
    return null
  }

  const lines = markdown.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index] || ''
    const trimmed = rawLine.trim()
    if (!trimmed.startsWith('#')) {
      continue
    }
    const headingText = trimmed.replace(/^#+\s*/, '').trim().toLowerCase()
    if (headingText.includes(normalizedTitle) || normalizedTitle.includes(headingText)) {
      return index + 1
    }
  }
  return null
}

const deriveAltText = (preferredAlt?: string | null, fallbackName?: string | null) => {
  if (preferredAlt && preferredAlt.trim()) {
    return preferredAlt.trim()
  }
  if (!fallbackName) {
    return 'Image'
  }
  const withoutExtension = fallbackName.replace(/\.[^/.]+$/, '')
  const normalized = withoutExtension.trim()
  return normalized || 'Image'
}

const isUuidLike = (value: string) => UUID_REGEX.test(value.trim())

/**
 * Escapes special characters in markdown alt text that would break the syntax
 * Escapes: '[', ']', and backslashes
 */
const escapeMarkdownAltText = (altText: string): string => {
  return altText
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/\[/g, '\\[') // Escape opening brackets
    .replace(/\]/g, '\\]') // Escape closing brackets
}

/**
 * Sanitizes a URL for use in markdown image syntax
 * Escapes any existing angle brackets in the URL, then wraps the URL in angle brackets
 * to prevent issues with special characters like ')'
 * This is the most reliable approach for markdown URLs
 */
const sanitizeMarkdownUrl = (url: string): string => {
  // First escape any existing '<' and '>' characters by percent-encoding them
  // This prevents breaking markdown syntax when URLs contain these characters
  const escapedUrl = url
    .replace(/</g, '%3C') // Percent-encode '<'
    .replace(/>/g, '%3E') // Percent-encode '>'

  // Then wrap in angle brackets to safely handle other special characters
  return `<${escapedUrl}>`
}

const ALLOWED_IMAGE_PROTOCOLS = new Set(['http:', 'https:'])
const DATA_URI_IMAGE_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i

const escapeHtmlAttribute = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s/g, (match) => {
      if (match === ' ')
        return '&#32;'
      if (match === '\t')
        return '&#9;'
      if (match === '\n')
        return '&#10;'
      if (match === '\r')
        return '&#13;'
      return ''
    })
}

const validateImageUrl = (rawUrl: string): string => {
  const trimmed = (rawUrl || '').trim()

  if (!trimmed) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Image URL is invalid or empty'
    })
  }

  if (trimmed.toLowerCase().startsWith('data:')) {
    if (!DATA_URI_IMAGE_PATTERN.test(trimmed)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Only data:image/* URLs are allowed for inline images'
      })
    }
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (!ALLOWED_IMAGE_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`)
    }
    return parsed.toString()
  } catch {
    if (trimmed.startsWith('/')) {
      return trimmed
    }
    throw createError({
      statusCode: 400,
      statusMessage: 'Image URL is invalid or uses an unsupported scheme'
    })
  }
}

const resolveSectionByKeyword = (keyword: string, sections: ContentSection[]) => {
  const lowerKeyword = keyword.toLowerCase()
  return sections.find((section) => {
    const title = section.title || (section as any).section_title
    return typeof title === 'string' && title.trim().toLowerCase().includes(lowerKeyword)
  }) || null
}

const resolveSectionByPhrase = (phrase: string, sections: ContentSection[]) => {
  const lowerPhrase = phrase.toLowerCase()
  let bestMatch: ContentSection | null = null
  let bestScore = 0

  for (const section of sections) {
    const title = typeof section.title === 'string' ? section.title : (section as any).section_title
    if (!title) {
      continue
    }
    const normalizedTitle = title.trim().toLowerCase()
    const exactMatch = lowerPhrase.includes(normalizedTitle) || normalizedTitle.includes(lowerPhrase)
    if (exactMatch) {
      return section
    }
    const overlap = normalizedTitle.split(/\s+/).filter((word: string) => lowerPhrase.includes(word)).length
    if (overlap > bestScore) {
      bestScore = overlap
      bestMatch = section
    }
  }

  return bestMatch
}

const resolvePosition = (params: {
  position: string | number | null | undefined
  markdown: string
  sections: ContentSection[]
}): { lineNumber: number, sectionId: string | null, reason?: string } => {
  const { position, markdown, sections } = params
  const lines = markdown.split('\n')
  const maxLine = lines.length + 1

  // Numeric input or numeric string
  if (typeof position === 'number' && Number.isFinite(position)) {
    const lineNumber = clamp(Math.floor(position), 1, maxLine)
    return { lineNumber, sectionId: null, reason: 'User provided line number' }
  }

  if (typeof position === 'string' && position.trim()) {
    const trimmed = position.trim()
    const numericValue = Number(trimmed)
    if (Number.isFinite(numericValue)) {
      const lineNumber = clamp(Math.floor(numericValue), 1, maxLine)
      return { lineNumber, sectionId: null, reason: 'User provided numeric position' }
    }

    // Section ID handling
    if (isUuidLike(trimmed)) {
      const targetSection = sections.find(section => section.id === trimmed || (section as any).section_id === trimmed) || null
      const headingLine = targetSection ? findHeadingLine(markdown, targetSection.title || (targetSection as any).section_title) : null
      const lineNumber = headingLine ? clamp(headingLine, 1, maxLine) : maxLine
      return {
        lineNumber,
        sectionId: targetSection?.id ?? (targetSection as any)?.section_id ?? trimmed,
        reason: targetSection ? `Matched sectionId ${trimmed}` : 'Position looked like a UUID; inserting near end'
      }
    }

    const normalizedPhrase = trimmed.toLowerCase()
    const prefersAfter = /\b(?:after|below|under|following)\b/.test(normalizedPhrase)
    const prefersStart = /\b(?:featured|hero|cover|top|start|beginning)\b/.test(normalizedPhrase)
    const prefersEnd = /\b(?:conclusion|summary|wrap-up|wrap up|final|ending)\b/.test(normalizedPhrase)

    // Keyword shortcuts
    const keywordSection = prefersEnd
      ? resolveSectionByKeyword('conclusion', sections)
      : prefersStart
        ? resolveSectionByKeyword('introduction', sections) || resolveSectionByKeyword('summary', sections)
        : null

    const matchedSection = keywordSection || resolveSectionByPhrase(trimmed, sections)
    if (matchedSection) {
      const headingLine = findHeadingLine(markdown, matchedSection.title || (matchedSection as any).section_title)
      const fallbackLine = Math.max(1, Math.round(maxLine * (matchedSection.index !== undefined ? matchedSection.index + 1 : sections.indexOf(matchedSection) + 1) / Math.max(sections.length, 1)))
      const baseLine = headingLine ?? fallbackLine
      const lineNumber = clamp(prefersAfter ? baseLine + 1 : baseLine, 1, maxLine)
      return {
        lineNumber,
        sectionId: matchedSection.id || (matchedSection as any).section_id || null,
        reason: `Matched phrase "${trimmed}" to section "${matchedSection.title || (matchedSection as any).section_title || 'unknown'}"`
      }
    }

    if (prefersStart) {
      return { lineNumber: 1, sectionId: sections[0]?.id ?? null, reason: 'Interpreted as featured/intro position' }
    }

    if (prefersEnd) {
      return { lineNumber: maxLine, sectionId: sections[sections.length - 1]?.id ?? null, reason: 'Interpreted as end/conclusion position' }
    }

    // Natural language fallback
    const midpoint = clamp(Math.round(maxLine / 2), 1, maxLine)
    return { lineNumber: midpoint, sectionId: sections[0]?.id ?? null, reason: `Could not resolve phrase "${trimmed}", inserting near middle` }
  }

  // Default: append to end
  return { lineNumber: maxLine, sectionId: sections[sections.length - 1]?.id ?? null, reason: 'Defaulted to end of content' }
}

export const insertUploadedImage = async (
  db: NodePgDatabase<typeof schema>,
  params: {
    organizationId: string
    userId: string
    contentId: string
    fileId: string
    position?: string | number | null
    altText?: string | null
  }
) => {
  const { organizationId, userId, contentId, fileId, position, altText } = params
  const config = useFileManagerConfig()

  const [contentRecord] = await db
    .select({
      content: schema.content,
      version: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, contentId)
    ))
    .limit(1)

  if (!contentRecord || !contentRecord.content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  if (!contentRecord.version) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content has no current version to update'
    })
  }

  const version = contentRecord.version

  const [fileRecord] = await db
    .select()
    .from(schema.file)
    .where(and(
      eq(schema.file.id, fileId),
      eq(schema.file.organizationId, organizationId),
      eq(schema.file.isActive, true)
    ))
    .limit(1)

  if (!fileRecord) {
    throw createError({
      statusCode: 404,
      statusMessage: 'File not found for this organization'
    })
  }

  // Validate file ownership: if file has a contentId, it must match the target contentId
  if (fileRecord.contentId && fileRecord.contentId !== contentId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'File belongs to a different content and cannot be inserted here'
    })
  }

  if (fileRecord.fileType !== 'image' || !fileRecord.mimeType?.startsWith('image/')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Only image files can be inserted'
    })
  }

  const assets = (version.assets || {}) as Record<string, any>
  const imageSuggestions = Array.isArray((assets as any).imageSuggestions)
    ? (assets as any).imageSuggestions as ImageSuggestion[]
    : []
  const sections = Array.isArray(version.sections)
    ? version.sections as ContentSection[]
    : []

  // Detect content format: prefer MDX, fall back to HTML
  const hasMdx = !!version.bodyMdx
  const hasHtml = !!version.bodyHtml
  const contentBody = version.bodyMdx || version.bodyHtml || ''
  const isHtmlFormat = !hasMdx && hasHtml

  if (!contentBody) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content has no body content to insert image into'
    })
  }

  const resolvedPosition = resolvePosition({
    position: position ?? null,
    markdown: contentBody, // resolvePosition works with both MDX and HTML (line-based)
    sections
  })

  const imageUrl = fileRecord.url || fileRecord.path
  if (!imageUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'File is missing a URL or storage path'
    })
  }
  const safeImageUrl = validateImageUrl(imageUrl)

  const warnings: string[] = []
  let resolvedAltText = altText?.trim() || ''
  if (!resolvedAltText) {
    if (config.image?.requireAltText) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Alt text is required for uploaded images'
      })
    }
    const placeholder = (config.image?.altTextPlaceholder || '').trim()
    resolvedAltText = placeholder || deriveAltText(undefined, fileRecord.originalName)
    if (placeholder) {
      warnings.push('Alt text was missing; inserted placeholder text.')
    }
  }

  const suggestion: ImageSuggestion = {
    sectionId: resolvedPosition.sectionId || sections[0]?.id || 'content-body',
    position: resolvedPosition.lineNumber,
    altText: deriveAltText(resolvedAltText, fileRecord.originalName),
    reason: resolvedPosition.reason || 'User requested an uploaded image',
    priority: 'medium',
    type: 'uploaded',
    fullSizeFileId: fileRecord.id,
    fullSizeUrl: safeImageUrl,
    status: 'added'
  }

  // Insert image using appropriate format
  let updatedBody: string
  if (isHtmlFormat) {
    // Insert HTML <img> tag for HTML content
    const safeAltText = escapeHtmlAttribute(suggestion.altText ?? '')
    const dimensions = fileRecord.width && fileRecord.height
      ? ` width="${fileRecord.width}" height="${fileRecord.height}"`
      : ''
    const htmlImage = `<img src="${escapeHtmlAttribute(safeImageUrl)}" alt="${safeAltText}"${dimensions} loading="lazy" decoding="async" />`
    updatedBody = insertHtmlAtLine(contentBody, resolvedPosition.lineNumber, htmlImage)
  } else {
    // Insert Markdown image syntax for MDX content
    // Escape alt text and sanitize URL to prevent markdown syntax breaking
    const escapedAltText = escapeMarkdownAltText(suggestion.altText)
    const sanitizedUrl = sanitizeMarkdownUrl(safeImageUrl)
    const markdownImage = `![${escapedAltText}](${sanitizedUrl})`
    updatedBody = insertMarkdownAtLine(contentBody, resolvedPosition.lineNumber, markdownImage)
  }

  const updatedSuggestions = [...imageSuggestions, suggestion]

  const updatedAssets = {
    ...assets,
    imageSuggestions: updatedSuggestions,
    generator: assets.generator
      ? {
          ...(assets.generator as Record<string, any>),
          stages: Array.isArray((assets.generator as any).stages)
            ? [...new Set([...(assets.generator as any).stages, 'image_insert'])]
            : ['image_insert']
        }
      : {
          engine: 'codex-pipeline',
          generatedAt: new Date().toISOString(),
          stages: ['image_insert']
        }
  }

  const result = await db.transaction(async (tx) => {
    const [currentContent] = await tx
      .select({ currentVersionId: schema.content.currentVersionId })
      .from(schema.content)
      .where(eq(schema.content.id, contentRecord.content.id))
      .limit(1)

    if (currentContent?.currentVersionId !== version.id) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Content was modified by another process. Please retry.'
      })
    }

    const [latestVersion] = await tx
      .select({ version: schema.contentVersion.version })
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.contentId, contentRecord.content.id))
      .orderBy(desc(schema.contentVersion.version))
      .limit(1)

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1

    const [newVersion] = await tx
      .insert(schema.contentVersion)
      .values({
        id: uuidv7(),
        contentId: contentRecord.content.id,
        version: nextVersionNumber,
        createdByUserId: userId,
        frontmatter: version.frontmatter,
        bodyMdx: isHtmlFormat ? version.bodyMdx : updatedBody,
        bodyHtml: isHtmlFormat ? updatedBody : version.bodyHtml,
        sections: version.sections,
        assets: updatedAssets,
        seoSnapshot: version.seoSnapshot
      })
      .returning()

    if (!newVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create updated content version'
      })
    }

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, contentRecord.content.id))
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

  return {
    content: result.content,
    version: result.version,
    markdown: isHtmlFormat ? null : updatedBody,
    html: isHtmlFormat ? updatedBody : null,
    suggestion,
    warnings
  }
}
