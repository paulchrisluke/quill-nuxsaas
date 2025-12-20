import { readMultipartFormData } from 'h3'
import { z } from 'zod'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { optimizeImageInBackground } from '~~/server/services/file/imageOptimizer'
import { UploadRateLimiter } from '~~/server/services/file/rateLimiter'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { sanitizeSVG } from '~~/server/services/file/svgSanitizer'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { getWaitUntil } from '~~/server/utils/waitUntil'

export default defineEventHandler(async (event) => {
  const config = useFileManagerConfig()

  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)

  // Get contentId from query params if provided
  // Handle both string and string[] inputs (use first element if array)
  const contentId = getQuery(event).contentId
  let validatedContentId: string | null = null

  // Select first element if array, otherwise use the value directly
  const contentIdValue = Array.isArray(contentId) ? contentId[0] : contentId

  if (contentIdValue && typeof contentIdValue === 'string') {
    const trimmed = contentIdValue.trim()
    if (trimmed) {
      // Validate as UUID using Zod (consistent with file/index.get.ts)
      const uuidSchema = z.string().uuid()
      const result = uuidSchema.safeParse(trimmed)
      if (result.success) {
        validatedContentId = result.data
      } else {
        // Return 400 if validation fails
        throw createError({
          statusCode: 400,
          statusMessage: 'Invalid contentId format. Expected a valid UUID.'
        })
      }
    }
  }

  // NOTE: contentId is now validated as UUID before passing to fileService.uploadFile

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
  const toUint8Array = (input: Uint8Array | ArrayBuffer) => {
    return input instanceof Uint8Array ? input : new Uint8Array(input)
  }
  const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes)
  const encodeUtf8 = (value: string) => new TextEncoder().encode(value)

  let fileBuffer = toUint8Array(fileData.data)
  if (isSVG) {
    try {
      const svgContent = decodeUtf8(fileBuffer)
      const sanitizeResult = sanitizeSVG(svgContent)

      // Log sanitization attempt
      console.log('[SVG Upload] Sanitization attempt:', {
        fileName,
        userId: user.id,
        organizationId,
        isValid: sanitizeResult.isValid,
        warnings: sanitizeResult.warnings,
        originalSize: fileBuffer.byteLength,
        sanitizedSize: encodeUtf8(sanitizeResult.sanitized).byteLength
      })

      // Reject SVG if sanitization failed
      if (!sanitizeResult.isValid) {
        console.error('[SVG Upload] Rejected unsafe SVG:', {
          fileName,
          userId: user.id,
          organizationId,
          warnings: sanitizeResult.warnings,
          originalSize: fileBuffer.byteLength,
          sanitizedSize: encodeUtf8(sanitizeResult.sanitized).byteLength
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
        fileBuffer = encodeUtf8(sanitizeResult.sanitized)
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

  if (config.maxFileSize && fileBuffer.byteLength > config.maxFileSize) {
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

    if (file.fileType === 'image' && mimeType.startsWith('image/') && !isSVG) {
      const waitUntil = await getWaitUntil()
      const optimizePromise = optimizeImageInBackground(file.id)
      if (waitUntil) {
        waitUntil(optimizePromise)
      } else {
        optimizePromise.catch((error) => {
          console.error('Image optimization failed:', error)
        })
      }
    }

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
