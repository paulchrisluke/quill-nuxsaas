import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ContentFrontmatter, ContentSection } from './generation/types'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { getSiteConfigFromMetadata } from '~~/shared/utils/siteConfig'
import { getConversationById, getConversationLogs, getConversationMessages } from '../conversation'
import { buildStructuredDataGraph, generateStructuredDataJsonLd, renderStructuredDataJsonLd } from './generation'
import { buildWorkspaceSummary } from './workspaceSummary'

const resolveImageUrl = (
  value: unknown,
  baseUrl: string | null,
  options?: { publisherHost?: string | null, githubRawBase?: string | null }
) => {
  if (typeof value !== 'string') {
    return value
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }
  const publisherHost = options?.publisherHost
  const githubRawBase = options?.githubRawBase
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (githubRawBase && publisherHost) {
      const publisherHosts = new Set(
        [
          publisherHost,
          publisherHost.startsWith('www.') ? publisherHost.slice(4) : `www.${publisherHost}`
        ].filter(Boolean)
      )
      try {
        const url = new URL(trimmed)
        if (publisherHosts.has(url.host)) {
          if (url.pathname.startsWith('/_next/')) {
            return trimmed
          }
          if (url.pathname.startsWith('/public/')) {
            return `${githubRawBase}${url.pathname}`
          }
          return `${githubRawBase}/public${url.pathname}`
        }
      } catch {
        // Fall through to return original value.
      }
    }
    return trimmed
  }
  if (!baseUrl) {
    return trimmed
  }
  if (githubRawBase && baseUrl === githubRawBase && trimmed.startsWith('/')) {
    if (trimmed.startsWith('/public/')) {
      return `${githubRawBase}${trimmed}`
    }
    return `${githubRawBase}/public${trimmed}`
  }
  if (
    githubRawBase &&
    baseUrl === githubRawBase &&
    !trimmed.startsWith('/') &&
    (trimmed.startsWith('images/') || trimmed.startsWith('static/'))
  ) {
    return `${githubRawBase}/public/${trimmed}`
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const normalizedPath = trimmed.replace(/^\/+/, '')
  return `${normalizedBase}/${normalizedPath}`
}

const resolveFrontmatterImages = (
  frontmatter: Record<string, any> | null,
  baseUrl: string | null,
  options?: { publisherHost?: string | null, githubRawBase?: string | null }
) => {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return frontmatter
  }
  const normalized = { ...frontmatter }
  if (normalized.image) {
    normalized.image = resolveImageUrl(normalized.image, baseUrl, options)
  }
  if (normalized.authorImage) {
    normalized.authorImage = resolveImageUrl(normalized.authorImage, baseUrl, options)
  }
  return normalized
}

