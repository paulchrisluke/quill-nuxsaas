import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import * as schema from '../database/schema'

export const CONTENT_STATUSES = ['draft', 'in_review', 'ready_for_publish', 'published', 'archived'] as const
export const CONTENT_TYPES = ['blog_post', 'landing_page', 'docs_article', 'social_thread'] as const

export const slugifyTitle = (input: string) => {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const ensureUniqueContentSlug = async (
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  candidate: string
) => {
  let slug = candidate || 'content'
  let attempt = 0

  while (attempt < 5) {
    const existing = await db
      .select({ id: schema.content.id })
      .from(schema.content)
      .where(and(
        eq(schema.content.organizationId, organizationId),
        eq(schema.content.slug, slug)
      ))
      .limit(1)

    if (existing.length === 0) {
      return slug
    }

    attempt += 1
    slug = `${candidate || 'content'}-${Math.random().toString(36).slice(2, 6)}`
  }

  return `${candidate || 'content'}-${Date.now()}`
}
