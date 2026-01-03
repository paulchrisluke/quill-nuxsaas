import type { ChatMessage } from '#shared/utils/types'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ChatCompletionMessage } from '~~/server/utils/aiGateway'
import type { User } from '~~/shared/utils/types'
import { and, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { callChatCompletions } from '~~/server/utils/aiGateway'
import { safeError, safeLog } from '~~/server/utils/safeLogger'

type ConversationStatus = typeof schema.conversation.$inferSelect['status']

export interface EnsureConversationInput {
  organizationId: string
  sourceContentId?: string | null
  createdByUserId?: string | null
  status?: ConversationStatus
  metadata?: Record<string, any> | null
}

export async function getConversationById(
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string
) {
  const [conv] = await db
    .select()
    .from(schema.conversation)
    .where(and(
      eq(schema.conversation.id, conversationId),
      eq(schema.conversation.organizationId, organizationId)
    ))
    .limit(1)

  return conv ?? null
}

export const buildConversationAccessClauses = (params: {
  organizationId: string
  user: User
}) => {
  const clauses = [eq(schema.conversation.organizationId, params.organizationId)]
  if (params.user.isAnonymous) {
    clauses.push(eq(schema.conversation.createdByUserId, params.user.id))
  }
  return clauses
}

export async function getConversationByIdForUser(
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string,
  user: User
) {
  const accessClauses = buildConversationAccessClauses({ organizationId, user })
  const [conv] = await db
    .select()
    .from(schema.conversation)
    .where(and(
      eq(schema.conversation.id, conversationId),
      ...accessClauses
    ))
    .limit(1)

  return conv ?? null
}

/**
 * Creates a new conversation
 * Note: contentId parameter is removed - content should link to conversation via content.conversationId
 *
 * @param db - Database instance
 * @param input - Input parameters for conversation
 * @returns Newly created conversation
 */
export async function createConversation(
  db: NodePgDatabase<typeof schema>,
  input: EnsureConversationInput
) {
  const status: ConversationStatus = input.status ?? 'active'
  const sourceContentId = input.sourceContentId?.trim() || null
  const createdByUserId = input.createdByUserId?.trim() || null

  const result = await db
    .insert(schema.conversation)
    .values({
      organizationId: input.organizationId,
      sourceContentId,
      createdByUserId,
      status,
      metadata: input.metadata ?? null
    })
    .returning()

  const conv = (Array.isArray(result) ? result[0] : null) as typeof schema.conversation.$inferSelect | null
  if (!conv) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create conversation'
    })
  }

  return conv
}

export interface AddConversationMessageInput {
  conversationId: string
  organizationId: string
  role: ChatMessage['role'] | 'system'
  content: string
  payload?: Record<string, any> | null
  id?: string // Optional: use this ID instead of generating a new one
}

/**
 * Adds a message to a conversation
 *
 * @param db - Database instance
 * @param input - Message input parameters
 * @returns Created message record
 */
export async function addMessageToConversation(
  db: NodePgDatabase<typeof schema>,
  input: AddConversationMessageInput
) {
  if (!input.content.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Conversation message content cannot be empty'
    })
  }

  const [message] = await db
    .insert(schema.conversationMessage)
    .values({
      id: input.id,
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      role: input.role,
      content: input.content,
      payload: input.payload ?? null
    })
    .returning()

  return message
}

export interface AddConversationLogInput {
  conversationId: string
  organizationId: string
  type?: typeof schema.conversationLog.$inferSelect['type']
  message: string
  payload?: Record<string, any> | null
}

/**
 * Adds a log entry to a conversation
 *
 * @param db - Database instance
 * @param input - Log entry input parameters
 * @returns Created log entry record
 */
export async function addLogEntryToConversation(
  db: NodePgDatabase<typeof schema>,
  input: AddConversationLogInput
) {
  if (!input.message.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Conversation log message cannot be empty'
    })
  }

  const [log] = await db
    .insert(schema.conversationLog)
    .values({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      type: input.type ?? 'info',
      message: input.message,
      payload: input.payload ?? null
    })
    .returning()

  return log
}

export interface GetConversationMessagesOptions {
  limit?: number
  offset?: number
}

export async function getConversationMessages(
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string,
  options?: GetConversationMessagesOptions
) {
  const baseQuery = db
    .select()
    .from(schema.conversationMessage)
    .where(and(
      eq(schema.conversationMessage.conversationId, conversationId),
      eq(schema.conversationMessage.organizationId, organizationId)
    ))
    .orderBy(schema.conversationMessage.createdAt)

  if (options?.limit !== undefined) {
    if (options?.offset !== undefined) {
      return await baseQuery.limit(options.limit).offset(options.offset)
    }
    return await baseQuery.limit(options.limit)
  }

  if (options?.offset !== undefined) {
    return await baseQuery.offset(options.offset)
  }

  return await baseQuery
}

