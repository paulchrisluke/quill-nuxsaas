import type { SQL } from 'drizzle-orm'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { createError, getValidatedQuery } from 'h3'
import { z } from 'zod'
import * as schema from '~~/server/db/schema'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  contentId: z.string().uuid().optional(),
  fileType: z.string().optional(),
  includeArchived: z.coerce.boolean().optional().default(false)
})

interface CursorPayload {
  id: string
  updatedAt: string
}

const MAX_CURSOR_LENGTH = 2048

// Use Web APIs that work in both Node.js and Cloudflare Workers
const encodeCursor = (payload: CursorPayload) => {
  const json = JSON.stringify(payload)
  // Use TextEncoder for UTF-8 encoding, then convert to base64
  const encoder = new TextEncoder()
  const bytes = encoder.encode(json)
  // Convert bytes to base64 using btoa on the binary string
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i] ?? 0
    binary += String.fromCharCode(code)
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

const decodeCursor = (cursor: string): CursorPayload => {
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid cursor value'
    })
  }

  try {
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const paddingNeeded = (4 - (base64.length % 4 || 4)) % 4
    const padded = `${base64}${'='.repeat(paddingNeeded)}`
    // Use atob to decode base64, then TextDecoder for UTF-8
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const decoder = new TextDecoder()
    const json = decoder.decode(bytes)
    const parsed = JSON.parse(json) as CursorPayload
    if (!parsed?.id || !parsed?.updatedAt) {
      throw new Error('Invalid payload')
    }
    return parsed
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid cursor value'
    })
  }
}

/**
 * Lists files for the organization with pagination
 *
 * @description Returns paginated file records scoped to the active organization
 *
 * @returns Paginated array of file records
 */
export default defineEventHandler(async (event) => {
  try {
    await requireAuth(event)
    const { organizationId } = await requireActiveOrganization(event)

    const query = await getValidatedQuery(event, querySchema.parse)
    const db = await useDB(event)

    let cursorDate: Date | null = null
    let cursorId: string | null = null
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor)
      cursorId = decoded.id
      const parsedDate = new Date(decoded.updatedAt)
      if (Number.isNaN(parsedDate.getTime())) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          message: 'Invalid cursor value'
        })
      }
      cursorDate = parsedDate
    }

    const whereClauses: SQL<unknown>[] = [eq(schema.file.organizationId, organizationId)]
    if (!query.includeArchived) {
      whereClauses.push(eq(schema.file.isActive, true))
    }

    if (query.contentId) {
      whereClauses.push(eq(schema.file.contentId, query.contentId))
    }

    if (query.fileType) {
      whereClauses.push(eq(schema.file.fileType, query.fileType))
    }

    if (cursorDate && cursorId) {
      const cursorFilter = or(
        lt(schema.file.updatedAt, cursorDate),
        and(
          eq(schema.file.updatedAt, cursorDate),
          lt(schema.file.id, cursorId)
        )
      )
      if (cursorFilter) {
        whereClauses.push(cursorFilter)
      }
    }

    const whereClause = whereClauses.length === 1 ? whereClauses[0]! : and(...whereClauses)

    const results = await db
      .select({
        id: schema.file.id,
        originalName: schema.file.originalName,
        fileName: schema.file.fileName,
        mimeType: schema.file.mimeType,
        fileType: schema.file.fileType,
        size: schema.file.size,
        path: schema.file.path,
        url: schema.file.url,
        contentId: schema.file.contentId,
        isActive: schema.file.isActive,
        createdAt: schema.file.createdAt,
        updatedAt: schema.file.updatedAt
      })
      .from(schema.file)
      .where(whereClause)
      .orderBy(desc(schema.file.updatedAt), desc(schema.file.id))
      .limit(query.limit + 1)

    const hasMore = results.length > query.limit
    const files = hasMore ? results.slice(0, query.limit) : results

    let nextCursor: string | null = null
    if (hasMore && files.length > 0) {
      const lastFile = files[files.length - 1]!
      const updatedAtDate = lastFile.updatedAt instanceof Date ? lastFile.updatedAt : new Date(lastFile.updatedAt)
      nextCursor = encodeCursor({
        id: lastFile.id,
        updatedAt: updatedAtDate.toISOString()
      })
    }

    return {
      files: files.map(file => ({
        id: file.id,
        originalName: file.originalName,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileType: file.fileType,
        size: file.size,
        path: file.path,
        url: file.url,
        contentId: file.contentId,
        isActive: file.isActive,
        createdAt: file.createdAt instanceof Date ? file.createdAt.toISOString() : file.createdAt,
        updatedAt: file.updatedAt instanceof Date ? file.updatedAt.toISOString() : file.updatedAt
      })),
      nextCursor,
      hasMore,
      limit: query.limit
    }
  } catch (error) {
    // Log detailed error information server-side
    console.error('[File API] Error caught:', error)
    if (error instanceof Error) {
      console.error('[File API] Error name:', error.name)
      console.error('[File API] Error message:', error.message)
      console.error('[File API] Error stack:', error.stack)
    } else {
      console.error('[File API] Error type:', typeof error)
      console.error('[File API] Error value:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
    }
    // Re-throw H3 errors as-is, wrap others
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    // Return generic error message to client (never expose internal error details)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Internal Server Error'
    })
  }
})
