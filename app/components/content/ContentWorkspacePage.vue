<script setup lang="ts">
import ImageSuggestionsPanel from '~/components/content/ImageSuggestionsPanel.vue'

const route = useRoute()
const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', () => {})

interface ContentEntry {
  id: string
  title: string
  slug: string
  status: string
  updatedAt: Date | null
  contentType: string
  additions?: number
  deletions?: number
  conversationId?: string | null
  bodyMarkdown: string
  frontmatter: Record<string, any> | null
  schemaTypes: string[]
  jsonLd: string | null
  schemaValidation: {
    errors: string[]
    warnings: string[]
  } | null
  imageSuggestions: ImageSuggestion[]
  videoId: string | null
}

interface ImageSuggestion {
  sectionId: string
  position: number
  altText: string
  reason: string
  priority: 'high' | 'medium' | 'low'
  type?: 'generated' | 'screencap' | 'uploaded'
  videoId?: string
  estimatedTimestamp?: number
  thumbnailFileId?: string
  thumbnailUrl?: string
  fullSizeFileId?: string
  fullSizeUrl?: string
  status?: 'pending' | 'thumbnail_ready' | 'added' | 'failed'
}

interface ContentApiResponse {
  workspace?: {
    content?: {
      id?: string
      title?: string
      slug?: string
      status?: string
      updatedAt?: string
      contentType?: string
      conversationId?: string | null
    }
    sourceContent?: {
      sourceType?: string
      externalId?: string
    } | null
    currentVersion?: {
      bodyMdx?: string
      structuredData?: string | null
      imageSuggestions?: ImageSuggestion[]
      diffStats?: {
        additions?: number
        deletions?: number
      }
      frontmatter?: {
        contentType?: string
        diffStats?: {
          additions?: number
          deletions?: number
        }
      } & Record<string, any>
      seoSnapshot?: Record<string, any> | null
    }
  }
}

const contentId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
})

const { data: contentData, pending, error, refresh: refreshContent } = useFetch(() => `/api/content/${contentId.value}`, {
  key: computed(() => `content-${contentId.value}`),
  lazy: true,
  default: () => null,
  server: false
})

// Ensure pending state is consistent for hydration
const isPending = computed(() => {
  if (import.meta.server) {
    return false // On server, always render as not pending since server: false
  }
  return pending.value
})

const contentEntry = computed<ContentEntry | null>(() => {
  if (!contentData.value)
    return null

  const entry = contentData.value as ContentApiResponse
  const workspace = entry.workspace
  const content = workspace?.content
  const currentVersion = workspace?.currentVersion
  const sourceContent = workspace?.sourceContent

  if (!content)
    return null

  let updatedAt: Date | null = null
  if (content?.updatedAt) {
    const parsedDate = new Date(content.updatedAt)
    updatedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate : null
  }

  const versionStats = currentVersion?.diffStats
  const fmStats = currentVersion?.frontmatter?.diffStats as { additions?: number, deletions?: number } | undefined
  const additions = versionStats?.additions ?? fmStats?.additions ?? 0
  const deletions = versionStats?.deletions ?? fmStats?.deletions ?? 0
  const frontmatter = (currentVersion?.frontmatter as Record<string, any> | undefined) ?? null
  const schemaTypes = Array.isArray(frontmatter?.schemaTypes)
    ? frontmatter.schemaTypes.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  const jsonLd = typeof currentVersion?.structuredData === 'string' ? currentVersion.structuredData : null
  const schemaValidationRaw = currentVersion?.seoSnapshot && typeof currentVersion.seoSnapshot === 'object'
    ? (currentVersion.seoSnapshot as Record<string, any>).schemaValidation
    : null
  const schemaValidation = schemaValidationRaw && typeof schemaValidationRaw === 'object'
    ? {
        errors: Array.isArray(schemaValidationRaw.errors) ? schemaValidationRaw.errors.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        warnings: Array.isArray(schemaValidationRaw.warnings) ? schemaValidationRaw.warnings.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0) : []
      }
    : null

  const imageSuggestions = Array.isArray(currentVersion?.imageSuggestions)
    ? currentVersion.imageSuggestions as ImageSuggestion[]
    : []

  // Extract videoId from sourceContent for YouTube links
  const videoId = sourceContent?.sourceType === 'youtube' && sourceContent.externalId
    ? sourceContent.externalId
    : null

  return {
    id: content?.id || '',
    title: content?.title || 'Untitled content',
    slug: content?.slug || '',
    status: content?.status || 'draft',
    updatedAt,
    contentType: currentVersion?.frontmatter?.contentType || content?.contentType || 'content',
    additions,
    deletions,
    conversationId: content?.conversationId || null,
    bodyMarkdown: currentVersion?.bodyMdx || '',
    frontmatter,
    schemaTypes,
    jsonLd: jsonLd?.trim() || null,
    schemaValidation,
    imageSuggestions,
    videoId
  }
})

const frontmatterJson = computed(() => {
  if (!contentEntry.value?.frontmatter) {
    return 'Frontmatter has not been generated yet.'
  }
  try {
    return JSON.stringify(contentEntry.value.frontmatter, null, 2)
  } catch {
    return 'Failed to serialize frontmatter.'
  }
})

