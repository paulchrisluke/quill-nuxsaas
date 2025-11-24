import { desc, eq } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import { requireAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = getDB()

  const rows = await db
    .select({
      content: schema.content,
      sourceContent: schema.sourceContent,
      currentVersion: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(eq(schema.content.organizationId, organizationId))
    .orderBy(desc(schema.content.updatedAt))

  return rows
})
