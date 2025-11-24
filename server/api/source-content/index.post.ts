import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { upsertSourceContent } from '~~/server/services/sourceContent'

interface SourceContentRequestBody {
  sourceType: string
  externalId?: string | null
  title?: string | null
  sourceText?: string | null
  metadata?: Record<string, any> | null
  ingestStatus?: 'pending' | 'ingested' | 'failed'
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const body = await readBody<SourceContentRequestBody>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body'
    })
  }

  if (!body?.sourceType || typeof body.sourceType !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'sourceType is required'
    })
  }

  const record = await upsertSourceContent(db, {
    organizationId,
    userId: user.id,
    sourceType: body.sourceType,
    externalId: typeof body.externalId === 'string' ? body.externalId : null,
    title: typeof body.title === 'string' ? body.title : null,
    sourceText: typeof body.sourceText === 'string' ? body.sourceText : null,
    metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : null,
    ingestStatus: body.ingestStatus
  })

  return record
})
