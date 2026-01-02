import type { ContentFrontmatter } from '~~/server/services/content/generation/types'
import { and, desc, eq } from 'drizzle-orm'
import { createError, getRouterParams, readBody } from 'h3'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { extractFrontmatterFromVersion } from '~~/server/services/content/generation/frontmatter'
import {
  deriveSchemaMetadata,
  normalizeStringArray as normalizeSchemaStringArray,
  validateSchemaMetadata
} from '~~/server/services/content/generation/schemaMetadata'
import { normalizeContentSections } from '~~/server/services/content/generation/sections'
import { normalizeContentKeywords, normalizeContentSchemaTypes } from '~~/server/services/content/generation/utils'
import { invalidateWorkspaceCache } from '~~/server/services/content/workspaceCache'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import {
  CONTENT_STATUSES,
  CONTENT_TYPES,
  ensureUniqueContentSlug,
  isContentSlugConstraintError,
  slugifyTitle
} from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import {
  validateEnum,
  validateOptionalString,
  validateRequestBody,
  validateUUID
} from '~~/server/utils/validation'

interface FrontmatterUpdateRequestBody {
  title?: string | null
  seoTitle?: string | null
  description?: string | null
  slug?: string | null
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number] | null
  status?: typeof CONTENT_STATUSES[number] | null
  keywords?: string[] | null
  tags?: string[] | null
  categories?: string[] | null
  schemaTypes?: string[] | null
  recipe?: {
    yield?: string | null
    prepTime?: string | null
    cookTime?: string | null
    totalTime?: string | null
    calories?: string | null
    cuisine?: string | null
    ingredients?: string[] | null
    instructions?: string[] | null
  } | null
  howTo?: {
    estimatedCost?: string | null
    totalTime?: string | null
    difficulty?: string | null
    supplies?: string[] | null
    tools?: string[] | null
    steps?: string[] | null
  } | null
  faq?: {
    description?: string | null
    entries?: Array<{ question?: string | null, answer?: string | null }> | null
  } | null
  course?: {
    providerName?: string | null
    providerUrl?: string | null
    courseCode?: string | null
    modules?: Array<{ title?: string | null, description?: string | null, mode?: string | null }> | null
  } | null
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)

  const { id } = getRouterParams(event)
  const contentId = validateUUID(id, 'id')
  const body = await readBody<FrontmatterUpdateRequestBody>(event)

  validateRequestBody(body)

  const [record] = await db
    .select({
      content: schema.content,
      version: schema.contentVersion
    })
    .from(schema.content)
    .leftJoin(schema.contentVersion, eq(schema.contentVersion.id, schema.content.currentVersionId))
    .where(and(
      eq(schema.content.organizationId, organizationId),
      eq(schema.content.id, contentId)
    ))
    .limit(1)

  if (!record || !record.content) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found'
    })
  }

  if (!record.version) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content has no version to update'
    })
  }

  const currentVersion = record.version
  const existingSections = normalizeContentSections(
    currentVersion.sections,
    currentVersion.bodyMarkdown ?? null
  )

  const existingFrontmatter = (currentVersion.frontmatter && typeof currentVersion.frontmatter === 'object')
    ? currentVersion.frontmatter as Record<string, any>
    : {}

  let frontmatter = extractFrontmatterFromVersion({
    content: record.content,
    version: currentVersion
  })
  if (typeof existingFrontmatter.seoTitle === 'string') {
    ;(frontmatter as Record<string, any>).seoTitle = existingFrontmatter.seoTitle
  }

  if (body.title !== undefined) {
    const title = validateOptionalString(body.title, 'title')
    if (title) {
      frontmatter.title = title
    }
  }

  if (body.seoTitle !== undefined) {
    const seoTitle = validateOptionalString(body.seoTitle, 'seoTitle')
    ;(frontmatter as Record<string, any>).seoTitle = seoTitle ?? undefined
  }

  if (body.description !== undefined) {
    const description = validateOptionalString(body.description, 'description')
    frontmatter.description = description ?? undefined
  }

  let pendingSlug: string | null = null
  if (body.slug !== undefined) {
    const slugValue = validateOptionalString(body.slug, 'slug')
    if (slugValue) {
      pendingSlug = slugifyTitle(slugValue)
    }
  }

  if (body.primaryKeyword !== undefined) {
    frontmatter.primaryKeyword = validateOptionalString(body.primaryKeyword, 'primaryKeyword')
  }

  if (body.targetLocale !== undefined) {
    frontmatter.targetLocale = validateOptionalString(body.targetLocale, 'targetLocale')
  }

  if (body.contentType !== undefined && body.contentType !== null) {
    frontmatter.contentType = validateEnum(body.contentType, CONTENT_TYPES, 'contentType')
  }

  if (body.status !== undefined && body.status !== null) {
    frontmatter.status = validateEnum(body.status, CONTENT_STATUSES, 'status')
  }

  if (body.keywords !== undefined) {
    frontmatter.keywords = Array.isArray(body.keywords) ? normalizeContentKeywords(body.keywords) : undefined
  }

  if (body.tags !== undefined) {
    frontmatter.tags = Array.isArray(body.tags) ? normalizeContentKeywords(body.tags) : undefined
  }

  if (body.categories !== undefined) {
    frontmatter.categories = Array.isArray(body.categories) ? normalizeContentKeywords(body.categories) : undefined
  }

  if (body.schemaTypes !== undefined) {
    frontmatter.schemaTypes = normalizeContentSchemaTypes(body.schemaTypes)
  }

  if (body.recipe !== undefined) {
    if (body.recipe === null) {
      frontmatter.recipe = undefined
    } else if (body.recipe && typeof body.recipe === 'object') {
      frontmatter.recipe = {
        yield: validateOptionalString(body.recipe.yield, 'recipe.yield'),
        prepTime: validateOptionalString(body.recipe.prepTime, 'recipe.prepTime'),
        cookTime: validateOptionalString(body.recipe.cookTime, 'recipe.cookTime'),
        totalTime: validateOptionalString(body.recipe.totalTime, 'recipe.totalTime'),
        calories: validateOptionalString(body.recipe.calories, 'recipe.calories'),
        cuisine: validateOptionalString(body.recipe.cuisine, 'recipe.cuisine'),
        ingredients: normalizeSchemaStringArray(body.recipe.ingredients),
        instructions: normalizeSchemaStringArray(body.recipe.instructions)
      }
    }
  }

  if (body.howTo !== undefined) {
    if (body.howTo === null) {
      frontmatter.howTo = undefined
    } else if (body.howTo && typeof body.howTo === 'object') {
      frontmatter.howTo = {
        estimatedCost: validateOptionalString(body.howTo.estimatedCost, 'howTo.estimatedCost'),
        totalTime: validateOptionalString(body.howTo.totalTime, 'howTo.totalTime'),
        difficulty: validateOptionalString(body.howTo.difficulty, 'howTo.difficulty'),
        supplies: normalizeSchemaStringArray(body.howTo.supplies),
        tools: normalizeSchemaStringArray(body.howTo.tools),
        steps: normalizeSchemaStringArray(body.howTo.steps)
      }
    }
  }

  if (body.faq !== undefined) {
    if (body.faq === null) {
      frontmatter.faq = undefined
    } else if (body.faq && typeof body.faq === 'object') {
      const entries = Array.isArray(body.faq.entries)
        ? body.faq.entries
          .map((entry) => {
            const question = validateOptionalString(entry?.question, 'faq.entries.question')
            const answer = validateOptionalString(entry?.answer, 'faq.entries.answer')
            if (!question || !answer) {
              return null
            }
            return { question, answer }
          })
          .filter(Boolean) as Array<{ question: string, answer: string }>
        : []
      frontmatter.faq = {
        description: validateOptionalString(body.faq.description, 'faq.description'),
        entries
      }
    }
  }

  if (body.course !== undefined) {
    if (body.course === null) {
      frontmatter.course = undefined
    } else if (body.course && typeof body.course === 'object') {
      const modules = Array.isArray(body.course.modules)
        ? body.course.modules
          .map((entry) => {
            const title = validateOptionalString(entry?.title, 'course.modules.title')
            if (!title) {
              return null
            }
            return {
              title,
              description: validateOptionalString(entry?.description, 'course.modules.description'),
              mode: validateOptionalString(entry?.mode, 'course.modules.mode')
            }
          })
          .filter(Boolean) as Array<{ title: string, description?: string | null, mode?: string | null }>
        : []
      frontmatter.course = {
        providerName: validateOptionalString(body.course.providerName, 'course.providerName'),
        providerUrl: validateOptionalString(body.course.providerUrl, 'course.providerUrl'),
        courseCode: validateOptionalString(body.course.courseCode, 'course.courseCode'),
        modules
      }
    }
  }

  frontmatter = deriveSchemaMetadata(frontmatter, existingSections)
  const schemaValidation = validateSchemaMetadata(frontmatter)
  const previousSeoSnapshot = currentVersion.seoSnapshot ?? {}

  const seoSnapshot = {
    ...previousSeoSnapshot,
    primaryKeyword: frontmatter.primaryKeyword,
    targetLocale: frontmatter.targetLocale,
    contentType: frontmatter.contentType,
    schemaTypes: frontmatter.schemaTypes,
    schemaValidation,
    manualEditAt: new Date().toISOString()
  }

  let result: { content: typeof schema.content.$inferSelect, version: typeof schema.contentVersion.$inferSelect } | null = null
  const maxAttempts = 3
  let attempt = 0

  while (!result && attempt < maxAttempts) {
    try {
      result = await db.transaction(async (tx) => {
        if (pendingSlug) {
          const uniqueSlug = await ensureUniqueContentSlug(tx, organizationId, pendingSlug, contentId)
          frontmatter.slug = uniqueSlug
          frontmatter.slugSuggestion = uniqueSlug
        }

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
            createdByUserId: user.id,
            frontmatter: frontmatter as ContentFrontmatter,
            bodyMarkdown: currentVersion.bodyMarkdown,
            sections: currentVersion.sections,
            assets: currentVersion.assets,
            seoSnapshot
          })
          .returning()

        if (!newVersion) {
          throw createError({
            statusCode: 500,
            statusMessage: 'Failed to create content version'
          })
        }

        const updates: Partial<typeof schema.content.$inferInsert> = {
          updatedAt: new Date(),
          title: frontmatter.title,
          status: frontmatter.status,
          primaryKeyword: frontmatter.primaryKeyword ?? null,
          targetLocale: frontmatter.targetLocale ?? null,
          contentType: frontmatter.contentType
        }

        if (frontmatter.slug && frontmatter.slug !== record.content.slug) {
          updates.slug = frontmatter.slug
        }

        const [updatedContent] = await tx
          .update(schema.content)
          .set({
            ...updates,
            currentVersionId: newVersion.id
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
    } catch (error) {
      if (isContentSlugConstraintError(error) && pendingSlug) {
        attempt += 1
        continue
      }
      throw error
    }
  }

  if (!result) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to update content slug'
    })
  }

  invalidateWorkspaceCache(organizationId, result.content.id)

  return {
    content: result.content,
    version: result.version,
    frontmatter,
    schemaValidation
  }
})
