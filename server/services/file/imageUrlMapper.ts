export const normalizeBaseUrl = (value: string) => value.replace(/\/+$/u, '')

const normalizeUrl = (value: string) => {
  return value.replace(/^https?:\/\//i, '').split(/[?#]/)[0]?.replace(/\/+$/u, '') || ''
}

export const resolveStoragePathFromUrl = (src: string, baseUrls: string[]) => {
  if (!src || !Array.isArray(baseUrls) || baseUrls.length === 0) {
    return null
  }
  const normalizedSrc = normalizeUrl(src.trim())
  if (!normalizedSrc) {
    return null
  }
  for (const base of baseUrls) {
    const normalizedBase = normalizeBaseUrl(base)
    if (!normalizedBase) {
      continue
    }
    const normalizedBaseUrl = normalizeUrl(normalizedBase)
    if (!normalizedBaseUrl) {
      continue
    }
    if (normalizedSrc === normalizedBaseUrl) {
      return ''
    }
    if (normalizedSrc.startsWith(`${normalizedBaseUrl}/`)) {
      return normalizedSrc.slice(normalizedBaseUrl.length + 1)
    }
  }
  return null
}

export const extractImageSourcesFromHtml = (html: string) => {
  const sources: string[] = []
  const regex = /<img[^>]+?\bsrc\s*=\s*(["'])(.*?)\1/gi
  for (const match of html.matchAll(regex)) {
    if (match[2]) {
      sources.push(match[2])
    }
  }
  return sources
}
