import { slugifyTitle } from '~~/server/utils/content'
import { calculateDiffStats, calculateLineRange } from '../diff'

export interface EditOp {
  type: 'replace' | 'insert' | 'delete' | 'format'
  anchor: string
  scope?: string
  lineRange?: { start: number, end: number }
  oldText?: string
  newText?: string
  position?: 'before' | 'after' | 'replace'
}

export interface EditConstraints {
  maxChangedLines?: number
  allowHeadingChanges?: boolean
  scope?: 'single-paragraph' | 'multi-paragraph'
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

const DEFAULT_MAX_CHANGED_LINES = 12
const DEFAULT_MAX_CHANGED_RATIO = 0.08

export function applyEditOps(
  markdown: string,
  ops: EditOp[],
  constraints: EditConstraints = {}
): PatchResult {
  if (typeof markdown !== 'string') {
    return {
      success: false,
      error: 'markdown parameter must be a string'
    }
  }
  if (!Array.isArray(ops) || ops.length === 0) {
    return {
      success: false,
      error: 'ops must be a non-empty array'
    }
  }

  let result = markdown
  const changes: Change[] = []
  const totalLines = Math.max(1, markdown.split('\n').length)
  const defaultMaxChangedLines = Math.min(
    DEFAULT_MAX_CHANGED_LINES,
    Math.max(1, Math.floor(totalLines * DEFAULT_MAX_CHANGED_RATIO))
  )
  const {
    allowHeadingChanges = false,
    scope = 'single-paragraph'
  } = constraints
  const requestedMaxChangedLines = constraints.maxChangedLines
  const maxChangedLines = scope === 'multi-paragraph' && typeof requestedMaxChangedLines === 'number'
    ? Math.max(1, Math.floor(requestedMaxChangedLines))
    : typeof requestedMaxChangedLines === 'number'
      ? Math.min(defaultMaxChangedLines, Math.max(1, Math.floor(requestedMaxChangedLines)))
      : defaultMaxChangedLines

  for (const op of ops) {
    if (!op || typeof op.anchor !== 'string') {
      return {
        success: false,
        error: 'Each edit op must include a string anchor'
      }
    }

    const lineRange = op.lineRange ? (resolveLineRange(result, op.lineRange) ?? undefined) : undefined
    if (op.lineRange && !lineRange) {
      return {
        success: false,
        error: 'lineRange must be a valid 1-based range within the current content.'
      }
    }

    const location = findAnchor(result, op.anchor, op.scope, lineRange)

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

    const scopeValidation = validateScopeChange(result, patched.text, patched.change, scope)
    if (!scopeValidation.valid) {
      return {
        success: false,
        error: scopeValidation.error || 'Edit violates scope constraints'
      }
    }

    const validation = validatePatch(result, patched.text, {
      maxChangedLines,
      allowHeadingChanges,
      scope
    })

    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || 'Edit violates constraints'
      }
    }