export async function getConversationLogs(
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string
) {
  return await db
    .select()
    .from(schema.conversationLog)
    .where(and(
      eq(schema.conversationLog.conversationId, conversationId),
      eq(schema.conversationLog.organizationId, organizationId)
    ))
    .orderBy(schema.conversationLog.createdAt)
}

const PREVIEW_MESSAGE_MAX_LENGTH = 280
const CONVERSATION_TITLE_MAX_LENGTH = 80
const CONVERSATION_TITLE_MESSAGE_LIMIT = 10
const CONVERSATION_TITLE_MESSAGE_LENGTH = 260
const UNTITLED_TITLE_REGEX = /^untitled conversation$/i

const normalizePreviewText = (content: string) => {
  if (!content) {
    return ''
  }
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= PREVIEW_MESSAGE_MAX_LENGTH) {
    return normalized
  }
  return `${normalized.slice(0, PREVIEW_MESSAGE_MAX_LENGTH - 3).trimEnd()}...`
}

const toISOStringOrNull = (value: Date | string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export interface ConversationPreviewMetadataPatch {
  latestMessage?: {
    role: 'user' | 'assistant' | 'system' | 'function'
    content: string
    createdAt: Date | string
  }
  latestArtifact?: {
    title: string | null
    updatedAt?: Date | string | null
  }
  artifactCount?: number
  diffStats?: { additions: number, deletions: number } | null
}

export const patchConversationPreviewMetadata = async (
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string,
  updates: ConversationPreviewMetadataPatch
) => {
  let patch = sql`'{}'::jsonb`
  let hasUpdates = false

  if (updates.latestMessage) {
    hasUpdates = true
    const createdAt = toISOStringOrNull(updates.latestMessage.createdAt) ?? new Date().toISOString()
    const previewMessage = normalizePreviewText(updates.latestMessage.content)
    patch = sql`${patch} || jsonb_build_object(
      'latestMessage',
      jsonb_build_object(
        'role', ${updates.latestMessage.role}::text,
        'content', ${previewMessage}::text,
        'createdAt', ${createdAt}::text
      )
    )`
  }

  if (updates.latestArtifact) {
    hasUpdates = true
    const updatedAt = toISOStringOrNull(updates.latestArtifact.updatedAt)
    patch = sql`${patch} || jsonb_build_object(
      'latestArtifact',
      jsonb_build_object(
        'title', ${updates.latestArtifact.title ?? null}::text,
        'updatedAt', ${updatedAt ?? null}::text
      )
    )`
  }

  if (typeof updates.artifactCount === 'number') {
    hasUpdates = true
    // Cast to integer explicitly so PostgreSQL can determine the type
    patch = sql`${patch} || jsonb_build_object('artifactCount', ${updates.artifactCount}::integer)`
  }

  // Require both additions and deletions to be present, finite, safe integers, and non-negative
  if (updates.diffStats) {
    const additions = updates.diffStats.additions
    const deletions = updates.diffStats.deletions
    const additionsValid = Number.isSafeInteger(additions) && additions >= 0
    const deletionsValid = Number.isSafeInteger(deletions) && deletions >= 0

    if (additionsValid && deletionsValid) {
      hasUpdates = true
      patch = sql`${patch} || jsonb_build_object(
        'diffStats',
        jsonb_build_object(
          'additions', ${additions}::integer,
          'deletions', ${deletions}::integer
        )
      )`
    }
  }

  if (!hasUpdates) {
    return
  }

  await db
    .update(schema.conversation)
    .set({
      metadata: sql`
        jsonb_set(
          COALESCE(${schema.conversation.metadata}, '{}'::jsonb),
          '{preview}',
          COALESCE(${schema.conversation.metadata}->'preview', '{}'::jsonb) || (${patch})
        )
      `,
      updatedAt: new Date()
    })
    .where(and(
      eq(schema.conversation.id, conversationId),
      eq(schema.conversation.organizationId, organizationId)
    ))
}

/**
 * Gets an existing conversation for content or creates a new one
 *
 * @param db - Database instance
 * @param input - Input parameters for conversation
 * @returns Existing or newly created conversation
 */
export async function getOrCreateConversationForContent(
  db: NodePgDatabase<typeof schema>,
  input: EnsureConversationInput
) {
  // If sourceContentId is provided, try to find existing conversation
  if (input.sourceContentId) {
    const [existing] = await db
      .select()
      .from(schema.conversation)
      .where(and(
        eq(schema.conversation.sourceContentId, input.sourceContentId),
        eq(schema.conversation.organizationId, input.organizationId)
      ))
      .limit(1)

    if (existing) {
      return existing
    }
  }

  // No existing conversation found, create a new one
  return await createConversation(db, input)
}

const truncateForTitle = (value: string, limit: number) => {
  if (!value) {
    return ''
  }
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, limit - 1).trimEnd()}…`
}

const normalizeTitleCandidate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const cleaned = value
    .replace(/`/g, '')
    .replace(/^[\s"“”'‘’]+/, '')
    .replace(/[\s"“”'‘’]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) {
    return null
  }

  const stripped = cleaned
    .replace(/^[\d.\-–—•\s]+/, '')
    .replace(/[.!?]+$/, '')
    .trim()

  if (!stripped || UNTITLED_TITLE_REGEX.test(stripped)) {
    return null
  }

  if (stripped.length > CONVERSATION_TITLE_MAX_LENGTH) {
    return `${stripped.slice(0, CONVERSATION_TITLE_MAX_LENGTH - 1).trimEnd()}…`
  }

  return stripped
}

const buildTitlePrompt = (messages: ChatCompletionMessage[]) => {
  const recent = messages
    .filter(message => typeof message.content === 'string' && message.content.trim().length > 0)
    .slice(-CONVERSATION_TITLE_MESSAGE_LIMIT)
    .map((message) => {
      const label = message.role === 'assistant'
        ? 'Assistant'
        : message.role === 'system'
          ? 'System'
          : 'User'
      const body = truncateForTitle(message.content ?? '', CONVERSATION_TITLE_MESSAGE_LENGTH)
      return `${label}: ${body}`
    })
    .filter(Boolean)
    .join('\n')

  return [
    'Generate a concise, specific title for this chat between a user and an assistant.',
    'Requirements:',
    '- Reflect the user’s goal or the assistant’s outcome.',
    '- Keep it under 8 words and 60 characters.',
    '- Title case preferred. No quotes, brackets, or punctuation at the ends.',
    '- Avoid generic labels like "Chat" or "Conversation".',
    'Return only the title text.',
    '',
    'Conversation:',
    recent
  ].join('\n')
}

const generateTitleWithAI = async (messages: ChatCompletionMessage[]): Promise<string | null> => {
  if (!messages.length) {
    return null
  }

  const prompt = buildTitlePrompt(messages)
  const rawTitle = await callChatCompletions({
    messages: [
      { role: 'system', content: 'You are an expert at summarizing conversations into short, descriptive titles.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    maxTokens: 40
  })

  return normalizeTitleCandidate(rawTitle)
}

export const maybeGenerateConversationTitle = async (
  db: NodePgDatabase<typeof schema>,
  conversationId: string,
  organizationId: string,
  messages: typeof schema.conversationMessage.$inferSelect[],
  existingMetadata?: Record<string, any> | null
): Promise<string | null> => {
  try {
    const [conversationRecord] = await db
      .select({ metadata: schema.conversation.metadata })
      .from(schema.conversation)
      .where(and(
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.organizationId, organizationId)
      ))
      .limit(1)

    const metadata = conversationRecord?.metadata ?? existingMetadata ?? null
    const currentTitle = normalizeTitleCandidate(typeof metadata?.title === 'string' ? metadata.title : null)
    if (currentTitle && !UNTITLED_TITLE_REGEX.test(currentTitle)) {
      return currentTitle
    }

    const normalizedMessages: ChatCompletionMessage[] = messages
      .filter(message => typeof message.content === 'string' && message.content.trim().length > 0)
      .map(message => ({
        role: message.role === 'assistant'
          ? 'assistant'
          : message.role === 'system'
            ? 'system'
            : 'user',
        content: message.content
      }))

    const hasAssistant = normalizedMessages.some(message => message.role === 'assistant')
    const userMessages = normalizedMessages.filter(message => message.role === 'user')
    if (!hasAssistant || userMessages.length === 0 || normalizedMessages.length < 2) {
      return currentTitle ?? null
    }

    const generatedTitle = await generateTitleWithAI(normalizedMessages)
    const normalizedGenerated = normalizeTitleCandidate(generatedTitle)

    if (!normalizedGenerated) {
      return currentTitle ?? null
    }

    const nextMetadata = {
      ...(metadata ?? {}),
      title: normalizedGenerated,
      titleGeneratedAt: new Date().toISOString()
    }

    await db
      .update(schema.conversation)
      .set({
        metadata: nextMetadata,
        updatedAt: new Date()
      })
      .where(and(
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.organizationId, organizationId)
      ))

    safeLog('[conversation] Generated title for conversation', {
      conversationId,
      organizationId
    })

    return normalizedGenerated
  } catch (error) {
    safeError('[conversation] Failed to generate conversation title', {
      conversationId,
      organizationId,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    return null
  }
}
