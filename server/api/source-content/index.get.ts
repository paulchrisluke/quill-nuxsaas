import { and, desc, eq } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const query = getQuery(event)
  const sourceType = typeof query.sourceType === 'string' ? query.sourceType : undefined
  const ingestStatus = typeof query.ingestStatus === 'string' ? query.ingestStatus : undefined

  let whereClause = eq(schema.sourceContent.organizationId, organizationId)

  if (sourceType) {
    whereClause = and(whereClause, eq(schema.sourceContent.sourceType, sourceType))
  }

  if (ingestStatus) {
    whereClause = and(whereClause, eq(schema.sourceContent.ingestStatus, ingestStatus))
  }

  const rows = await db.select()
    .from(schema.sourceContent)
    .where(whereClause)
    .orderBy(desc(schema.sourceContent.updatedAt))

  return rows
})
