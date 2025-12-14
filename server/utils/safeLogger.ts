/**
 * Environment-aware logging utility that prevents sensitive data leakage in production.
 * Only logs in development environment and automatically redacts sensitive information.
 */

const isDevelopment = process.env.NODE_ENV === 'development'

/**
 * Fields that contain sensitive identifiers that should be redacted
 */
const SENSITIVE_ID_FIELDS = [
  'contentId',
  'sectionId',
  'organizationId',
  'userId',
  'id',
  'sourceContentId',
  'conversationId',
  'versionId'
]

/**
 * Fields that contain sensitive content that should be redacted
 */
const SENSITIVE_CONTENT_FIELDS = [
  'sectionTitle',
  'title',
  'instructions',
  'queryText',
  'queryTextPreview',
  'parsed',
  'raw',
  'body',
  'body_mdx',
  'summary',
  'prompt',
  'response',
  'content'
]

/**
 * Redacts sensitive data from an object, replacing IDs with boolean flags
 * and sensitive content with redaction markers or metadata only.
 */
function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data
  }

  if (Array.isArray(data)) {
    return data.map(redactSensitiveData)
  }

  if (typeof data === 'object') {
    const redacted: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {
      const keyLower = key.toLowerCase()

      // Check if this is a sensitive ID field
      const isSensitiveId = SENSITIVE_ID_FIELDS.some(
        field => keyLower === field.toLowerCase() || keyLower.includes(field.toLowerCase())
      )

      // Check if this is sensitive content
      const isSensitiveContent = SENSITIVE_CONTENT_FIELDS.some(
        field => keyLower === field.toLowerCase() || keyLower.includes(field.toLowerCase())
      )

      if (isSensitiveId) {
        // Replace IDs with boolean flags or redaction markers
        redacted[`has${key.charAt(0).toUpperCase() + key.slice(1)}`] = !!value
      } else if (isSensitiveContent) {
        // Replace sensitive content with metadata
        if (typeof value === 'string') {
          redacted[`${key}Length`] = value.length
          redacted[`has${key.charAt(0).toUpperCase() + key.slice(1)}`] = !!value
        } else if (value !== null && value !== undefined) {
          redacted[`has${key.charAt(0).toUpperCase() + key.slice(1)}`] = !!value
        } else {
          redacted[key] = value
        }
      } else {
        // Recursively process nested objects
        redacted[key] = redactSensitiveData(value)
      }
    }

    return redacted
  }

  return data
}

/**
 * Safe logging function that only logs in development and redacts sensitive data.
 * In production, this function does nothing to prevent data leakage.
 *
 * @param message - Log message
 * @param data - Optional data object (will be redacted)
 */
export function safeLog(message: string, data?: unknown): void {
  if (!isDevelopment) {
    return
  }

  if (data !== undefined) {
    const redacted = redactSensitiveData(data)
    console.log(message, redacted)
  } else {
    console.log(message)
  }
}

/**
 * Safe error logging function that only logs in development and redacts sensitive data.
 * In production, this function does nothing to prevent data leakage.
 *
 * @param message - Error message
 * @param data - Optional data object (will be redacted)
 */
export function safeError(message: string, data?: unknown): void {
  if (!isDevelopment) {
    return
  }

  if (data !== undefined) {
    const redacted = redactSensitiveData(data)
    console.error(message, redacted)
  } else {
    console.error(message)
  }
}

/**
 * Safe warning logging function that only logs in development and redacts sensitive data.
 * In production, this function does nothing to prevent data leakage.
 *
 * @param message - Warning message
 * @param data - Optional data object (will be redacted)
 */
export function safeWarn(message: string, data?: unknown): void {
  if (!isDevelopment) {
    return
  }

  if (data !== undefined) {
    const redacted = redactSensitiveData(data)
    console.warn(message, redacted)
  } else {
    console.warn(message)
  }
}
