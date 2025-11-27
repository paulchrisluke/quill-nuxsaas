const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com']
const GOOGLE_DOCS_HOSTS = ['docs.google.com']

const urlRegex = /https?:\/\/[^\s<>"']+/gi
const domainRegex = /(?:^|\s)(((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s<>"']*)?)/gi

export interface ParsedUrlResult {
  url: string
  sourceType: 'youtube' | 'google_doc' | 'url'
  externalId: string | null
  metadata?: Record<string, any>
}

export const extractUrls = (message: string): string[] => {
  if (!message || typeof message !== 'string') {
    return []
  }

  const urls: string[] = []

  // Extract URLs with protocols (http:// or https://)
  const protocolUrls = [...message.matchAll(urlRegex)].map(match => match[0])
  urls.push(...protocolUrls)

  // Extract domain-like patterns without protocols
  const domainMatches = [...message.matchAll(domainRegex)]
  for (const match of domainMatches) {
    const fullMatch = match[1] // Full domain + path
    const domain = match[2] // Just the domain part
    // Only add if it looks like a known domain and isn't already captured
    if ((domain.includes('youtube.com') || domain.includes('youtu.be') || domain.includes('docs.google.com'))
      && !urls.some(url => url.includes(domain))) {
      // Add https:// prefix for parsing
      urls.push(`https://${fullMatch}`)
    }
  }
  return urls
}

export const extractYouTubeId = (url: URL): string | null => {
  if (url.hostname === 'youtu.be') {
    return url.pathname.replace('/', '')
  }

  if (url.searchParams.has('v')) {
    return url.searchParams.get('v')
  }

  const pathSegments = url.pathname.split('/')
  const embedIndex = pathSegments.indexOf('embed')
  if (embedIndex !== -1 && pathSegments[embedIndex + 1]) {
    return pathSegments[embedIndex + 1]
  }

  return null
}

export const classifyUrl = (rawUrl: string): ParsedUrlResult | null => {
  try {
    const url = new URL(rawUrl)
    const hostname = url.hostname.toLowerCase()

    if (YOUTUBE_HOSTS.includes(hostname)) {
      const videoId = extractYouTubeId(url)
      if (videoId) {
        return {
          url: rawUrl,
          sourceType: 'youtube',
          externalId: videoId,
          metadata: {
            originalUrl: rawUrl
          }
        }
      }
    }

    if (GOOGLE_DOCS_HOSTS.includes(hostname) && url.pathname.includes('/document/')) {
      const segments = url.pathname.split('/').filter(Boolean)
      const docIndex = segments.indexOf('d')
      const docId = docIndex !== -1 ? segments[docIndex + 1] : undefined
      if (docId) {
        return {
          url: rawUrl,
          sourceType: 'google_doc',
          externalId: docId,
          metadata: {
            originalUrl: rawUrl
          }
        }
      }
    }

    return {
      url: rawUrl,
      sourceType: 'url',
      externalId: rawUrl,
      metadata: {
        originalUrl: rawUrl
      }
    }
  } catch {
    return null
  }
}
