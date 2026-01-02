export interface SiteConfigPublisher {
  name?: string
  url?: string
  logoUrl?: string
  sameAs?: string[]
}

export interface SiteConfigAuthor {
  name?: string
  url?: string
  image?: string
  sameAs?: string[]
}

export interface SiteConfigBreadcrumb {
  name: string
  item: string
}

export interface SiteConfigBlog {
  name?: string
  url?: string
}

export interface SiteConfigCategory {
  name: string
  slug?: string
}

export interface SiteConfig {
  publisher?: SiteConfigPublisher
  author?: SiteConfigAuthor
  blog?: SiteConfigBlog
  categories?: SiteConfigCategory[]
  breadcrumbs?: SiteConfigBreadcrumb[]
}

export const SITE_CONFIG_VIRTUAL_KEY = 'site_config'
export const SITE_CONFIG_FILENAME = '_site.json'

const normalizeStringArray = (value?: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }
  const entries = value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
  return entries.length ? entries : undefined
}

export const safeParseJSON = (value?: string | null) => {
  if (!value || typeof value !== 'string') {
    return null
  }
  try {
    return JSON.parse(value) as Record<string, any>
  } catch {
    return null
  }
}

const normalizePublisher = (value?: Record<string, any> | null): SiteConfigPublisher | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  return {
    name: typeof value.name === 'string' ? value.name.trim() : undefined,
    url: typeof value.url === 'string' ? value.url.trim() : undefined,
    logoUrl: typeof value.logoUrl === 'string' ? value.logoUrl.trim() : undefined,
    sameAs: normalizeStringArray(value.sameAs)
  }
}

const normalizeAuthor = (value?: Record<string, any> | null): SiteConfigAuthor | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  return {
    name: typeof value.name === 'string' ? value.name.trim() : undefined,
    url: typeof value.url === 'string' ? value.url.trim() : undefined,
    image: typeof value.image === 'string' ? value.image.trim() : undefined,
    sameAs: normalizeStringArray(value.sameAs)
  }
}

const normalizeBreadcrumbs = (value?: unknown): SiteConfigBreadcrumb[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }
  const items = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }
      const name = typeof (entry as any).name === 'string' ? (entry as any).name.trim() : ''
      const item = typeof (entry as any).item === 'string' ? (entry as any).item.trim() : ''
      if (!name || !item) {
        return null
      }
      return { name, item }
    })
    .filter(Boolean) as SiteConfigBreadcrumb[]
  return items.length ? items : undefined
}

const normalizeBlog = (value?: Record<string, any> | null): SiteConfigBlog | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const name = typeof value.name === 'string' ? value.name.trim() : undefined
  const url = typeof value.url === 'string' ? value.url.trim() : undefined
  if (!name && !url) {
    return undefined
  }
  return {
    ...(name ? { name } : {}),
    ...(url ? { url } : {})
  }
}

const normalizeCategories = (value?: unknown): SiteConfigCategory[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }
  const items = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }
      const name = typeof (entry as any).name === 'string' ? (entry as any).name.trim() : ''
      const slug = typeof (entry as any).slug === 'string' ? (entry as any).slug.trim() : ''
      if (!name) {
        return null
      }
      return {
        name,
        ...(slug ? { slug } : {})
      }
    })
    .filter(Boolean) as SiteConfigCategory[]
  return items.length ? items : undefined
}

export const normalizeSiteConfig = (value?: unknown): SiteConfig => {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const data = value as Record<string, any>
  return {
    publisher: normalizePublisher(data.publisher ?? null),
    author: normalizeAuthor(data.author ?? null),
    blog: normalizeBlog(data.blog ?? null),
    categories: normalizeCategories(data.categories),
    breadcrumbs: normalizeBreadcrumbs(data.breadcrumbs)
  }
}

export const getSiteConfigFromMetadata = (metadata?: unknown): SiteConfig => {
  if (!metadata) {
    return {}
  }
  const raw = typeof metadata === 'string' ? safeParseJSON(metadata) : metadata
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const data = raw as Record<string, any>
  return normalizeSiteConfig(data.siteConfig ?? data.seo ?? {})
}

export const mergeSiteConfigIntoMetadata = (
  metadata: unknown,
  siteConfig: SiteConfig
): Record<string, any> => {
  const existing = typeof metadata === 'string'
    ? safeParseJSON(metadata) || {}
    : (metadata && typeof metadata === 'object' ? metadata as Record<string, any> : {})

  return {
    ...existing,
    siteConfig: normalizeSiteConfig(siteConfig)
  }
}

export const formatSiteConfig = (siteConfig: SiteConfig) => {
  return JSON.stringify(normalizeSiteConfig(siteConfig), null, 2)
}
