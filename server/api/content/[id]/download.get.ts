import { and, eq } from 'drizzle-orm'
import { createError, getRouterParams, setHeader } from 'h3'
import * as schema from '~~/server/db/schema'
import { buildWorkspaceFilesPayload } from '~~/server/services/content/workspaceFiles'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { validateUUID } from '~~/server/utils/validation'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)

  const { id } = getRouterParams(event)
  const contentId = validateUUID(id, 'id')

  const [content] = await db
    .select()
    .from(schema.content)
    .where(and(
      eq(schema.content.id, contentId),
      eq(schema.content.organizationId, organizationId)
    ))
    .limit(1)

  if (!content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  const currentVersionId = content.currentVersionId
  if (!currentVersionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content has no current version'
    })
  }

  const [version] = await db
    .select()
    .from(schema.contentVersion)
    .where(and(
      eq(schema.contentVersion.id, currentVersionId),
      eq(schema.contentVersion.contentId, contentId)
    ))
    .limit(1)

  if (!version) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content version not found'
    })
  }

  const sourceContentId =
    (version.frontmatter as Record<string, any> | null | undefined)?.sourceContentId
    || content.sourceContentId
    || (version.assets && typeof version.assets === 'object' ? (version.assets as any).source?.id : null)

  let sourceContent: typeof schema.sourceContent.$inferSelect | null = null
  if (sourceContentId) {
    const [sourceContentRecord] = await db
      .select()
      .from(schema.sourceContent)
      .where(and(
        eq(schema.sourceContent.id, sourceContentId),
        eq(schema.sourceContent.organizationId, organizationId)
      ))
      .limit(1)

    sourceContent = sourceContentRecord ?? null
  }

  const [organization] = await db
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)

  const filesPayload = buildWorkspaceFilesPayload(
    content,
    version,
    sourceContent,
    { organizationSlug: organization?.slug ?? null }
  )

  const filePayload = filesPayload[0]

  if (!filePayload || !filePayload.fullMdx.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No content available to download'
    })
  }

  const slug = (content.slug || '').trim() || `content-${contentId}`
  const filename = `${slug}.mdx`

  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  setHeader(event, 'Content-Type', 'text/markdown')

  return filePayload.fullMdx
})
