import type { ContentFrontmatter, ContentSection, ImageSuggestion } from './types'
import { formatFrontmatterAsYaml } from './frontmatter'
import { generateStructuredDataJsonLd } from './structured-data'

/**
 * Extracts raw markdown from enriched MDX by stripping frontmatter and JSON-LD
 */
export const extractMarkdownFromEnrichedMdx = (enrichedMdx: string): string => {
  const trimmed = enrichedMdx.trim()

  // If it doesn't start with '---', it's not enriched, return as-is
  if (!trimmed.startsWith('---')) {
    return trimmed
  }

  // Find the end of frontmatter block (second '---' at start of line)
  // Use regex to match delimiter only when it appears alone at the start of a line
  // This avoids misidentifying occurrences inside multi-line YAML strings
  const frontmatterDelimiterRegex = /^---\s*$/m
  const match = trimmed.slice(3).match(frontmatterDelimiterRegex)
  if (!match) {
    // No closing frontmatter, return as-is
    return trimmed
  }
  // match.index is relative to trimmed.slice(3), so add 3 to get position in trimmed
  // match[0] includes the full delimiter line (--- plus optional whitespace)
  const delimiterLineStart = match.index! + 3
  const delimiterLineEnd = delimiterLineStart + match[0].length

  // Extract content after frontmatter
  // Content starts after the delimiter line (which ends with a newline)
  let contentStart = delimiterLineEnd
  // Skip optional Windows line endings or trailing newline
  if (trimmed[contentStart] === '\r') {
    contentStart += 1
  }
  if (trimmed[contentStart] === '\n') {
    contentStart += 1
  }
  let content = trimmed.substring(contentStart).trim()

  // Check if there's a JSON-LD script tag and remove it
  const jsonLdStart = content.indexOf('<script type="application/ld+json">')
  if (jsonLdStart !== -1) {
    const jsonLdEnd = content.indexOf('</script>', jsonLdStart)
    if (jsonLdEnd !== -1) {
      // Remove JSON-LD block and any surrounding whitespace
      const before = content.substring(0, jsonLdStart).trim()
      const after = content.substring(jsonLdEnd + 9).trim()
      content = [before, after].filter(Boolean).join('\n\n')
    }
  }

  return content.trim()
}

/**
 * Enriches markdown with frontmatter and JSON-LD structured data
 */
export const enrichMarkdownWithMetadata = (params: {
  markdown: string
  frontmatter: ContentFrontmatter
  seoSnapshot: Record<string, any> | null
  baseUrl?: string
  sections?: ContentSection[] | null
}): string => {
  const { markdown, frontmatter, seoSnapshot, baseUrl, sections } = params

  // Extract raw markdown if already enriched
  const rawMarkdown = extractMarkdownFromEnrichedMdx(markdown)

  const frontmatterBlock = formatFrontmatterAsYaml(frontmatter)
  const jsonLd = generateStructuredDataJsonLd({ frontmatter, seoSnapshot, baseUrl, sections })

  const parts: string[] = [frontmatterBlock]
  if (jsonLd) {
    parts.push(jsonLd)
  }
  parts.push(rawMarkdown)

  return parts.filter(part => part.trim().length > 0).join('\n\n')
}

/**
 * Inserts image suggestion comments into markdown at their specified positions
 * Skips suggestions that are already inserted (status === 'added')
 */
export const insertImageSuggestionComments = (
  markdown: string,
  suggestions: ImageSuggestion[]
): string => {
  if (!suggestions || suggestions.length === 0) {
    return markdown
  }

  // Filter out already inserted suggestions and check if markdown already has comments
  const pendingSuggestions = suggestions.filter(s => s.status !== 'added')
  if (pendingSuggestions.length === 0) {
    return markdown
  }

  // Check if markdown already contains image suggestion comments to avoid duplicates
  const hasExistingComments = markdown.includes('<!-- IMAGE SUGGESTION:')
  if (hasExistingComments) {
    // Comments already exist, don't add duplicates
    return markdown
  }

  // Sort suggestions by position (descending) so we can insert from bottom to top
  // This prevents line number shifts from affecting subsequent insertions
  const sortedSuggestions = [...pendingSuggestions]
    .filter(s => typeof s.position === 'number' && Number.isFinite(s.position))
    .sort((a, b) => (b.position || 0) - (a.position || 0))

  const lines = markdown.split('\n')

  for (const suggestion of sortedSuggestions) {
    const position = Math.max(1, Math.min(suggestion.position || 1, lines.length + 1))
    const insertIndex = position - 1 // Convert to 0-based index

    // Build comment with suggestion details
    const commentParts: string[] = []
    commentParts.push(`<!-- IMAGE SUGGESTION:`)
    commentParts.push(`  Alt: ${suggestion.altText || 'Image'}`)
    if (suggestion.reason) {
      commentParts.push(`  Reason: ${suggestion.reason}`)
    }
    commentParts.push(`  Priority: ${suggestion.priority || 'medium'}`)
    if (suggestion.type === 'screencap' && suggestion.videoId) {
      commentParts.push(`  Type: Screencap from YouTube video`)
      if (suggestion.estimatedTimestamp !== null && suggestion.estimatedTimestamp !== undefined) {
        const minutes = Math.floor(suggestion.estimatedTimestamp / 60)
        const seconds = Math.floor(suggestion.estimatedTimestamp % 60)
        commentParts.push(`  Timestamp: ${minutes}:${seconds.toString().padStart(2, '0')}`)
      }
    } else if (suggestion.type === 'uploaded') {
      commentParts.push(`  Type: Uploaded image`)
      if (suggestion.fullSizeFileId) {
        commentParts.push(`  File ID: ${suggestion.fullSizeFileId}`)
      }
    } else if (suggestion.type === 'generated') {
      commentParts.push(`  Type: Generated image`)
    }
    commentParts.push(`-->`)

    const comment = commentParts.join('\n')

    // Insert comment before the line at the specified position
    lines.splice(insertIndex, 0, comment)
  }

  return lines.join('\n')
}

export const assembleMarkdownFromSections = (params: {
  frontmatter: ContentFrontmatter
  sections: ContentSection[]
}) => {
  const ordered = [...params.sections].sort((a, b) => a.index - b.index)
  let markdown = `# ${params.frontmatter.title}\n\n`
  let currentOffset = markdown.length

  const sectionsWithOffsets = ordered.map((section) => {
    const level = Math.min(Math.max(section.level || 2, 2), 6)
    const headingLine = section.title ? `${'#'.repeat(level)} ${section.title}` : ''
    const pieces = [headingLine, section.body.trim()].filter(Boolean)
    const block = pieces.join('\n\n')
    const blockWithPadding = `${block}\n\n`
    const startOffset = currentOffset
    markdown += blockWithPadding
    currentOffset = markdown.length

    return {
      ...section,
      startOffset,
      endOffset: startOffset + blockWithPadding.length,
      body_mdx: section.body
    }
  })

  const trimmedMarkdown = markdown.trimEnd()
  markdown = `${trimmedMarkdown}\n`

  // Adjust final section's endOffset if it extended into trimmed area
  if (sectionsWithOffsets.length > 0) {
    const last = sectionsWithOffsets[sectionsWithOffsets.length - 1]
    last.endOffset = Math.min(last.endOffset, markdown.length)
  }

  return {
    markdown,
    sections: sectionsWithOffsets
  }
}
