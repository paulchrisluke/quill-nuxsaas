import { slugifyTitle } from '~~/server/utils/content'
import { calculateDiffStats, calculateLineRange } from '../diff'

export interface EditOp {
  type: 'replace' | 'insert' | 'delete' | 'format'
  anchor: string
  scope?: string
  oldText?: string
  newText?: string
  position?: 'before' | 'after' | 'replace'
}

export interface EditConstraints {
  maxChangedLines?: number
  allowHeadingChanges?: boolean
}

export interface Change {
  type: string
  location: number
  oldText: string
  newText: string
}

export interface PatchResult {
  success: boolean
  text?: string
  changes?: Change[]
  error?: string
}

interface AnchorLocation {
  found: boolean
  multiple?: boolean
  count?: number
  startIndex?: number
  endIndex?: number
  sectionContext?: string
}

interface SectionMatch {
  title: string
  level: number
  startOffset: number
  endOffset: number
  content: string
}

const DEFAULT_MAX_CHANGED_LINES = 50

export function applyEditOps(
  markdown: string,
  ops: EditOp[],
  constraints: EditConstraints = {}
): PatchResult {
  let result = markdown
  const changes: Change[] = []
  const {
    maxChangedLines = DEFAULT_MAX_CHANGED_LINES,
    allowHeadingChanges = false
  } = constraints

  for (const op of ops) {
    const location = findAnchor(result, op.anchor, op.scope)

    if (!location.found) {
      return {
        success: false,
        error: `Cannot find text: "${op.anchor}"${op.scope ? ` in section "${op.scope}"` : ''}. Please provide a more specific text fragment that exists in the content.`
      }
    }

    if (location.multiple) {
      return {
        success: false,
        error: `The text "${op.anchor}" appears ${location.count} times in the content. Please provide more context or specify which section using the scope parameter.`
      }
    }

    const patched = applyOperation(result, location, op)

    if (!patched.success || !patched.text || !patched.change) {
      return {
        success: false,
        error: patched.error || 'Failed to apply operation'
      }
    }

    const validation = validatePatch(result, patched.text, {
      maxChangedLines,
      allowHeadingChanges
    })

    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || 'Edit violates constraints'
      }
    }

    result = patched.text
    changes.push(patched.change)
  }

  return { success: true, text: result, changes }
}

