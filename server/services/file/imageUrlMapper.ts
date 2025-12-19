export const normalizeBaseUrl = (value: string) => value.replace(/\/+$/u, '')

export const resolveStoragePathFromUrl = (src: string, baseUrls: string[]) => {
  const trimmed = src.trim()
  for (const base of baseUrls) {
    const normalizedBase = normalizeBaseUrl(base)
    if (!normalizedBase) {
      continue
    }
    if (trimmed === normalizedBase) {
      return ''
    }
    if (trimmed.startsWith(`${normalizedBase}/`)) {
      return trimmed.slice(normalizedBase.length + 1)
    }
  }
  return null
}

export const extractImageSourcesFromHtml = (html: string) => {
  const sources: string[] = []
  const regex = /<img[^>]*\ssrc\s*=\s*(["'])(.*?)\1/gi
  for (const match of html.matchAll(regex)) {
    if (match[2]) {
      sources.push(match[2])
    }
  }
  return sources
}
