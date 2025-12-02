import type { INGEST_STATUSES } from '~~/server/services/sourceContent'

/**
 * Ingest status values
 */
export type IngestStatus = typeof INGEST_STATUSES[number]

/**
 * Request body for creating source content from transcript
 */
export interface CreateSourceContentFromTranscriptRequestBody {
  /** Raw transcript text (required) */
  transcript: string
  /** Optional title for the source content */
  title?: string | null
  /** Optional metadata */
  metadata?: Record<string, any> | null
}

/**
 * Request body for ingesting YouTube video as source content
 */
export interface IngestYouTubeVideoAsSourceContentRequestBody {
  /** YouTube video URL (required) */
  youtubeUrl: string
  /** Optional title hint */
  titleHint?: string | null
}

/**
 * Response from ingesting YouTube video
 */
export interface IngestYouTubeVideoAsSourceContentResponse {
  /** ID of the created/updated source content */
  sourceContentId: string
  /** Current ingest status */
  ingestStatus: IngestStatus
  /** The source content record */
  sourceContent: {
    id: string
    organizationId: string
    sourceType: string
    externalId: string | null
    title: string | null
    ingestStatus: IngestStatus
    createdAt: Date
    updatedAt: Date
  }
}

/**
 * Request body for creating/updating source content
 */
export interface UpsertSourceContentRequestBody {
  /** Type of source (youtube, manual_transcript, etc.) */
  sourceType: string
  /** External ID (e.g., YouTube video ID) */
  externalId?: string | null
  /** Title of the source content */
  title?: string | null
  /** Source text/transcript */
  sourceText?: string | null
  /** Metadata */
  metadata?: Record<string, any> | null
  /** Ingest status */
  ingestStatus?: IngestStatus
}