const structuredDataSnippet = computed(() => {
  if (contentEntry.value?.jsonLd) {
    return contentEntry.value.jsonLd
  }
  return 'Structured data will be generated automatically once schema types are configured.'
})

const schemaErrors = computed(() => contentEntry.value?.schemaValidation?.errors || [])
const schemaWarnings = computed(() => contentEntry.value?.schemaValidation?.warnings || [])

// Set header title from content
watch([contentEntry, error], ([entry, err]) => {
  if (err) {
    setHeaderTitle?.(err.message || 'Error loading content')
  } else if (entry) {
    setHeaderTitle?.(entry.title)
  } else {
    setHeaderTitle?.('Loading content…')
  }
}, { immediate: true })

// Listen for content updates via window events (for cross-component communication)
if (import.meta.client) {
  const handleContentUpdate = (event: CustomEvent) => {
    const updatedContentId = event.detail?.contentId
    if (updatedContentId === contentId.value) {
      refreshContent()
    }
  }

  window.addEventListener('content:updated', handleContentUpdate as EventListener)

  onBeforeUnmount(() => {
    window.removeEventListener('content:updated', handleContentUpdate as EventListener)
  })
}
</script>

<template>
  <div class="space-y-6">
    <ClientOnly>
      <div
        v-if="isPending"
        class="space-y-4"
      >
        <USkeleton class="h-20 w-full" />
        <USkeleton class="h-32 w-3/4" />
        <USkeleton class="h-24 w-full" />
      </div>
    </ClientOnly>

    <UAlert
      v-if="!isPending && error"
      color="error"
      variant="soft"
      icon="i-lucide-alert-triangle"
      :description="error?.message || 'Failed to load content'"
    />

    <template v-if="!isPending && contentEntry">
      <div class="space-y-4 mb-4">
        <UAlert
          v-if="schemaErrors.length"
          color="error"
          variant="soft"
          icon="i-lucide-alert-circle"
          title="Schema requirements missing"
        >
          <template #description>
            <ul class="list-disc list-inside space-y-1 text-sm">
              <li
                v-for="(issue, i) in schemaErrors"
                :key="`schema-error-${issue}-${i}`"
              >
                {{ issue }}
              </li>
            </ul>
          </template>
        </UAlert>
        <UAlert
          v-if="schemaWarnings.length"
          color="warning"
          variant="soft"
          icon="i-lucide-alert-triangle"
          title="Schema improvements suggested"
        >
          <template #description>
            <ul class="list-disc list-inside space-y-1 text-sm">
              <li
                v-for="(issue, i) in schemaWarnings"
                :key="`schema-warning-${issue}-${i}`"
              >
                {{ issue }}
              </li>
            </ul>
          </template>
        </UAlert>
      </div>

      <UCard class="mb-4">
        <template #header>
          <p class="text-sm font-medium">
            Content details
          </p>
        </template>
        <div class="space-y-4">
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-500">
              Slug
            </p>
            <p class="font-medium break-all">
              {{ contentEntry.slug || '—' }}
            </p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-500">
              Status
            </p>
            <p class="font-medium capitalize">
              {{ contentEntry.status }}
            </p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-500">
              Content type
            </p>
            <p class="font-medium capitalize">
              {{ contentEntry.contentType }}
            </p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-500">
              Schema types
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <template v-if="contentEntry.schemaTypes.length">
                <UBadge
                  v-for="schema in contentEntry.schemaTypes"
                  :key="schema"
                  size="xs"
                  color="neutral"
                  variant="soft"
                >
                  {{ schema }}
                </UBadge>
              </template>
              <span
                v-else
                class="text-sm text-muted-500"
              >
                Not set
              </span>
            </div>
          </div>
        </div>
      </UCard>

      <UCard class="mb-4">
        <template #header>
          <p class="text-sm font-medium">
            Body Markdown
          </p>
        </template>
        <UTextarea
          :model-value="contentEntry.bodyMarkdown || ''"
          placeholder="No content available"
          readonly
          :rows="20"
          autoresize
          class="w-full"
        />
      </UCard>

      <UCard class="mb-4">
        <template #header>
          <p class="text-sm font-medium">
            Frontmatter
          </p>
        </template>
        <UTextarea
          :model-value="frontmatterJson"
          readonly
          :rows="12"
          autoresize
          class="w-full"
        />
      </UCard>

      <UCard>
        <template #header>
          <p class="text-sm font-medium">
            JSON-LD Structured Data
          </p>
        </template>
        <UTextarea
          :model-value="structuredDataSnippet"
          readonly
          :rows="12"
          autoresize
          class="w-full"
        />
      </UCard>

      <ImageSuggestionsPanel
        v-if="contentEntry.imageSuggestions && contentEntry.imageSuggestions.length > 0"
        :suggestions="contentEntry.imageSuggestions"
        :content-id="contentEntry.id"
        :video-id="contentEntry.videoId || undefined"
        class="mb-4"
      />
    </template>

    <UAlert
      v-else
      color="neutral"
      variant="soft"
      icon="i-lucide-file-text"
      title="No content available"
      description="This content item could not be found or loaded."
    />
  </div>
</template>
