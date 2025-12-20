import type { ReferenceAnchor, ReferenceToken } from './types'

const TRAILING_PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':', '#', ')', ']', '}', '"', '\''])

const isBoundaryChar = (value: string | undefined) => {
  if (!value) {
    return true
  }
  return /\s/.test(value) || /[.,!?;:()[\]{}<>"']/.test(value)
}

const isValidIdentifierStart = (value: string | undefined) => {
  if (!value) {
    return false
  }
  return /[a-z0-9]/i.test(value)
}

const splitAnchor = (identifier: string): { identifier: string, anchor?: ReferenceAnchor } => {
  const normalized = identifier.trim()
  if (!normalized) {
    return { identifier: normalized }
  }

  const lower = normalized.toLowerCase()
  if (lower.startsWith('source:') || lower.startsWith('source/')) {
    return { identifier: normalized }
  }

  const hashIndex = normalized.indexOf('#')
  const colonIndex = normalized.indexOf(':')
  const anchorIndex = hashIndex >= 0 && colonIndex >= 0
    ? Math.min(hashIndex, colonIndex)
    : Math.max(hashIndex, colonIndex)

  if (anchorIndex <= 0) {
    return { identifier: normalized }
  }

  const anchorChar = normalized[anchorIndex]
  const base = normalized.slice(0, anchorIndex)
  const value = normalized.slice(anchorIndex + 1)
  if (!value) {
    return { identifier: normalized }
  }

  return {
    identifier: base,
    anchor: {
      kind: anchorChar === '#' ? 'hash' : 'colon',
      value
    }
  }
}

export function parseReferences(message: string): ReferenceToken[] {
  if (!message) {
    return []
  }

  const tokens: ReferenceToken[] = []
  const length = message.length

  for (let index = 0; index < length; index += 1) {
    if (message[index] !== '@') {
      continue
    }

    const prevChar = index > 0 ? message[index - 1] : undefined
    if (!isBoundaryChar(prevChar)) {
      continue
    }

    const nextChar = message[index + 1]
    if (!isValidIdentifierStart(nextChar)) {
      continue
    }

    let end = index + 1
    while (end < length && !/\s/.test(message[end])) {
      end += 1
    }

    let raw = message.slice(index, end)
    while (raw.length > 1 && TRAILING_PUNCTUATION.has(raw[raw.length - 1])) {
      raw = raw.slice(0, -1)
    }

    if (raw.length <= 1) {
      continue
    }

    const rawEndIndex = index + raw.length
    const identifierRaw = raw.slice(1)
    const { identifier, anchor } = splitAnchor(identifierRaw)

    if (!identifier) {
      continue
    }

    tokens.push({
      raw,
      identifier,
      anchor,
      startIndex: index,
      endIndex: rawEndIndex
    })

    index = rawEndIndex - 1
  }

  return tokens
}