const buildGithubRawBase = (source: Record<string, any> | null | undefined) => {
  const repoFullName = typeof source?.repoFullName === 'string' ? source.repoFullName.trim() : ''
  if (!repoFullName || !repoFullName.includes('/')) {
    return null
  }
  const [owner, repo] = repoFullName.split('/')
  if (!owner || !repo) {
    return null
  }
  const branch = typeof source?.baseBranch === 'string' && source.baseBranch.trim()
    ? source.baseBranch.trim()
    : 'main'
  const encodedBranch = branch
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodedBranch}`
}

const rewriteMarkdownImageUrls = (
  markdown: string,
  baseUrl: string | null,
  options?: { publisherHost?: string | null, githubRawBase?: string | null }
) => {
  if (!baseUrl) {
    return markdown
  }
  const replaceRelative = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return resolveImageUrl(trimmed, baseUrl, options) as string
    }
    const normalizedBase = baseUrl.replace(/\/+$/, '')
    const normalizedPath = trimmed.replace(/^\/+/, '')
    return `${normalizedBase}/${normalizedPath}`
  }

  const markdownImagePattern = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+['"][^'"]*['"])?\s*\)/g
  const markdownRefPattern = /^\[([^\]]+)\]:\s*(\S+)(?:\s+['"][^'"]*['"])?\s*$/gm
  const htmlImagePattern = /<img\s[^>]*src=["']([^"']+)["'][^>]*>/gi

  const rewrittenMarkdown = markdown.replace(markdownImagePattern, (match, url) => {
    const absolute = replaceRelative(url)
    return match.replace(url, absolute)
  })

  const rewrittenRefs = rewrittenMarkdown.replace(markdownRefPattern, (match, _label, url) => {
    const absolute = replaceRelative(url)
    return match.replace(url, absolute)
  })

  return rewrittenRefs.replace(htmlImagePattern, (match, url) => {
    const absolute = replaceRelative(url)
    return match.replace(url, absolute)
  })
}

export async function getContentWorkspacePayload(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  contentId: string,
  options?: { includeChat?: boolean }
) {
  const includeChat = options?.includeChat !== false
  const [contentRow] = await db
    .select()
    .from(schema.content)
    .where(eq(schema.content.id, contentId))
    .limit(1)

  if (!contentRow || contentRow.organizationId !== organizationId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  let sourceContent: typeof schema.sourceContent.$inferSelect | null = null
  if (contentRow.sourceContentId) {
    const [sourceRow] = await db
      .select()
      .from(schema.sourceContent)
      .where(eq(schema.sourceContent.id, contentRow.sourceContentId))
      .limit(1)
    sourceContent = sourceRow ?? null
  }

  let currentVersion: typeof schema.contentVersion.$inferSelect | null = null
  if (contentRow.currentVersionId) {
    const [versionRow] = await db
      .select()
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.id, contentRow.currentVersionId))
      .limit(1)
    currentVersion = versionRow ?? null
  }

  const [organizationRow] = await db
    .select({
      name: schema.organization.name,
      slug: schema.organization.slug,
      logo: schema.organization.logo,
      metadata: schema.organization.metadata
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, contentRow.organizationId))
    .limit(1)

  if (!organizationRow) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Organization not found'
    })
  }

  const [authorRow] = await db
    .select({ name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, contentRow.createdByUserId))
    .limit(1)

  let chatMessages: Array<{
    id: string
    role: string
    content: string
    payload?: Record<string, any> | null
    createdAt: Date
  }> = []
  let chatLogs: Array<{
    id: string
    type: string
    message: string
    payload?: Record<string, any> | null
    createdAt: Date
  }> = []

  let conversation: typeof schema.conversation.$inferSelect | null = null

  // Get conversation via content.conversationId (proper relationship)
  if (contentRow.conversationId) {
    try {
      conversation = await getConversationById(db, contentRow.conversationId, organizationId)

      if (conversation && includeChat) {
        const [messages, logs] = await Promise.all([
          getConversationMessages(db, conversation.id, organizationId),
          getConversationLogs(db, conversation.id, organizationId)
        ])

        chatMessages = messages.map(message => ({
          id: message.id,
          role: message.role,
          content: message.content,
          payload: message.payload,
          createdAt: message.createdAt
        }))
        chatLogs = logs.map(log => ({
          id: log.id,
          type: log.type,
          message: log.message,
          payload: log.payload,
          createdAt: log.createdAt
        }))
      }
    } catch (error) {
      console.error('Failed to load conversation', {
        conversationId: contentRow.conversationId,
        contentId,
        organizationId,
        error
      })
    }
  }

  const workspaceSummary = buildWorkspaceSummary({
    content: contentRow,
    currentVersion,
    sourceContent
  })

  const siteConfig = organizationRow ? getSiteConfigFromMetadata(organizationRow.metadata) : {}
  const publisherBaseUrl = siteConfig.publisher?.url || siteConfig.blog?.url || null
  const publisherHost = publisherBaseUrl
    ? (() => {
        try {
          return new URL(publisherBaseUrl).host
        } catch {
          return null
        }
      })()
    : null
  const sourceInfo = currentVersion?.assets && typeof currentVersion.assets === 'object'
    ? (currentVersion.assets as any).source
    : null
  const githubRawBase = buildGithubRawBase(sourceInfo)
  const imageBaseUrl = githubRawBase || publisherBaseUrl
  const imageOptions = { publisherHost, githubRawBase }

  const resolvedFrontmatter = currentVersion?.frontmatter
    ? resolveFrontmatterImages(currentVersion.frontmatter as Record<string, any>, imageBaseUrl, imageOptions)
    : currentVersion?.frontmatter ?? null
  const resolvedBodyMarkdown = currentVersion?.bodyMarkdown && typeof currentVersion.bodyMarkdown === 'string'
    ? rewriteMarkdownImageUrls(currentVersion.bodyMarkdown, imageBaseUrl, imageOptions)
    : currentVersion?.bodyMarkdown ?? null

  let structuredData: string | null = null
  let structuredDataGraph: Record<string, any> | null = null
  if (resolvedFrontmatter) {
    const baseUrl = runtimeConfig.public.baseURL || undefined
    const publisherDefaults = organizationRow
      ? {
          name: organizationRow.name,
          url: organizationRow.slug && baseUrl ? `${baseUrl.replace(/\/+$/, '')}/${organizationRow.slug}` : undefined,
          logoUrl: organizationRow.logo ?? undefined
        }
      : null
    const publisher = publisherDefaults
      ? { ...publisherDefaults, ...(siteConfig.publisher ?? {}) }
      : (siteConfig.publisher ?? null)
    const authorDefaults = authorRow
      ? {
          name: authorRow.name,
          image: authorRow.image ?? undefined
        }
      : null
    const author = authorDefaults
      ? { ...authorDefaults, ...(siteConfig.author ?? {}) }
      : (siteConfig.author ?? null)
    const blog = siteConfig.blog ?? null
    const categories = siteConfig.categories ?? null
    const structuredDataParams = {
      frontmatter: resolvedFrontmatter as ContentFrontmatter,
      seoSnapshot: currentVersion.seoSnapshot as Record<string, any> | null,
      sections: currentVersion.sections as ContentSection[] | null | undefined,
      baseUrl,
      contentId: contentRow.id,
      author,
      publisher,
      datePublished: contentRow.publishedAt ?? currentVersion.createdAt ?? null,
      dateModified: contentRow.updatedAt ?? currentVersion.createdAt ?? null,
      breadcrumbs: siteConfig.breadcrumbs ?? null,
      blog,
      categories
    }

    structuredDataGraph = buildStructuredDataGraph(structuredDataParams) || null
    structuredData = structuredDataGraph
      ? renderStructuredDataJsonLd(structuredDataGraph)
      : generateStructuredDataJsonLd(structuredDataParams)
    structuredData = structuredData || null
  }

  // Extract image suggestions from assets
  const imageSuggestions = currentVersion?.assets && typeof currentVersion.assets === 'object'
    ? (currentVersion.assets as any).imageSuggestions || []
    : []

  const currentVersionWithDerived = currentVersion
    ? {
        ...currentVersion,
        frontmatter: resolvedFrontmatter ?? currentVersion.frontmatter,
        bodyMarkdown: resolvedBodyMarkdown ?? currentVersion.bodyMarkdown,
        structuredData,
        structuredDataGraph,
        imageSuggestions: Array.isArray(imageSuggestions) ? imageSuggestions : []
      }
    : null

  return {
    content: contentRow,
    sourceContent,
    currentVersion: currentVersionWithDerived,
    workspaceSummary,
    chatSession: conversation, // Legacy field name for backwards compatibility
    chatMessages: includeChat ? chatMessages : null,
    chatLogs: includeChat ? chatLogs : null
  }
}
