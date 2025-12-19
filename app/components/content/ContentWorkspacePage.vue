<script setup lang="ts">
import type { WorkspaceHeaderState } from '~/components/chat/workspaceHeader'
import ImageSuggestionsPanel from '~/components/content/ImageSuggestionsPanel.vue'
import { useContentList } from '~/composables/useContentList'

const route = useRoute()

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

// Set workspace header state
const workspaceHeader = useState<WorkspaceHeaderState | null>('workspace/header', () => ({
  title: 'Loading content…'
}))
const workspaceHeaderLoading = useState<boolean>('workspace/header/loading', () => true)

const { data: contentData, pending, error, refresh } = useFetch(() => `/api/content/${contentId.value}`, {
  key: computed(() => `content-${contentId.value}`),
  lazy: true,
  default: () => null
})
const toast = useToast()
const archivingContent = ref(false)
const archiveModalOpen = ref(false)
const { remove: removeContent } = useContentList({ pageSize: 100, stateKey: 'workspace-file-tree' })

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
const isArchived = computed(() => contentEntry.value?.status === 'archived')

const requestArchiveContent = () => {
  if (!contentEntry.value)
    return
  archiveModalOpen.value = true
}

const confirmArchiveContent = async () => {
  if (!contentEntry.value || archivingContent.value)
    return

  archivingContent.value = true
  try {
    await $fetch(`/api/content/${contentEntry.value.id}/archive`, { method: 'POST' })
    removeContent(contentEntry.value.id)
    await refresh().catch(() => {})
    toast.add({
      title: 'Content archived',
      color: 'success'
    })
  } catch (err) {
    console.error('Failed to archive content', err)
    toast.add({
      title: 'Failed to archive content',
      description: err instanceof Error ? err.message : 'Please try again.',
      color: 'error'
    })
  } finally {
    archivingContent.value = false
    archiveModalOpen.value = false
  }
}

const clearWorkspaceHeader = () => {
  workspaceHeader.value = null
  workspaceHeaderLoading.value = false
}

onBeforeRouteLeave(() => {
  clearWorkspaceHeader()
})

onUnmounted(() => {
  clearWorkspaceHeader()
})

watch(contentEntry, (entry) => {
  if (entry) {
    workspaceHeader.value = {
      title: entry.title
    }

    workspaceHeaderLoading.value = false
  }
}, { immediate: true })

watchEffect(() => {
  if (!contentEntry.value) {
    workspaceHeaderLoading.value = pending.value
  }
})
</script>

<template>
  <div class="space-y-6">
    <div
      v-if="pending"
      class="space-y-4"
    >
      <USkeleton class="h-20 w-full" />
      <USkeleton class="h-32 w-3/4" />
      <USkeleton class="h-24 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-alert-triangle"
      :description="error.message || 'Failed to load content'"
    />

    <template v-else-if="contentEntry">
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
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-medium">
              Content details
            </p>
            <div class="flex items-center gap-2">
              <UBadge
                v-if="isArchived"
                color="warning"
                variant="soft"
                size="xs"
              >
                Archived
              </UBadge>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-archive"
                :loading="archivingContent"
                :disabled="archivingContent"
                @click="requestArchiveContent"
              >
                Archive
              </UButton>
            </div>
          </div>
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
            <div class="flex items-center gap-2">
              <p class="font-medium capitalize">
                {{ contentEntry.status }}
              </p>
              <UBadge
                v-if="isArchived"
                color="warning"
                variant="soft"
                size="xs"
              >
                Archived
              </UBadge>
            </div>
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

      <UModal v-model:open="archiveModalOpen">
        <UCard>
          <template #header>
            <p class="text-sm font-medium">
              Archive content
            </p>
          </template>
          <div class="space-y-4">
            <p class="text-sm text-muted-foreground">
              Archive this content? You can restore it later from the archive.
            </p>
            <div class="flex items-center justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="archiveModalOpen = false"
              >
                Cancel
              </UButton>
              <UButton
                color="primary"
                :loading="archivingContent"
                :disabled="archivingContent"
                @click="confirmArchiveContent"
              >
                Archive
              </UButton>
            </div>
          </div>
        </UCard>
      </UModal>

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
