import { createError } from 'h3'

const INDENT = 2
const SIMPLE_STRING_RE = /^[\w .-]+$/

const preferredFrontmatterOrder = [
  'title',
  'slug',
  'description',
  'desc',
  'author',
  'authorImage',
  'image',
  'videoUrl',
  'alt',
  'createdAt',
  'updatedAt',
  'tags',
  'keywords',
  'categories',
  'schemaTypes',
  'contentType',
  'status',
  'primaryKeyword',
  'targetLocale',
  'faq',
  'recipe',
  'howTo',
  'course'
]

const indentLines = (value: string, spaces: number) => {
  const pad = ' '.repeat(spaces)
  return value
    .split('\n')
    .map(line => (line.length ? `${pad}${line}` : line))
    .join('\n')
}

const quoteString = (value: string) => {
  const escaped = value.replace(/'/g, '\'\'')
  return `'${escaped}'`
}

const formatString = (value: string, indent: number) => {
  if (value.includes('\n')) {
    const block = value.replace(/\r\n/g, '\n')
    return `|\n${indentLines(block, indent + INDENT)}`
  }
  if (value === '') {
    return '\'\''
  }
  if (SIMPLE_STRING_RE.test(value.trim()) && value.trim() === value) {
    return value
  }
  return quoteString(value)
}

const normalizeObject = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map(entry => normalizeObject(entry))
      .filter(entry => entry !== undefined)
  }
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = normalizeObject(entry)
      if (cleaned !== undefined) {
        normalized[key] = cleaned
      }
    }
    return normalized
  }
  if (value === undefined) {
    return undefined
  }
  return value
}

const sortKeys = (value: Record<string, unknown>) => {
  const ordered = new Map<string, unknown>()
  for (const key of preferredFrontmatterOrder) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      ordered.set(key, value[key])
    }
  }
  const remaining = Object.keys(value)
    .filter(key => !ordered.has(key))
    .sort((a, b) => a.localeCompare(b))
  for (const key of remaining) {
    ordered.set(key, value[key])
  }
  return Array.from(ordered.entries())
}

const serializeYamlValue = (value: unknown, indent: number): string => {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return formatString(value, indent)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]'
    }
    const lines: string[] = []
    const pad = ' '.repeat(indent)
    for (const entry of value) {
      const serialized = serializeYamlValue(entry, indent + INDENT)
      if (serialized.includes('\n')) {
        lines.push(`${pad}-`)
        lines.push(indentLines(serialized, indent + INDENT))
      } else {
        lines.push(`${pad}- ${serialized}`)
      }
    }
    return lines.join('\n')
  }
  if (value && typeof value === 'object') {
    const entries = sortKeys(value as Record<string, unknown>)
    if (entries.length === 0) {
      return '{}'
    }
    const lines: string[] = []
    const pad = ' '.repeat(indent)
    for (const [key, entry] of entries) {
      const serialized = serializeYamlValue(entry, indent + INDENT)
      if (serialized.includes('\n')) {
        lines.push(`${pad}${key}:`)
        lines.push(indentLines(serialized, indent + INDENT))
      } else {
        lines.push(`${pad}${key}: ${serialized}`)
      }
    }
    return lines.join('\n')
  }
  return quoteString(String(value))
}

export const serializeFrontmatterMarkdown = (
  frontmatter: Record<string, any> | null | undefined,
  bodyMarkdown: string
) => {
  const normalized = normalizeObject(frontmatter ?? {})
  if (!normalized || typeof normalized !== 'object') {
    throw createError({
      statusCode: 500,
      statusMessage: 'Invalid frontmatter payload'
    })
  }
  const entries = Object.keys(normalized as Record<string, unknown>)
  if (entries.length === 0) {
    return bodyMarkdown || ''
  }
  const yaml = serializeYamlValue(normalized, 0)
  const body = bodyMarkdown || ''
  const separator = body.startsWith('\n') ? '' : '\n'
  return `---\n${yaml}\n---${separator}${body}`
}

export const buildContentJsonExport = (payload: {
  content: { id: string, slug: string, title: string, status: string, contentType: string, publishedAt: Date | null, updatedAt: Date }
  version: { id: string, contentId: string, version: number, createdAt: Date, frontmatter: Record<string, any> | null, bodyMarkdown: string }
  filePayload: {
    wordCount: number
    sectionsCount: number
    schemaTypes: string[]
    tags: string[]
    seoKeywords: string[]
    frontmatter: Record<string, any>
    structuredData: string | null
    structuredDataGraph: Record<string, any> | null
    sourceLink?: string | null
    slug: string
  }
  author?: { name: string, url?: string, image?: string } | null
  publisher?: { name: string, url?: string, logoUrl?: string } | null
}) => {
  return {
    id: payload.content.id,
    slug: payload.filePayload.slug || payload.content.slug,
    title: payload.content.title,
    status: payload.content.status,
    contentType: payload.content.contentType,
    publishedAt: payload.content.publishedAt,
    updatedAt: payload.content.updatedAt,
    version: {
      id: payload.version.id,
      number: payload.version.version,
      createdAt: payload.version.createdAt
    },
    frontmatter: payload.version.frontmatter ?? payload.filePayload.frontmatter ?? {},
    bodyMarkdown: payload.version.bodyMarkdown,
    wordCount: payload.filePayload.wordCount,
    sectionsCount: payload.filePayload.sectionsCount,
    tags: payload.filePayload.tags,
    keywords: payload.filePayload.seoKeywords,
    schemaTypes: payload.filePayload.schemaTypes,
    structuredData: payload.filePayload.structuredData,
    structuredDataGraph: payload.filePayload.structuredDataGraph,
    sourceLink: payload.filePayload.sourceLink ?? null,
    author: payload.author ?? null,
    publisher: payload.publisher ?? null
  }
}
