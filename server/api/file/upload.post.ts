import { Buffer } from 'node:buffer'
import { readMultipartFormData } from 'h3'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { UploadRateLimiter } from '~~/server/services/file/rateLimiter'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { isSVGSafe, sanitizeSVG } from '~~/server/services/file/svgSanitizer'
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
  const fileName = fileData.filename!
  const fileExtension = fileName.split('.').pop()?.toLowerCase()

  // Check if this is an SVG file (by mime type or extension)
  const isSVG = mimeType === 'image/svg+xml' || fileExtension === 'svg'

  // Sanitize SVG files to prevent XSS attacks
  let fileBuffer = fileData.data
  if (isSVG) {
    try {
      const svgContent = fileBuffer.toString('utf-8')
      const sanitizeResult = sanitizeSVG(svgContent)

      // Log sanitization attempt
      console.log('[SVG Upload] Sanitization attempt:', {
        fileName,
        userId: user.id,
        organizationId,
        isValid: sanitizeResult.isValid,
        warnings: sanitizeResult.warnings,
        originalSize: fileBuffer.length,
        sanitizedSize: sanitizeResult.sanitized.length
      })

      // Reject SVG if sanitization failed or if it's not safe
      if (!sanitizeResult.isValid || !isSVGSafe(sanitizeResult.sanitized)) {
        console.error('[SVG Upload] Rejected unsafe SVG:', {
          fileName,
          userId: user.id,
          organizationId,
          warnings: sanitizeResult.warnings
        })
        throw createError({
          statusCode: 400,
          statusMessage: 'SVG file contains unsafe content and cannot be uploaded. Please ensure the SVG does not contain scripts, event handlers, or foreign objects.'
        })
      }

      // If sanitization made changes, use the sanitized version
      if (sanitizeResult.warnings.length > 0) {
        console.warn('[SVG Upload] SVG sanitized with warnings:', {
          fileName,
          userId: user.id,
          warnings: sanitizeResult.warnings
        })
        fileBuffer = Buffer.from(sanitizeResult.sanitized, 'utf-8')
      } else {
        console.log('[SVG Upload] SVG passed sanitization checks:', {
          fileName,
          userId: user.id
        })
      }
    } catch (error) {
      // If error is already an H3 error, re-throw it
      if (error && typeof error === 'object' && 'statusCode' in error) {
        throw error
      }
      // Otherwise, log and reject
      console.error('[SVG Upload] Error during SVG sanitization:', {
        fileName,
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw createError({
        statusCode: 400,
        statusMessage: 'Failed to validate SVG file. The file may be corrupted or contain unsafe content.'
      })
    }
  }

  if (config.maxFileSize && fileBuffer.length > config.maxFileSize) {
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
      fileBuffer,
      fileName,
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
