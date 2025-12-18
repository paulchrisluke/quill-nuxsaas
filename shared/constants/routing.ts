/**
 * Known locales supported by the application
 * Used for locale prefix stripping in route matching
 */
export const KNOWN_LOCALES = ['en', 'zh-CN', 'ja', 'fr'] as const

/**
 * Special slug used for non-organization (anonymous/tenant) routes
 * This is used as a fallback when no organization slug is available
 */
export const NON_ORG_SLUG = 't' as const
