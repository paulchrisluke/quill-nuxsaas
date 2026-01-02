import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '~~/server/db/schema'
import type { ImageSuggestion } from './types'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { extractScreencapFromYouTube } from './screencaps'
import { insertMarkdownAtLine } from './utils'

const normalizeIndex = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.floor(value)
}

export const insertImageSuggestion = async (
  db: NodePgDatabase<typeof schema>,
  params: {
    organizationId: string
    userId: string
    contentId: string
    suggestionIndex: number
  }
) => {
  const { organizationId, userId, contentId } = params
  const suggestionIndex = normalizeIndex(params.suggestionIndex)

  const [record] = await db
    .select({
      content: schema.content,
      version: schema.contentVersion,
      sourceContent: schema.sourceContent
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .leftJoin(schema.sourceContent, eq(schema.sourceContent.id, schema.content.sourceContentId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, contentId)
    ))
    .limit(1)

  if (!record || !record.content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  if (!record.version) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content has no current version to update'
    })
  }

  const assets = (record.version.assets || {}) as Record<string, any>
  const imageSuggestions = Array.isArray((assets as any).imageSuggestions)
    ? (assets as any).imageSuggestions as ImageSuggestion[]
    : []

  if (!imageSuggestions.length || suggestionIndex < 0 || suggestionIndex >= imageSuggestions.length) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Image suggestion not found'
    })
  }

  const suggestion = imageSuggestions[suggestionIndex]
  if (suggestion.status === 'added') {
    throw createError({
      statusCode: 400,
      statusMessage: 'This image suggestion has already been inserted'
    })
  }

  const storageConfig = useFileManagerConfig()
  const storageProvider = await createStorageProvider(storageConfig.storage)
  const fileService = new FileService(storageProvider)

  let imageUrl: string
  let uploadedFileId: string

  // Handle different suggestion types
  if (suggestion.type === 'screencap') {
    const videoId = suggestion.videoId || record.sourceContent?.externalId
    if (!videoId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Video ID is required to extract the screencap'
      })
    }

    const extraction = await extractScreencapFromYouTube({
      videoId,
      timestampSeconds: suggestion.estimatedTimestamp ?? 0,
      variant: 'full'
    })

    const uploaded = await fileService.uploadFile(
      extraction.buffer,
      extraction.fileName,
      extraction.mimeType,
      userId,
      undefined,
      undefined,
      {
        fileName: extraction.fileName,
        overrideOriginalName: extraction.fileName,
        contentId: record.content.id
      }
    )

    imageUrl = uploaded.url || uploaded.path
    uploadedFileId = uploaded.id
  } else if (suggestion.type === 'uploaded') {
    // For uploaded type, the file should already exist
    if (suggestion.fullSizeFileId) {
      const file = await fileService.getFile(suggestion.fullSizeFileId)
      if (!file) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Referenced file not found'
        })
      }
      imageUrl = file.url || file.path
      uploadedFileId = file.id
    } else if (suggestion.fullSizeUrl) {
      // If we have a URL but no fileId, use the URL directly
      // External URLs won't have a file ID in our system
      imageUrl = suggestion.fullSizeUrl
      uploadedFileId = '' // No file ID for external URLs
    } else {
      throw createError({
        statusCode: 400,
        statusMessage: 'Uploaded image suggestion requires fullSizeFileId or fullSizeUrl'
      })
    }
  } else if (suggestion.type === 'generated') {
    // For generated type, we can't auto-generate images yet
    // But if they provide a fileId, we can use it
    if (suggestion.fullSizeFileId) {
      const file = await fileService.getFile(suggestion.fullSizeFileId)
      if (!file) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Referenced file not found'
        })
      }
      imageUrl = file.url || file.path
      uploadedFileId = file.id
    } else {
      throw createError({
        statusCode: 400,
        statusMessage: 'Generated image suggestions require fullSizeFileId. Image generation is coming soon.'
      })
    }
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsupported image suggestion type'
    })
  }
  const markdownImage = `![${suggestion.altText || 'Image'}](${imageUrl})`
  const existingMarkdown = record.version.bodyMarkdown || ''
  const targetLine = typeof suggestion.position === 'number' && Number.isFinite(suggestion.position)
    ? suggestion.position
    : existingMarkdown.split('\n').length + 1
  const updatedMarkdown = insertMarkdownAtLine(existingMarkdown, targetLine, markdownImage)

  const updatedSuggestions = [...imageSuggestions]
  const updatedSuggestion: ImageSuggestion = {
    ...suggestion,
    fullSizeFileId: uploadedFileId || suggestion.fullSizeFileId,
    fullSizeUrl: imageUrl,
    status: 'added'
  }
  updatedSuggestions[suggestionIndex] = updatedSuggestion

  const updatedAssets = {
    ...assets,
    imageSuggestions: updatedSuggestions,
    generator: assets.generator
      ? {
          ...(assets.generator as Record<string, any>),
          stages: Array.isArray((assets.generator as any).stages)
            ? [...new Set([...(assets.generator as any).stages, 'image_insert'])]
            : ['image_insert']
        }
      : {
          engine: 'codex-pipeline',
          generatedAt: new Date().toISOString(),
          stages: ['image_insert']
        }
  }

  const result = await db.transaction(async (tx) => {
    // Verify the version hasn't changed since we read it
    const [currentContent] = await tx
      .select({ currentVersionId: schema.content.currentVersionId })
      .from(schema.content)
      .where(eq(schema.content.id, record.content.id))
      .limit(1)

    if (currentContent?.currentVersionId !== record.version.id) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Content was modified by another process. Please retry.'
      })
    }

    const [latestVersion] = await tx
      .select({ version: schema.contentVersion.version })
      .from(schema.contentVersion)
      .where(eq(schema.contentVersion.contentId, record.content.id))
      .orderBy(desc(schema.contentVersion.version))
      .limit(1)

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1

    const [newVersion] = await tx
      .insert(schema.contentVersion)
      .values({
        id: uuidv7(),
        contentId: record.content.id,
        version: nextVersionNumber,
        createdByUserId: userId,
        frontmatter: record.version.frontmatter,
        bodyMarkdown: updatedMarkdown,
        sections: record.version.sections,
        assets: updatedAssets,
        seoSnapshot: record.version.seoSnapshot
      })
      .returning()

    if (!newVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create updated content version'
      })
    }

    const [updatedContent] = await tx
      .update(schema.content)
      .set({
        currentVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(schema.content.id, record.content.id))
      .returning()

    if (!updatedContent) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to update content record'
      })
    }

    return {
      content: updatedContent,
      version: newVersion
    }
  })

  return {
    content: result.content,
    version: result.version,
    markdown: updatedMarkdown,
    suggestion: updatedSuggestion
  }
}
