import { createError, readBody } from 'h3'
import { parseReferences } from '~~/server/services/chat/references/parser'
import { resolveReferences } from '~~/server/services/chat/references/resolver'
import { getAuthSession, requireActiveOrganization } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'

interface ResolveReferencesBody {
  message: string
  organizationId: string
  currentContentId?: string | null
  mode?: 'chat' | 'agent'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ResolveReferencesBody>(event)

  if (!body?.message || typeof body.message !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'message is required'
    })
  }

  if (!body.organizationId || typeof body.organizationId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'organizationId is required'
    })
  }

  const mode = body.mode === 'agent' ? 'agent' : 'chat'
  const { organizationId } = await requireActiveOrganization(event)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[resolve-references] request', {
      organizationId,
      bodyOrganizationId: body.organizationId,
      currentContentId: body.currentContentId ?? null,
      mode,
      messageLength: body.message.length
    })
  }

  if (organizationId !== body.organizationId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Organization mismatch'
    })
  }

  const db = await useDB(event)
  const session = await getAuthSession(event)
  const tokens = parseReferences(body.message)

  const result = await resolveReferences(tokens, {
    db,
    organizationId,
    currentContentId: body.currentContentId ?? null,
    userId: session?.user?.id ?? null,
    mode
  })
  if (process.env.NODE_ENV !== 'production') {
    console.log('[resolve-references] response', {
      organizationId,
      tokenCount: result.tokens?.length ?? 0,
      resolvedCount: result.resolved?.length ?? 0,
      ambiguousCount: result.ambiguous?.length ?? 0,
      unresolvedCount: result.unresolved?.length ?? 0
    })
  }
  return result
})