    const lengthDelta = patched.change.newText.length - patched.change.oldText.length
    for (const existingChange of changes) {
      if (existingChange.location >= patched.change.location) {
        existingChange.location += lengthDelta
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
  if (typeof markdown !== 'string') {
    return []
  }

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
    const startOffset = lineOffsets[startLine] ?? 0
    const endOffset = endLine < lineOffsets.length ? (lineOffsets[endLine] ?? markdown.length) : markdown.length

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
    const line = lines[i] ?? ''
    const hashMatch = /^(#{1,6})/.exec(line)
    if (!hashMatch) {
      continue
    }

    const level = hashMatch[1]?.length ?? 0
    if (!level) {
      continue
    }
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
  if (typeof original !== 'string' || typeof patched !== 'string') {
    return null
  }
  if (!Array.isArray(changes)) {
    return null
  }
  if (!changes.length) {
    return null
  }
  const startOffset = Math.min(...changes.map(change => change.location))
  const endOffset = Math.max(...changes.map(change => change.location + change.newText.length))
  return calculateLineRange(patched, startOffset, endOffset)
}

function findAnchor(
  markdown: string,
  anchor: string,
  scope?: string,
  lineRange?: { startOffset: number, endOffset: number }
): AnchorLocation {
  const trimmedAnchor = anchor.trim()
  if (!trimmedAnchor) {
    return { found: false }
  }

  let searchStartOffset = 0
  let searchSpace = markdown
  let sectionContext: string | undefined

  if (lineRange) {
    searchStartOffset = lineRange.startOffset
    searchSpace = markdown.slice(lineRange.startOffset, lineRange.endOffset)
  }

  if (scope) {
    const section = extractSection(markdown, scope)
    if (!section) {
      return { found: false }
    }
    const sectionStart = section.startOffset
    const sectionEnd = section.endOffset
    const boundedStart = lineRange ? Math.max(lineRange.startOffset, sectionStart) : sectionStart
    const boundedEnd = lineRange ? Math.min(lineRange.endOffset, sectionEnd) : sectionEnd
    if (boundedStart >= boundedEnd) {
      return { found: false }
    }
    searchStartOffset = boundedStart
    searchSpace = markdown.slice(boundedStart, boundedEnd)
    sectionContext = section.title
  }

  const exactMatches = findAllMatches(searchSpace, trimmedAnchor)
  if (exactMatches.length === 1) {
    const match = exactMatches[0]
    if (!match) {
      return { found: false }
    }
    return {
      found: true,
      startIndex: match.start + searchStartOffset,
      endIndex: match.end + searchStartOffset,
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
    if (!match) {
      return { found: false }
    }
    const startIndex = normalized.map[match.start]
    const endIndex = normalized.map[Math.min(match.end - 1, normalized.map.length - 1)]
    if (startIndex === undefined || endIndex === undefined) {
      return { found: false }
    }
    return {
      found: true,
      startIndex: startIndex + searchStartOffset,
      endIndex: endIndex + searchStartOffset + 1,
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
      const beforeSlice = markdown.substring(Math.max(0, insertPos - 2), insertPos)
      const afterSlice = markdown.substring(insertPos, Math.min(markdown.length, insertPos + 2))
      const leadingSeparator = insertPos === 0 || beforeSlice === '\n\n' ? '' : '\n\n'
      const trailingSeparator = insertPos === markdown.length || afterSlice === '\n\n' ? '' : '\n\n'
      const insertedText = `${leadingSeparator}${op.newText}${trailingSeparator}`
      newText = markdown.substring(0, insertPos) + insertedText + markdown.substring(insertPos)
      change = {
        type: 'insert',
        location: insertPos,
        oldText: '',
        newText: insertedText
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
  constraints: Required<Pick<EditConstraints, 'maxChangedLines' | 'allowHeadingChanges' | 'scope'>>
): { valid: boolean, error?: string } {
  const diffStats = calculateDiffStats(original, patched)
  const changedLines = diffStats.additions + diffStats.deletions

  if (changedLines > constraints.maxChangedLines) {
    return {
      valid: false,
      error: `Edit would change ${changedLines} lines (max ${constraints.maxChangedLines}). Please make smaller edits or request a broader scope.`
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

function validateScopeChange(
  original: string,
  patched: string,
  change: Change,
  scope: EditConstraints['scope']
): { valid: boolean, error?: string } {
  if (scope === 'multi-paragraph') {
    return { valid: true }
  }

  const newText = change.newText || ''
  if (/\n\s*\n/.test(newText)) {
    return {
      valid: false,
      error: 'Edit introduces multiple paragraphs. Request a multi-paragraph scope to continue.'
    }
  }

  const rangeStart = change.location
  const rangeEnd = change.location + (change.oldText?.length ?? 0)
  const paragraphBounds = getParagraphBounds(original, rangeStart, rangeEnd)
  if (!paragraphBounds) {
    return {
      valid: false,
      error: 'Edit spans multiple paragraphs. Request a multi-paragraph scope to continue.'
    }
  }

  if (rangeStart < paragraphBounds.start || rangeEnd > paragraphBounds.end) {
    return {
      valid: false,
      error: 'Edit spans multiple paragraphs. Request a multi-paragraph scope to continue.'
    }
  }

  const patchedBounds = getParagraphBounds(patched, change.location, change.location + newText.length)
  if (!patchedBounds) {
    return {
      valid: false,
      error: 'Edit spans multiple paragraphs. Request a multi-paragraph scope to continue.'
    }
  }

  return { valid: true }
}

function resolveLineRange(
  markdown: string,
  range: { start: number, end: number }
): { startOffset: number, endOffset: number } | null {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    return null
  }
  if (range.start < 1 || range.end < range.start) {
    return null
  }

  const lines = markdown.split('\n')
  const totalLines = lines.length
  if (range.end > totalLines) {
    return null
  }

  const lineOffsets: number[] = []
  let offset = 0
  for (const line of lines) {
    lineOffsets.push(offset)
    offset += line.length + 1
  }

  const startIndex = range.start - 1
  const endIndex = range.end - 1
  const startOffset = lineOffsets[startIndex] ?? 0
  const endOffset = endIndex + 1 < lineOffsets.length ? (lineOffsets[endIndex + 1] ?? markdown.length) : markdown.length

  return { startOffset, endOffset }
}

function getParagraphBounds(
  markdown: string,
  startOffset: number,
  endOffset: number
): { start: number, end: number } | null {
  const lines = markdown.split('\n')
  const lineOffsets: number[] = []
  let offset = 0
  for (const line of lines) {
    lineOffsets.push(offset)
    offset += line.length + 1
  }

  const findLineIndex = (pos: number) => {
    for (let i = lineOffsets.length - 1; i >= 0; i -= 1) {
      const lineOffset = lineOffsets[i] ?? 0
      if (pos >= lineOffset) {
        return i
      }
    }
    return 0
  }

  const startLine = findLineIndex(startOffset)
  const endLine = findLineIndex(Math.max(startOffset, endOffset - 1))

  const startLineText = lines[startLine] ?? ''
  const endLineText = lines[endLine] ?? ''
  if (startLineText.trim() === '' || endLineText.trim() === '') {
    return null
  }

  let paragraphStartLine = startLine
  for (let i = startLine - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      paragraphStartLine = i + 1
      break
    }
    if (i === 0) {
      paragraphStartLine = 0
    }
  }

  let paragraphEndLine = endLine
  for (let i = endLine + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      paragraphEndLine = i - 1
      break
    }
    if (i === lines.length - 1) {
      paragraphEndLine = lines.length - 1
    }
  }

  const start = lineOffsets[paragraphStartLine] ?? 0
  const end = paragraphEndLine + 1 < lineOffsets.length
    ? (lineOffsets[paragraphEndLine + 1] ?? markdown.length)
    : markdown.length

  return { start, end }
}

function extractHeadings(markdown: string): string[] {
  return markdown
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^#{1,6}[ \t]/.test(line))
}

const WHITESPACE_PATTERN = /[\t\v\f \xa0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]+/gu

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(WHITESPACE_PATTERN, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
}

function buildNormalizedMap(text: string): { normalized: string, map: number[] } {
  let normalized = ''
  const map: number[] = []
  let lastWasSpace = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? ''
    if (/\s/.test(char)) {
      if (!lastWasSpace && normalized.length > 0) {
        normalized += ' '
        map.push(i)
        lastWasSpace = true
      }
      continue
    }

    const normalizedChar = char.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
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
    const line = lines[i] ?? ''
    const match = /^(#{1,6})/.exec(line)
    if (!match) {
      continue
    }
    const level = match[1]?.length ?? 0
    if (!level) {
      continue
    }
    const rest = line.slice(level)
    if (!rest || !/^[ \t]/.test(rest)) {
      continue
    }
    const title = rest.trim()
    const normalizedTitle = normalizeText(title)

    if (normalizedTitle === normalizedTarget) {
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
    const line = lines[i] ?? ''
    const headingMatch = /^(#{1,6})/.exec(line)
    if (!headingMatch) {
      continue
    }
    const headingLevel = headingMatch[1]?.length ?? 0
    if (!headingLevel) {
      continue
    }
    const rest = line.slice(headingLevel)
    if (!rest || !/^[ \t]/.test(rest)) {
      continue
    }
    if (headingLevel <= sectionLevel) {
      sectionEndLine = i
      break
    }
  }

  const startOffset = lineOffsets[sectionStartLine] ?? 0
  const endOffset = sectionEndLine < lineOffsets.length ? (lineOffsets[sectionEndLine] ?? markdown.length) : markdown.length
  const content = markdown.slice(startOffset, endOffset)

  return {
    title: sectionHeading,
    level: sectionLevel,
    startOffset,
    endOffset,
    content
  }
}
