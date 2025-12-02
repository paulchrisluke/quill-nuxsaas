/**
 * Standard API error response format
 */
import type { ContentStatus, ContentType } from './content'

export interface ApiErrorResponse {
  statusCode: number
  statusMessage: string
  data?: Record<string, any>
}

/**
 * Standard pagination parameters
 */
export interface PaginationParams {
  /** Number of items per page */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Page number (alternative to offset) */
  page?: number
  /** Items per page (alternative to limit) */
  perPage?: number
}

/**
 * Standard pagination response
 */
export interface PaginationResponse {
  limit: number
  offset: number
  total: number
  hasMore: boolean
  nextOffset: number | null
}

/**
 * Standard list response with pagination
 */
export interface ListResponse<T> {
  data: T[]
  pagination: PaginationResponse
}

/**
 * Chat action types for content generation
 */
export type ChatActionType = 'generate_content' | 'patch_section'

/**
 * Chat action for generating content
 */
export interface ChatActionGenerateContent {
  type: 'generate_content'
  sourceContentId?: string | null
  contentId?: string | null
  transcript?: string | null
  title?: string | null
  slug?: string | null
  status?: ContentStatus
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: ContentType
  systemPrompt?: string
  temperature?: number
}

/**
 * Chat action for patching a section
 */
export interface ChatActionPatchSection {
  type: 'patch_section'
  contentId?: string | null
  sectionId?: string | null
  sectionTitle?: string | null
  instructions?: string | null
  temperature?: number
}

/**
 * Union type for all chat actions
 */
export type ChatAction = ChatActionGenerateContent | ChatActionPatchSection

/**
 * Request body for chat endpoint
 */
export interface ChatRequestBody {
  /** User message */
  message: string
  /** Optional action to perform */
  action?: ChatAction
}
