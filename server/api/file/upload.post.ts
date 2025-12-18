import { readMultipartFormData } from 'h3'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { UploadRateLimiter } from '~~/server/services/file/rateLimiter'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const config = useFileManagerConfig()

  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)

  // Get contentId from query params if provided
  // Handle both string and string[] inputs (use first element if array)
  const contentId = getQuery(event).contentId
  let validatedContentId: string | null = null

  if (Array.isArray(contentId)) {
    // If array, use first element
    const firstValue = contentId[0]
    if (typeof firstValue === 'string' && firstValue.trim()) {
      validatedContentId = firstValue.trim()
    }
  } else if (typeof contentId === 'string' && contentId.trim()) {
    validatedContentId = contentId.trim()
  }

  // Enforce max length (255 chars) and reject values exceeding it
  if (validatedContentId && validatedContentId.length > 255) {
    validatedContentId = null
  }

  // NOTE: contentId should be validated/sanitized before passing to fileService.uploadFile
  // or the storage layer (or validate again in those layers) to prevent injection or path traversal

  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No files provided'
    })
  }

  // Limit to single file upload
  const validFiles = formData.filter(fileData => fileData.data && fileData.filename)
  if (validFiles.length > 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Only one file can be uploaded at a time'
    })
  }
  if (validFiles.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No files provided'
    })
  }

  // Check upload rate limit if enabled
  if (config.uploadRateLimit) {
    const { maxUploadsPerWindow, windowSizeMinutes } = config.uploadRateLimit
    const rateLimiter = new UploadRateLimiter(windowSizeMinutes, maxUploadsPerWindow)

    const { allowed, currentCount } = await rateLimiter.checkAndIncrement(user.id)

    if (!allowed) {
      throw createError({
        statusCode: 429,
        statusMessage: `Upload rate limit exceeded. Maximum ${maxUploadsPerWindow} uploads per ${windowSizeMinutes} minutes. Current count: ${currentCount}`
      })
    }
  }

  const storageProvider = await createStorageProvider(config.storage)
  const fileService = new FileService(storageProvider)

  const fileData = validFiles[0]!

  const mimeType = fileData.type || 'application/octet-stream'
  const fileSize = fileData.data.length

  if (config.maxFileSize && fileSize > config.maxFileSize) {
    throw createError({
      statusCode: 413,
      statusMessage: `File size exceeds maximum allowed size of ${formatFileSize(config.maxFileSize)}`
    })
  }

  if (config.allowedMimeTypes && config.allowedMimeTypes.length > 0) {
    if (!config.allowedMimeTypes.includes(mimeType)) {
      throw createError({
        statusCode: 415,
        statusMessage: `File type '${mimeType}' is not allowed.`
      })
    }
  }

  try {
    const file = await fileService.uploadFile(
      fileData.data,
      fileData.filename!,
      mimeType,
      user.id,
      getRequestIP(event),
      getHeader(event, 'user-agent'),
      {
        organizationId,
        contentId: validatedContentId ?? undefined
      }
    )
    return {
      success: true,
      file
    }
  } catch (error) {
    console.error(error)
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Upload failed'
    })
  }
})
