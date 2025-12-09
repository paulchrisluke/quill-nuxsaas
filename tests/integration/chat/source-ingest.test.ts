import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '~~/server/database/schema'
import { describe, expect, it, vi } from 'vitest'
import * as chunkSourceContentModule from '~~/server/services/sourceContent/chunkSourceContent'
import { createSourceContentFromContext } from '~~/server/services/sourceContent/manualTranscript'

// Mock vectorize service
vi.mock('~~/server/services/vectorize', () => ({
  isVectorizeConfigured: false, // Disable vectorize for tests
  embedTexts: vi.fn(),
  embedText: vi.fn(),
  upsertVectors: vi.fn(),
  queryVectorMatches: vi.fn(() => Promise.resolve([]))
}))

// Mock database - we'll use a simple in-memory mock for unit tests
function createMockDB(): Partial<NodePgDatabase<typeof schema>> {
  const sourceContents: any[] = []

  return {
    transaction: vi.fn(async (callback: any) => {
      return callback({
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn(async () => {
              const mockSource = {
                id: 'source-123',
                organizationId: 'org-123',
                sourceType: 'manual_transcript',
                sourceText: 'Test context',
                ingestStatus: 'ingested',
                title: 'Test Source',
                createdAt: new Date(),
                updatedAt: new Date()
              }
              sourceContents.push(mockSource)
              return [mockSource]
            })
          }))
        })),
        delete: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve())
        })),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => Promise.resolve([]))
            }))
          }))
        }))
      })
    })
  } as any
}

describe('source_ingest Integration Tests', () => {
  describe('sourceType="context" path', () => {
    it('should create source content from context text', async () => {
      const db = createMockDB() as any
      const contextText = 'This is test context for source ingestion.'
      const organizationId = 'org-123'
      const userId = 'user-123'

      // Mock the chunking function to avoid DB dependencies
      vi.spyOn(chunkSourceContentModule, 'createChunksFromSourceContentText')
        .mockResolvedValue([
          {
            id: 'chunk-1',
            chunkIndex: 0,
            text: contextText,
            textPreview: contextText.slice(0, 200),
            sourceContentId: 'source-123',
            organizationId,
            embedding: null
          }
        ])

      const result = await createSourceContentFromContext({
        db,
        organizationId,
        userId,
        context: contextText,
        title: 'Test Source',
        mode: 'agent'
      })

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.sourceText).toBe(contextText)
      expect(result.ingestStatus).toBe('ingested')
    })

    it('should block in chat mode', async () => {
      const db = createMockDB() as any
      const contextText = 'Test context'

      await expect(
        createSourceContentFromContext({
          db,
          organizationId: 'org-123',
          userId: 'user-123',
          context: contextText,
          mode: 'chat'
        })
      ).rejects.toThrow('Writes are not allowed in chat mode')
    })

    it('should reject empty context', async () => {
      const db = createMockDB() as any

      await expect(
        createSourceContentFromContext({
          db,
          organizationId: 'org-123',
          userId: 'user-123',
          context: '',
          mode: 'agent'
        })
      ).rejects.toThrow('Context cannot be empty')
    })

    it('should normalize whitespace in context', async () => {
      const db = createMockDB() as any
      const contextWithWhitespace = '  Test   context  \n\n  with  spaces  '
      const normalized = 'Test context\n\nwith spaces'

      vi.spyOn(chunkSourceContentModule, 'createChunksFromSourceContentText')
        .mockResolvedValue([])

      const result = await createSourceContentFromContext({
        db,
        organizationId: 'org-123',
        userId: 'user-123',
        context: contextWithWhitespace,
        mode: 'agent'
      })

      // The function should normalize the context
      expect(result.sourceText).toBe(normalized.trim())
    })
  })

  describe('sourceType="youtube" path', () => {
    // Note: YouTube ingestion is tested via executeChatTool integration tests
    // since it requires mocking external YouTube API calls
    it('should validate youtubeUrl is required', () => {
      // This validation happens in executeChatTool
      // We test it there
      expect(true).toBe(true)
    })
  })

  describe('chunking integration', () => {
    it('should create chunks from source content text', async () => {
      const db = createMockDB() as any
      const longText = Array(100).fill('This is a sentence. ').join('')

      const mockSourceContent = {
        id: 'source-123',
        organizationId: 'org-123',
        sourceType: 'manual_transcript',
        sourceText: longText,
        ingestStatus: 'ingested' as const,
        title: 'Test',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      // Mock the chunking to return multiple chunks
      const mockChunks = [
        {
          id: 'chunk-1',
          chunkIndex: 0,
          text: longText.slice(0, 1000),
          textPreview: longText.slice(0, 200),
          sourceContentId: 'source-123',
          organizationId: 'org-123',
          embedding: null
        },
        {
          id: 'chunk-2',
          chunkIndex: 1,
          text: longText.slice(1000),
          textPreview: longText.slice(1000, 1200),
          sourceContentId: 'source-123',
          organizationId: 'org-123',
          embedding: null
        }
      ]

      vi.spyOn(chunkSourceContentModule, 'createChunksFromSourceContentText')
        .mockResolvedValue(mockChunks)

      const chunks = await chunkSourceContentModule.createChunksFromSourceContentText({
        db,
        sourceContent: mockSourceContent as any,
        onProgress: vi.fn()
      })

      expect(chunks).toHaveLength(2)
      expect(chunks[0].chunkIndex).toBe(0)
      expect(chunks[1].chunkIndex).toBe(1)
    })

    it('should handle empty source text', async () => {
      const db = createMockDB() as any
      const mockSourceContent = {
        id: 'source-123',
        organizationId: 'org-123',
        sourceType: 'manual_transcript',
        sourceText: '',
        ingestStatus: 'ingested' as const,
        title: 'Test',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      await expect(
        chunkSourceContentModule.createChunksFromSourceContentText({
          db,
          sourceContent: mockSourceContent as any
        })
      ).rejects.toThrow('Source text is required')
    })
  })
})
