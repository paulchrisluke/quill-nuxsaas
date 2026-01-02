import type { ContentSection, ImageSuggestion } from './types'

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
      endOffset: startOffset + blockWithPadding.length
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
