import type { AmbiguousReference, ReferenceContent, UnresolvedReference } from './types'

const formatList = (items: string[]) => items.map(item => `- ${item}`).join('\n')

export function buildContextBlock(params: {
  referenceContents: ReferenceContent[]
  ambiguous?: AmbiguousReference[]
  unresolved?: UnresolvedReference[]
}): string | null {
  const { referenceContents, ambiguous = [], unresolved = [] } = params

  if (!referenceContents.length && !ambiguous.length && !unresolved.length) {
    return null
  }

  const blocks: string[] = []

  blocks.push('## Referenced Context (resolved from @ mentions)')
  blocks.push('Scope Contract: Edits are allowed ONLY on referenced entities. Everything else is read-only.')

  if (ambiguous.length) {
    blocks.push('Some references were ambiguous; ask the user to clarify.')
  }

  for (const ref of referenceContents) {
    if (ref.type === 'file') {
      const meta = ref.metadata
      const header = `### File: ${meta.fileName || meta.originalName}`
      const details = [
        `- ID: ${meta.id}`,
        `- Type: ${meta.fileType || 'unknown'} (${meta.mimeType || 'unknown'})`,
        `- Size: ${meta.size} bytes`,
        `- URL: ${meta.url}`
      ]
      const isImage = meta.fileType === 'image' || (meta.mimeType || '').startsWith('image/')
      if (isImage) {
        details.push(`- Hint: Use insert_image with fileId "${meta.id}" to place this image in content.`)
      }
      if (ref.textContent) {
        details.push(`- Text preview${ref.truncated ? ' (truncated)' : ''}:\n\n\`\`\`\n${ref.textContent}\n\`\`\``)
      }
      blocks.push(header)
      blocks.push(details.join('\n'))
    }

    if (ref.type === 'content') {
      const meta = ref.metadata
      const header = `### Content: ${meta.slug}`
      const details = [
        `- ID: ${meta.id}`,
        `- Title: ${meta.title}`,
        `- Status: ${meta.status}`
      ]
      if (ref.frontmatterSummary && Object.keys(ref.frontmatterSummary).length > 0) {
        details.push(`- Frontmatter: ${JSON.stringify(ref.frontmatterSummary)}`)
      }
      if (ref.sectionsSummary.length) {
        const sectionList = ref.sectionsSummary.map((section) => {
          const label = section.title || section.type || section.id
          return `[${section.index ?? ''}] ${label} (id: ${section.id})`
        })
        details.push(`- Sections:\n${formatList(sectionList)}`)
      }
      blocks.push(header)
      blocks.push(details.join('\n'))
    }

    if (ref.type === 'section') {
      const meta = ref.metadata
      const header = `### Section: ${meta.contentSlug}#${meta.sectionId}`
      const details = [
        `- Content ID: ${meta.contentId}`,
        `- Content: ${meta.contentTitle}`,
        `- Title: ${meta.title || meta.type || 'Untitled section'}`,
        `- Index: ${meta.index ?? 'n/a'}`,
        `- Body:\n\n\`\`\`\n${ref.body || ''}\n\`\`\``
      ]
      blocks.push(header)
      blocks.push(details.join('\n'))
    }

    if (ref.type === 'source') {
      const meta = ref.metadata
      const header = `### Source: ${meta.title || 'Untitled source'}`
      const details = [
        `- ID: ${meta.id}`,
        `- Type: ${meta.sourceType || 'unknown'}`
      ]
      if (ref.textContent) {
        details.push(`- Text excerpt${ref.truncated ? ' (truncated)' : ''}:\n\n\`\`\`\n${ref.textContent}\n\`\`\``)
      }
      blocks.push(header)
      blocks.push(details.join('\n'))
    }
  }

  if (ambiguous.length) {
    blocks.push('### Ambiguous references')
    const list = ambiguous.map((item) => {
      const options = item.candidates.map(candidate => `${candidate.label}${candidate.subtitle ? ` (${candidate.subtitle})` : ''}`).join(', ')
      return `${item.token.raw}: ${options}`
    })
    blocks.push(formatList(list))
  }

  if (unresolved.length) {
    blocks.push('### Unresolved references')
    const list = unresolved.map((item) => {
      const suggestionText = item.suggestions?.length
        ? ` Suggestions: ${item.suggestions.map(suggestion => suggestion.label).join(', ')}`
        : ''
      return `${item.token.raw}: ${item.reason}${suggestionText}`
    })
    blocks.push(formatList(list))
  }

  return blocks.join('\n\n')
}
