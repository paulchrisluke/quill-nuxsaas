import type { useDB } from '~~/server/utils/db'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { SITE_CONFIG_VIRTUAL_KEY } from '~~/shared/utils/siteConfig'

export type ContentContextScope = 'content' | 'site-config' | null

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const normalizeIdentifier = (value?: string | null) => (typeof value === 'string' ? value.trim() : '')

const isSiteConfigIdentifier = (value: string) => {
  const normalized = value.toLowerCase()
  return normalized === SITE_CONFIG_VIRTUAL_KEY || normalized === 'site-config'
}

const isUuidIdentifier = (value: string) => UUID_REGEX.test(value)

export async function resolveContentIdFromIdentifier(
  db: Awaited<ReturnType<typeof useDB>>,
  organizationId: string,
  identifierRaw: string | null | undefined
) {
  const trimmed = normalizeIdentifier(identifierRaw)
  if (!trimmed) {
    return null
  }
  if (isSiteConfigIdentifier(trimmed)) {
    return null
  }
  if (isUuidIdentifier(trimmed)) {
    const [record] = await db
      .select({ id: schema.content.id })
      .from(schema.content)
      .where(and(
        eq(schema.content.organizationId, organizationId),
        eq(schema.content.id, trimmed)
      ))
      .limit(1)
    return record?.id ?? null
  }

  const [record] = await db
    .select({ id: schema.content.id })
    .from(schema.content)
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.slug, trimmed)
    ))
    .limit(1)

  return record?.id ?? null
}

export async function resolveContentContext(
  db: Awaited<ReturnType<typeof useDB>>,
  organizationId: string,
  identifierRaw: string | null | undefined
) {
  const trimmed = normalizeIdentifier(identifierRaw)
  if (!trimmed) {
    return { contentId: null, scope: null as ContentContextScope, identifier: null }
  }
  if (isSiteConfigIdentifier(trimmed)) {
    return { contentId: null, scope: 'site-config' as const, identifier: trimmed }
  }
  if (isUuidIdentifier(trimmed)) {
    return { contentId: trimmed, scope: 'content' as const, identifier: trimmed }
  }

  const contentId = await resolveContentIdFromIdentifier(db, organizationId, trimmed)
  return contentId
    ? { contentId, scope: 'content' as const, identifier: trimmed }
    : { contentId: null, scope: null as ContentContextScope, identifier: trimmed }
}
