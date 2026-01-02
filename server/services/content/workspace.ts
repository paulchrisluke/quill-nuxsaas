import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ContentFrontmatter, ContentSection } from './generation/types'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { getConversationById, getConversationLogs, getConversationMessages } from '../conversation'
import { buildStructuredDataGraph, generateStructuredDataJsonLd, renderStructuredDataJsonLd } from './generation'
import { buildWorkspaceSummary } from './workspaceSummary'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { getSiteConfigFromMetadata } from '~~/shared/utils/siteConfig'

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

  let structuredData: string | null = null
  let structuredDataGraph: Record<string, any> | null = null
  if (currentVersion?.frontmatter) {
    const baseUrl = runtimeConfig.public.baseURL || undefined
    const siteConfig = organizationRow ? getSiteConfigFromMetadata(organizationRow.metadata) : {}
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
      frontmatter: currentVersion.frontmatter as ContentFrontmatter,
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
