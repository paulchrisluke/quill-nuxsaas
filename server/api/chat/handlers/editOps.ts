import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { EditConstraints, EditOp } from '~~/server/services/content/editing/patcher'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { calculateDiffStats } from '~~/server/services/content/diff'
import { applyEditOps, buildSectionsFromMarkdown, calculateEditLineRange } from '~~/server/services/content/editing/patcher'
import { invalidateWorkspaceCache } from '~~/server/services/content/workspaceCache'
import { validateUUID } from '~~/server/utils/validation'

export async function handleEditOps(params: {
  db: NodePgDatabase<typeof schema>
  organizationId: string
  userId: string
  contentId: string
  ops: EditOp[]
  constraints?: EditConstraints
  rationale?: string | null
}) {
  const {
    db,
    organizationId,
    userId,
    contentId,
    ops,
    constraints
  } = params

  const validatedContentId = validateUUID(contentId, 'contentId')

  if (!Array.isArray(ops) || ops.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'ops is required for edit_ops'
    })
  }

  const [record] = await db
    .select({
      content: schema.content,
      version: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, validatedContentId)
    ))
    .limit(1)

  if (!record?.content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found for this organization'
    })
  }

  if (!record.version) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This draft has no version to patch yet'
    })
  }

  const originalMarkdown = record.version.bodyMarkdown || ''
  const patchResult = applyEditOps(originalMarkdown, ops, constraints)

  if (!patchResult.success || !patchResult.text || !patchResult.changes) {
    throw createError({
      statusCode: 400,
      statusMessage: patchResult.error || 'Failed to apply edit operations'
    })
  }

  const updatedMarkdown = patchResult.text
  const diffStats = calculateDiffStats(originalMarkdown, updatedMarkdown)
  const updatedSections = buildSectionsFromMarkdown(
    updatedMarkdown,
    (record.version.sections as Array<{ id?: string, title?: string }> | null) || undefined
  )
  const lineRange = calculateEditLineRange(originalMarkdown, updatedMarkdown, patchResult.changes)

  const previousFrontmatter = (record.version.frontmatter as Record<string, any> | null) ?? {}
  const nextFrontmatter = {
    ...previousFrontmatter,
    diffStats: {
      additions: diffStats.additions,
      deletions: diffStats.deletions
    }
  }

  const result = await db.transaction(async (tx) => {
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
        frontmatter: nextFrontmatter,
        bodyMarkdown: updatedMarkdown,
        sections: updatedSections,
        assets: record.version.assets ?? null,
        seoSnapshot: record.version.seoSnapshot ?? null
      })
      .returning()

    if (!newVersion) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to create content version'
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

  invalidateWorkspaceCache(organizationId, result.content.id)

  const { resolveContentFilePath } = await import('~~/server/services/content/workspaceFiles')
  const filename = resolveContentFilePath(result.content, result.version)

  const fileEdits = [{
    filePath: filename,
    additions: diffStats.additions,
    deletions: diffStats.deletions,
    lineRange
  }]

  return {
    content: result.content,
    version: result.version,
    markdown: updatedMarkdown,
    fileEdits,
    lineRange
  }
}