export function buildSectionsFromMarkdown(
  markdown: string,
  existingSections?: Array<{ id?: string, title?: string, [key: string]: any }>
) {
  const lines = markdown.split('\n')
  const sections: Array<{
    id: string
    index: number
    title: string
    level: number
    anchor: string
    body: string
    startOffset: number
    endOffset: number
    meta: Record<string, any>
  }> = []

  const existingByTitle = new Map<string, string>()
  if (Array.isArray(existingSections)) {
    for (const section of existingSections) {
      if (section?.title) {
        existingByTitle.set(normalizeText(section.title), section.id || '')
      }
    }
  }

  const lineOffsets: number[] = []
  let offset = 0
  for (const line of lines) {
    lineOffsets.push(offset)
    offset += line.length + 1
  }

  let currentSection: { title: string, level: number, startLine: number } | null = null

  const pushSection = (endLine: number) => {
    if (!currentSection) {
      return
    }
    const startLine = currentSection.startLine
    const bodyLines = lines.slice(startLine + 1, endLine)
    const body = bodyLines.join('\n').trim()
    const title = currentSection.title
    const normalizedTitle = normalizeText(title)
    const id = existingByTitle.get(normalizedTitle) || slugifyTitle(title)
    const startOffset = lineOffsets[startLine]
    const endOffset = endLine < lineOffsets.length ? lineOffsets[endLine] : markdown.length

    sections.push({
      id,
      index: sections.length,
      title,
      level: currentSection.level,
      anchor: slugifyTitle(title),
      body,
      startOffset,
      endOffset,
      meta: {}
    })
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const hashMatch = /^(#{1,6})/.exec(line)
    if (!hashMatch) {
      continue
    }

    const level = hashMatch[1].length
    const rest = line.slice(level)
    if (!rest || !/^[ \t]/.test(rest)) {
      continue
    }

    const title = rest.trim()

    if (level < 2) {
      continue
    }

    if (currentSection) {
      pushSection(i)
    }

    currentSection = { title, level, startLine: i }
  }

  if (currentSection) {
    pushSection(lines.length)
  }

  return sections
}

export function calculateEditLineRange(
  original: string,
  patched: string,
  changes: Change[]
): { start: number, end: number } | null {
  if (!changes.length) {
    return null
  }
  const startOffset = Math.min(...changes.map(change => change.location))
  const endOffset = Math.max(...changes.map(change => change.location + change.newText.length))
  return calculateLineRange(patched, startOffset, endOffset)
}

function findAnchor(markdown: string, anchor: string, scope?: string): AnchorLocation {
  const trimmedAnchor = anchor.trim()
  if (!trimmedAnchor) {
    return { found: false }
  }

  let searchStartOffset = 0
  let searchSpace = markdown
  let sectionContext: string | undefined

  if (scope) {
    const section = extractSection(markdown, scope)
    if (!section) {
      return { found: false }
    }
    searchStartOffset = section.startOffset
    searchSpace = section.content
    sectionContext = section.title
  }

  const exactMatches = findAllMatches(searchSpace, trimmedAnchor)
  if (exactMatches.length === 1) {
    return {
      found: true,
      startIndex: exactMatches[0].start + searchStartOffset,
      endIndex: exactMatches[0].end + searchStartOffset,
      sectionContext
    }
  }

  if (exactMatches.length > 1) {
    return {
      found: true,
      multiple: true,
      count: exactMatches.length
    }
  }

  const normalized = buildNormalizedMap(searchSpace)
  const normalizedAnchor = normalizeText(trimmedAnchor)
  if (!normalizedAnchor) {
    return { found: false }
  }

  const normalizedMatches = findAllMatches(normalized.normalized, normalizedAnchor)
  if (normalizedMatches.length === 1) {
    const match = normalizedMatches[0]
    const startIndex = normalized.map[match.start]
    const endIndex = normalized.map[Math.min(match.end - 1, normalized.map.length - 1)] + 1
    return {
      found: true,
      startIndex: startIndex + searchStartOffset,
      endIndex: endIndex + searchStartOffset,
      sectionContext
    }
  }

  if (normalizedMatches.length > 1) {
    return {
      found: true,
      multiple: true,
      count: normalizedMatches.length
    }
  }

  return { found: false }
}

function applyOperation(
  markdown: string,
  location: AnchorLocation,
  op: EditOp
): { success: boolean, text?: string, change?: Change, error?: string } {
  const { startIndex, endIndex } = location

  if (startIndex === undefined || endIndex === undefined) {
    return { success: false, error: 'Invalid anchor location' }
  }

  let newText = markdown
  let change: Change

  switch (op.type) {
    case 'replace': {
      if (!op.newText) {
        return { success: false, error: 'newText required for replace operation' }
      }

      const existing = markdown.substring(startIndex, endIndex)
      if (op.oldText && normalizeText(existing) !== normalizeText(op.oldText)) {
        return {
          success: false,
          error: `Expected text "${op.oldText}" but found "${existing}"`
        }
      }

      newText = markdown.substring(0, startIndex) + op.newText + markdown.substring(endIndex)
      change = {
        type: 'replace',
        location: startIndex,
        oldText: existing,
        newText: op.newText
      }
      break
    }
    case 'insert': {
      if (!op.newText) {
        return { success: false, error: 'newText required for insert operation' }
      }

      const insertPos = op.position === 'before' ? startIndex : endIndex
      const separator = '\n\n'
      newText = markdown.substring(0, insertPos) + separator + op.newText + separator + markdown.substring(insertPos)
      change = {
        type: 'insert',
        location: insertPos,
        oldText: '',
        newText: op.newText
      }
      break
    }
    case 'delete': {
      newText = markdown.substring(0, startIndex) + markdown.substring(endIndex)
      change = {
        type: 'delete',
        location: startIndex,
        oldText: markdown.substring(startIndex, endIndex),
        newText: ''
      }
      break
    }
    case 'format': {
      if (!op.newText) {
        return { success: false, error: 'newText required for format operation' }
      }
      newText = markdown.substring(0, startIndex) + op.newText + markdown.substring(endIndex)
      change = {
        type: 'format',
        location: startIndex,
        oldText: markdown.substring(startIndex, endIndex),
        newText: op.newText
      }
      break
    }
    default:
      return { success: false, error: `Unknown operation type: ${op.type}` }
  }

  return { success: true, text: newText, change }
}

function validatePatch(
  original: string,
  patched: string,
  constraints: Required<Pick<EditConstraints, 'maxChangedLines' | 'allowHeadingChanges'>>
): { valid: boolean, error?: string } {
  const diffStats = calculateDiffStats(original, patched)
  const changedLines = diffStats.additions + diffStats.deletions

  if (changedLines > constraints.maxChangedLines) {
    return {
      valid: false,
      error: `Edit would change ${changedLines} lines (max ${constraints.maxChangedLines}). Please make smaller edits or increase maxChangedLines.`
    }
  }

  if (!constraints.allowHeadingChanges) {
    const originalHeadings = extractHeadings(original)
    const patchedHeadings = extractHeadings(patched)
    const hasHeadingDiff = originalHeadings.length !== patchedHeadings.length
      || originalHeadings.some((heading, index) => heading !== patchedHeadings[index])

    if (hasHeadingDiff) {
      return {
        valid: false,
        error: 'Edit would modify section headings, which is not allowed by default. Set allowHeadingChanges: true if this is intentional.'
      }
    }
  }

  return { valid: true }
}

function extractHeadings(markdown: string): string[] {
  return markdown
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^#{1,6}/.test(line) && /[ \t]/.test(line))
}

const WHITESPACE_PATTERN = /[\t\v\f \xa0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]+/g

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(WHITESPACE_PATTERN, ' ')
    .replace(/[^\w\s]/g, '')
    .trim()
}

