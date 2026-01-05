import { readBody } from 'h3'
import { importMarkdownContent } from '~~/server/services/content/import'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { CONTENT_STATUSES, CONTENT_TYPES, slugifyTitle } from '~~/server/utils/content'
import { useDB } from '~~/server/utils/db'
import { validateEnum, validateOptionalString, validateRequestBody, validateRequiredString } from '~~/server/utils/validation'

interface ManualImportRequestBody {
  title: string
  markdown: string
  slug?: string | null
  status?: string | null
  contentType?: string | null
  description?: string | null
  primaryKeyword?: string | null
  targetLocale?: string | null
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)
  const body = await readBody<ManualImportRequestBody>(event)

  validateRequestBody(body)

  const title = validateRequiredString(body.title, 'title')
  const markdown = validateRequiredString(body.markdown, 'markdown')
  const slugInput = validateOptionalString(body.slug, 'slug')
  const slug = slugInput ? slugifyTitle(slugInput) : slugifyTitle(title)
  const status = body.status
    ? validateEnum(body.status, CONTENT_STATUSES, 'status')
    : 'draft'
  const contentType = body.contentType
    ? validateEnum(body.contentType, CONTENT_TYPES, 'contentType')
    : 'blog_post'

  const frontmatter = {
    title,
    description: validateOptionalString(body.description, 'description') || undefined,
    slug,
    status,
    contentType,
    schemaTypes: ['BlogPosting'],
    primaryKeyword: validateOptionalString(body.primaryKeyword, 'primaryKeyword') || undefined,
    targetLocale: validateOptionalString(body.targetLocale, 'targetLocale') || undefined
  }

  const { content, version } = await importMarkdownContent(db, {
    organizationId,
    userId: user.id,
    title,
    slug,
    frontmatter,
    bodyMarkdown: markdown,
    status,
    contentType,
    ingestMethod: 'manual_import',
    source: {
      type: 'manual',
      format: 'markdown'
    }
  })

  return {
    contentId: content.id,
    versionId: version.id,
    slug: content.slug
  }
})
