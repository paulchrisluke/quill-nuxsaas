import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/database/schema'
import { v7 as uuidv7 } from 'uuid'

export const INGEST_STATUSES = ['pending', 'ingested', 'failed'] as const

export interface SourceContentUpsertInput {
  organizationId: string
  userId: string
  sourceType: string
  externalId?: string | null
  title?: string | null
  sourceText?: string | null
  metadata?: Record<string, any> | null
  ingestStatus?: typeof INGEST_STATUSES[number]
}

export const upsertSourceContent = async (
  db: NodePgDatabase<typeof schema>,
  input: SourceContentUpsertInput
) => {
  if (!input.sourceType) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sourceType is required'
    })
  }

  const ingestStatus = input.ingestStatus && INGEST_STATUSES.includes(input.ingestStatus)
    ? input.ingestStatus
    : 'pending'

  let existing: typeof schema.sourceContent.$inferSelect | undefined

  if (input.externalId) {
    const matches = await db
      .select()
      .from(schema.sourceContent)
      .where(and(
        eq(schema.sourceContent.organizationId, input.organizationId),
        eq(schema.sourceContent.sourceType, input.sourceType),
        eq(schema.sourceContent.externalId, input.externalId)
      ))
      .limit(1)

    existing = matches[0]
  }

  const payload = {
    title: typeof input.title === 'string' ? input.title : existing?.title ?? null,
    sourceText: typeof input.sourceText === 'string' ? input.sourceText : existing?.sourceText ?? null,
    metadata: input.metadata ?? existing?.metadata ?? null,
    ingestStatus
  }

  if (existing) {
    const [updated] = await db
      .update(schema.sourceContent)
      .set({
        ...payload,
        updatedAt: new Date()
      })
      .where(eq(schema.sourceContent.id, existing.id))
      .returning()

    return updated
  }

  const [created] = await db
    .insert(schema.sourceContent)
    .values({
      id: uuidv7(),
      organizationId: input.organizationId,
      createdByUserId: input.userId,
      sourceType: input.sourceType,
      externalId: input.externalId ?? null,
      ...payload
    })
    .returning()

  return created
}
