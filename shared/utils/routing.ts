import { NON_ORG_SLUG } from '../constants/routing'

/**
 * Get the organization slug, falling back to NON_ORG_SLUG if needed
 */
export function getOrgSlug(org: { slug: string } | null | undefined): string {
  return org?.slug && org.slug !== NON_ORG_SLUG ? org.slug : NON_ORG_SLUG
}

/**
 * Get the conversation route path
 * @param conversationId - The conversation ID, or null for new conversation
 * @param orgSlug - The organization slug, or null/undefined to use fallback
 */
export function getConversationRoute(
  conversationId: string | null,
  orgSlug: string | null | undefined
): string {
  const slug = getOrgSlug(orgSlug ? { slug: orgSlug } : null)
  if (conversationId) {
    return `/${slug}/conversations/${conversationId}`
  }
  return `/${slug}/conversations`
}
