import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ContentFrontmatter, ContentSection } from './generation/types'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { transformHtmlImages } from '~~/server/services/file/imageHtmlTransform'
import { getConversationById, getConversationLogs, getConversationMessages } from '../conversation'
import { generateStructuredDataJsonLd } from './generation'
import { buildWorkspaceSummary } from './workspaceSummary'

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
  if (currentVersion?.frontmatter) {
    structuredData = generateStructuredDataJsonLd({
      frontmatter: currentVersion.frontmatter as ContentFrontmatter,
      seoSnapshot: currentVersion.seoSnapshot as Record<string, any> | null,
      sections: currentVersion.sections as ContentSection[] | null | undefined
    }) || null
  }

  // Extract image suggestions from assets
  const imageSuggestions = currentVersion?.assets && typeof currentVersion.assets === 'object'
    ? (currentVersion.assets as any).imageSuggestions || []
    : []

  let renderedHtml: string | null = null
  if (currentVersion?.bodyHtml) {
    // Image transformation is best-effort and non-blocking
    // Use a short timeout (1s) to avoid blocking the request thread
    // If transformation fails or times out, fall back to original HTML
    try {
      const transformPromise = transformHtmlImages(currentVersion.bodyHtml, { organizationId })
      const timeoutMs = 1000 // 1 second - reasonable for DB query + HTML processing
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Image transform timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        // Clean up timer if transform completes before timeout
        transformPromise.finally(() => clearTimeout(timer))
      })
      renderedHtml = await Promise.race([transformPromise, timeoutPromise])
    } catch (error) {
      // Fall back to original HTML if transformation fails or times out
      // Note: transformPromise may continue executing in background, but result is discarded
      console.warn('[workspace] Image transformation failed or timed out, using original HTML', {
        error: error instanceof Error ? error.message : String(error)
      })
      renderedHtml = currentVersion.bodyHtml
    }
  }

  const currentVersionWithDerived = currentVersion
    ? {
        ...currentVersion,
        structuredData,
        imageSuggestions: Array.isArray(imageSuggestions) ? imageSuggestions : [],
        renderedHtml
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
