import { requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { requireActiveOrganization } from '~~/server/utils/organization'
import { classifyUrl, extractUrls } from '~~/server/utils/chat'
import { upsertSourceContent } from '~~/server/services/sourceContent'
import { generateContentDraft } from '~~/server/services/content/generation'
import { CONTENT_STATUSES, CONTENT_TYPES } from '~~/server/utils/content'

interface ChatActionGenerateContent {
  type: 'generate_content'
  sourceContentId?: string | null
  contentId?: string | null
  text?: string | null
  title?: string | null
  slug?: string | null
  status?: typeof CONTENT_STATUSES[number]
  primaryKeyword?: string | null
  targetLocale?: string | null
  contentType?: typeof CONTENT_TYPES[number]
  systemPrompt?: string
  temperature?: number
}

type ChatAction = ChatActionGenerateContent

interface ChatRequestBody {
  message: string
  action?: ChatAction
}

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event, user.id)
  const db = await useDB(event)

  const body = await readBody<ChatRequestBody>(event)

  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body'
    })
  }

  const message = typeof body.message === 'string' ? body.message : ''

  if (!message.trim() && !body.action) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Message or action is required'
    })
  }

  const urls = extractUrls(message)
  const seenKeys = new Set<string>()
  const processedSources: Array<{
    source: Awaited<ReturnType<typeof upsertSourceContent>>
    url: string
    sourceType: string
  }> = []

  for (const rawUrl of urls) {
    const classification = classifyUrl(rawUrl)
    if (!classification) {
      continue
    }

    const key = `${classification.sourceType}:${classification.externalId ?? classification.url}`
    if (seenKeys.has(key)) {
      continue
    }

    const record = await upsertSourceContent(db, {
      organizationId,
      userId: user.id,
      sourceType: classification.sourceType,
      externalId: classification.externalId,
      metadata: classification.metadata ?? { originalUrl: rawUrl },
      title: null,
      sourceText: null
    })

    processedSources.push({
      source: record,
      url: rawUrl,
      sourceType: classification.sourceType
    })

    seenKeys.add(key)
  }

  const actions = processedSources.map((item) => ({
    type: 'suggest_generate_from_source',
    sourceContentId: item.source.id,
    sourceType: item.sourceType,
    label: `Start a draft from this ${item.sourceType.replace('_', ' ')}`
  }))

  let generationResult: Awaited<ReturnType<typeof generateContentDraft>> | null = null

  if (body.action?.type === 'generate_content') {
    generationResult = await generateContentDraft(db, {
      organizationId,
      userId: user.id,
      text: body.action.text ?? null,
      sourceContentId: body.action.sourceContentId ?? null,
      contentId: body.action.contentId ?? null,
      overrides: {
        title: typeof body.action.title === 'string' ? body.action.title : null,
        slug: typeof body.action.slug === 'string' ? body.action.slug : null,
        status: body.action.status && CONTENT_STATUSES.includes(body.action.status) ? body.action.status : undefined,
        primaryKeyword: typeof body.action.primaryKeyword === 'string' ? body.action.primaryKeyword : null,
        targetLocale: typeof body.action.targetLocale === 'string' ? body.action.targetLocale : null,
        contentType: body.action.contentType && CONTENT_TYPES.includes(body.action.contentType) ? body.action.contentType : undefined
      },
      systemPrompt: body.action.systemPrompt,
      temperature: body.action.temperature
    })
  }

  const assistantMessages = []

  if (processedSources.length > 0) {
    assistantMessages.push(`I saved ${processedSources.length} source link${processedSources.length > 1 ? 's' : ''} for this organization.`)
  }

  if (generationResult) {
    assistantMessages.push('Your draft is ready, let me know if you want edits to specific sections.')
  }

  if (assistantMessages.length === 0) {
    assistantMessages.push('Got it. I\'m ready whenever you want to start a draft or share a link.')
  }

  return {
    assistantMessage: assistantMessages.join(' '),
    actions,
    sources: processedSources.map(item => ({
      ...item.source,
      originalUrl: item.url
    })),
    generation: generationResult
      ? {
        content: generationResult.content,
        version: generationResult.version,
        markdown: generationResult.markdown,
        meta: generationResult.meta
      }
      : null
  }
})