function buildNormalizedMap(text: string): { normalized: string, map: number[] } {
  let normalized = ''
  const map: number[] = []
  let lastWasSpace = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (/\s/.test(char)) {
      if (!lastWasSpace && normalized.length > 0) {
        normalized += ' '
        map.push(i)
        lastWasSpace = true
      }
      continue
    }

    const normalizedChar = char.toLowerCase().replace(/\W/g, '')
    if (!normalizedChar) {
      continue
    }

    normalized += normalizedChar
    map.push(i)
    lastWasSpace = false
  }

  return { normalized, map }
}

function findAllMatches(text: string, search: string): Array<{ start: number, end: number }> {
  const matches: Array<{ start: number, end: number }> = []
  let index = text.indexOf(search)

  while (index !== -1) {
    matches.push({ start: index, end: index + search.length })
    index = text.indexOf(search, index + 1)
  }

  return matches
}

function extractSection(markdown: string, sectionTitle: string): SectionMatch | null {
  const normalizedTarget = normalizeText(sectionTitle)
  const lines = markdown.split('\n')
  const lineOffsets: number[] = []
  let offset = 0

  for (const line of lines) {
    lineOffsets.push(offset)
    offset += line.length + 1
  }

  let sectionStartLine = -1
  let sectionLevel = 0
  let sectionHeading = ''

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})/.exec(lines[i])
    if (!match) {
      continue
    }
    const level = match[1].length
    const rest = lines[i].slice(level)
    if (!rest || !/^[ \t]/.test(rest)) {
      continue
    }
    const title = rest.trim()
    const normalizedTitle = normalizeText(title)

    if (normalizedTitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedTitle)) {
      sectionStartLine = i
      sectionLevel = level
      sectionHeading = title
      break
    }
  }

  if (sectionStartLine === -1) {
    return null
  }

  let sectionEndLine = lines.length
  for (let i = sectionStartLine + 1; i < lines.length; i += 1) {
    const headingMatch = /^(#{1,6})/.exec(lines[i])
    if (!headingMatch) {
      continue
    }
    const rest = lines[i].slice(headingMatch[1].length)
    if (!rest || !/^[ \t]/.test(rest)) {
      continue
    }
    if (headingMatch[1].length <= sectionLevel) {
      sectionEndLine = i
      break
    }
  }

  const startOffset = lineOffsets[sectionStartLine]
  const endOffset = sectionEndLine < lineOffsets.length ? lineOffsets[sectionEndLine] : markdown.length
  const content = markdown.slice(startOffset, endOffset)

  return {
    title: sectionHeading,
    level: sectionLevel,
    startOffset,
    endOffset,
    content
  }
}
