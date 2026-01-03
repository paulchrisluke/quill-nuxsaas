import { createError } from 'h3'

interface FrontmatterParseResult {
  frontmatter: Record<string, any>
  body: string
}

const isComment = (value: string) => value.trim().startsWith('#')

const findNextMeaningfulLine = (lines: string[], startIndex: number) => {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim() || isComment(line)) {
      continue
    }
    return {
      index,
      raw: line,
      indent: line.match(/^\s*/)?.[0].length ?? 0,
      trimmed: line.trim()
    }
  }
  return null
}

const parseScalar = (value: string) => {
  const trimmed = value.trim()
  if (trimmed === '') {
    return ''
  }
  if (trimmed === 'null') {
    return null
  }
  if (trimmed === 'true') {
    return true
  }
  if (trimmed === 'false') {
    return false
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const splitKeyValue = (line: string) => {
  const idx = line.indexOf(':')
  if (idx === -1) {
    return null
  }
  const key = line.slice(0, idx).trim()
  const rest = line.slice(idx + 1).trim()
  if (!key) {
    return null
  }
  return { key, rest }
}

const parseYamlLines = (lines: string[]) => {
  const root: Record<string, any> = {}
  const stack: Array<{ indent: number, type: 'object' | 'array', container: any }> = [
    { indent: -1, type: 'object', container: root }
  ]

  const ensureArrayContext = (entry: { indent: number, type: 'object' | 'array', container: any }) => {
    if (entry.type === 'array') {
      return entry
    }
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid YAML structure: expected array.'
    })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    if (!raw.trim() || isComment(raw)) {
      continue
    }

    const indent = raw.match(/^\s*/)?.[0].length ?? 0
    const trimmed = raw.trim()

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }

    const current = stack[stack.length - 1]

    if (trimmed.startsWith('- ')) {
      const arrayContext = ensureArrayContext(current)
      const itemValue = trimmed.slice(2)
      const kv = splitKeyValue(itemValue)

      if (!kv) {
        arrayContext.container.push(parseScalar(itemValue))
        continue
      }

      const itemObject: Record<string, any> = {}
      arrayContext.container.push(itemObject)

      if (kv.rest === '') {
        const nextLine = findNextMeaningfulLine(lines, index + 1)
        const nextIsArray = nextLine && nextLine.indent > indent && nextLine.trimmed.startsWith('- ')
        itemObject[kv.key] = nextIsArray ? [] : {}
        stack.push({
          indent,
          type: nextIsArray ? 'array' : 'object',
          container: itemObject[kv.key]
        })
      } else {
        itemObject[kv.key] = parseScalar(kv.rest)
        const nextLine = findNextMeaningfulLine(lines, index + 1)
        if (nextLine && nextLine.indent > indent && !nextLine.trimmed.startsWith('- ')) {
          stack.push({
            indent,
            type: 'object',
            container: itemObject
          })
        }
      }
      continue
    }

    const kv = splitKeyValue(trimmed)
    if (!kv) {
      continue
    }

    if (kv.rest === '') {
      const nextLine = findNextMeaningfulLine(lines, index + 1)
      const nextIsArray = nextLine && nextLine.indent > indent && nextLine.trimmed.startsWith('- ')
      current.container[kv.key] = nextIsArray ? [] : {}
      stack.push({
        indent,
        type: nextIsArray ? 'array' : 'object',
        container: current.container[kv.key]
      })
    } else {
      current.container[kv.key] = parseScalar(kv.rest)
    }
  }

  return root
}

export const parseFrontmatterMarkdown = (markdown: string): FrontmatterParseResult => {
  const normalized = markdown.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: normalized }
  }

  let endIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      endIndex = index
      break
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, body: normalized }
  }

  const frontmatterLines = lines.slice(1, endIndex)
  const bodyLines = lines.slice(endIndex + 1)

  const frontmatter = parseYamlLines(frontmatterLines)
  const body = bodyLines.join('\n')

  return { frontmatter, body }
}
