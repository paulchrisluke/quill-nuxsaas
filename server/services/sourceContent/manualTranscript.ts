import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '~~/server/database/schema'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { chunkSourceContentText } from '~~/server/services/sourceContent/chunkSourceContent'

export const MANUAL_TRANSCRIPT_SOURCE_TYPE = 'manual_transcript'

interface CreateManualTranscriptOptions {
  db: NodePgDatabase<typeof schema>
  organizationId: string
  userId: string
  transcript: string
  title?: string | null
  metadata?: Record<string, any> | null
  onProgress?: (message: string) => Promise<void> | void
}

export const createManualTranscriptSourceContent = async ({
  db,
  organizationId,
  userId,
  transcript,
  title,
  metadata,
  onProgress
}: CreateManualTranscriptOptions) => {
  console.log(`🚀 [MANUAL_TRANSCRIPT] Starting manual transcript creation...`)
  console.log(`🚀 [MANUAL_TRANSCRIPT] Transcript length: ${transcript.length} characters`)

  const normalizedTranscript = transcript.trim()
  if (!normalizedTranscript) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Transcript cannot be empty'
    })
  }

  await onProgress?.('Saving transcript...')

  const result = await db.transaction(async (tx) => {
    const sourceContent = await upsertSourceContent(tx, {
      organizationId,
      userId,
      sourceType: MANUAL_TRANSCRIPT_SOURCE_TYPE,
      externalId: uuidv7(),
      title: title ?? null,
      sourceText: normalizedTranscript,
      metadata: {
        ...(metadata ?? {}),
        origin: metadata?.origin ?? 'transcript'
      },
      ingestStatus: 'ingested'
    })

    console.log(`✅ [MANUAL_TRANSCRIPT] Created sourceContent: ${sourceContent.id}`)
    console.log(`🔧 [MANUAL_TRANSCRIPT] About to call chunkSourceContentText...`)

    await onProgress?.('Chunking transcript into searchable segments...')

    try {
      await chunkSourceContentText({
        db: tx,
        sourceContent,
        onProgress: async (progress) => {
          if (progress.includes('embedding') || progress.includes('vector')) {
            await onProgress?.(progress)
          }
        }
      })
    } catch (error) {
      console.error(`❌ [MANUAL_TRANSCRIPT] Chunking failed for: ${sourceContent.id}`, error)
      throw error
    }

    await onProgress?.('Generating embeddings for semantic search...')

    console.log(`🎉 [MANUAL_TRANSCRIPT] Completed chunking for: ${sourceContent.id}`)
    return sourceContent
  })

  await onProgress?.('✓ Transcript processed and ready!')

  return result
}
