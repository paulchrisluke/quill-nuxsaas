<script setup lang="ts">
import type { ContentStatus, ContentType } from '~~/server/types/content'
import { Emoji, gitHubEmojis } from '@tiptap/extension-emoji'
import { nextTick } from 'vue'
import ImageSuggestionsPanel from '~/components/content/ImageSuggestionsPanel.vue'
import { useContentList } from '~/composables/useContentList'
import { useContentUpdates } from '~/composables/useContentUpdates'

const route = useRoute()
const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', () => {})

interface ContentEntry {
  id: string
  title: string
  slug: string
  status: string
  contentType: string
  bodyMarkdown: string
  schemaTypes: string[]
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
      contentType?: string
    }
    sourceContent?: {
      sourceType?: string
      externalId?: string
    } | null
    currentVersion?: {
      bodyMarkdown?: string
      imageSuggestions?: ImageSuggestion[]
      frontmatter?: {
        contentType?: string
      } & Record<string, any>
      seoSnapshot?: Record<string, any> | null
    }
  }
}

interface SaveContentBodyResponse {
  content: {
    id: string
    organizationId: string
    slug: string
    title: string
    status: ContentStatus
    contentType: ContentType
  }
  version: {
    id: string
    contentId: string
    version: number
    bodyMarkdown: string
    sections: Record<string, any>[] | null
  }
  markdown: string
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
const toast = useToast()
const { remove: removeContent } = useContentList({ pageSize: 100, stateKey: 'workspace-file-tree' })
const { latestUpdate } = useContentUpdates()

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

  const frontmatter = (currentVersion?.frontmatter as Record<string, any> | undefined) ?? null
  const schemaTypes = Array.isArray(frontmatter?.schemaTypes)
    ? frontmatter.schemaTypes.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
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
    contentType: currentVersion?.frontmatter?.contentType || content?.contentType || 'content',
    bodyMarkdown: currentVersion?.bodyMarkdown || '',
    schemaTypes,
    schemaValidation,
    imageSuggestions,
    videoId
  }
})

const schemaErrors = computed(() => contentEntry.value?.schemaValidation?.errors || [])
const schemaWarnings = computed(() => contentEntry.value?.schemaValidation?.warnings || [])

const editorContent = ref('')
const isSaving = ref(false)
const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved')
const lastContentId = ref<string | null>(null)
const autoSaveTimeout = ref<ReturnType<typeof setTimeout> | null>(null)
const isContentLoading = ref(false)
const editorToolbarItems = [
  [
    {
      icon: 'i-lucide-heading',
      tooltip: { text: 'Headings' },
      content: { align: 'start' },
      items: [
        { kind: 'heading', level: 1, icon: 'i-lucide-heading-1', label: 'Heading 1' },
        { kind: 'heading', level: 2, icon: 'i-lucide-heading-2', label: 'Heading 2' },
        { kind: 'heading', level: 3, icon: 'i-lucide-heading-3', label: 'Heading 3' },
        { kind: 'heading', level: 4, icon: 'i-lucide-heading-4', label: 'Heading 4' }
      ]
    }
  ],
  [
    { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
    { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
    { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strike' } },
    { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Code' } }
  ],
  [
    { kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Bullet list' } },
    { kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Numbered list' } },
    { kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: 'Quote' } },
    { kind: 'horizontalRule', icon: 'i-lucide-separator-horizontal', tooltip: { text: 'Divider' } }
  ],
  [
    { kind: 'link', icon: 'i-lucide-link', tooltip: { text: 'Link' } },
    { kind: 'image', icon: 'i-lucide-image', tooltip: { text: 'Image' } }
  ],
  [
    { kind: 'undo', icon: 'i-lucide-undo-2', tooltip: { text: 'Undo' } },
    { kind: 'redo', icon: 'i-lucide-redo-2', tooltip: { text: 'Redo' } },
    { kind: 'clearFormatting', icon: 'i-lucide-eraser', tooltip: { text: 'Clear formatting' } }
  ]
]

const editorSuggestionItems = [
  [
    { type: 'label', label: 'Text' },
    { kind: 'paragraph', label: 'Paragraph', icon: 'i-lucide-type' },
    { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
    { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
    { kind: 'heading', level: 3, label: 'Heading 3', icon: 'i-lucide-heading-3' }
  ],
  [
    { type: 'label', label: 'Lists' },
    { kind: 'bulletList', label: 'Bullet list', icon: 'i-lucide-list' },
    { kind: 'orderedList', label: 'Numbered list', icon: 'i-lucide-list-ordered' }
  ],
  [
    { type: 'label', label: 'Insert' },
    { kind: 'blockquote', label: 'Blockquote', icon: 'i-lucide-text-quote' },
    { kind: 'codeBlock', label: 'Code block', icon: 'i-lucide-square-code' },
    { kind: 'horizontalRule', label: 'Divider', icon: 'i-lucide-separator-horizontal' }
  ]
]

const editorMentionItems = [
  { label: 'team', description: 'Team mention' },
  { label: 'editorial', description: 'Editorial group' },
  { label: 'reviewer', description: 'Content review' }
]

const editorEmojiItems = gitHubEmojis.filter(
  emoji => !emoji.name.startsWith('regional_indicator_')
)

const saveContentBody = async () => {
  if (!contentEntry.value || isSaving.value) {
    return
  }

  // Clear timeout if it exists
  if (autoSaveTimeout.value) {
    clearTimeout(autoSaveTimeout.value)
    autoSaveTimeout.value = null
  }

  isSaving.value = true
  saveStatus.value = 'saving'
  try {
    const response = await $fetch<SaveContentBodyResponse>(`/api/content/${contentEntry.value.id}/body`, {
      method: 'POST',
      body: {
        markdown: editorContent.value
      }
    })

    const updated = response?.markdown ?? editorContent.value
    editorContent.value = updated
    saveStatus.value = 'saved'
    // No need to refresh - we already have the updated markdown from the response
  } catch (err) {
    console.error('Failed to save content body', err)
    saveStatus.value = 'unsaved'
    toast.add({
      title: 'Failed to save content',
      description: err instanceof Error ? err.message : 'Please try again.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

watch(contentEntry, (entry) => {
  if (!entry) {
    isContentLoading.value = true
    editorContent.value = ''
    lastContentId.value = null
    saveStatus.value = 'saved'
    isContentLoading.value = false
    return
  }
  if (entry.id && entry.id !== lastContentId.value) {
    isContentLoading.value = true
    lastContentId.value = entry.id
    editorContent.value = entry.bodyMarkdown || ''
    saveStatus.value = 'saved'
    nextTick(() => {
      isContentLoading.value = false
    })
    return
  }
  // Only update if we haven't made local edits
  if (saveStatus.value === 'saved') {
    isContentLoading.value = true
    editorContent.value = entry.bodyMarkdown || ''
    nextTick(() => {
      isContentLoading.value = false
    })
  }
})

// Auto-save with debouncing
watch(editorContent, () => {
  if (!contentEntry.value || saveStatus.value === 'saving' || isContentLoading.value) {
    return
  }

  saveStatus.value = 'unsaved'

  // Clear existing timeout
  if (autoSaveTimeout.value) {
    clearTimeout(autoSaveTimeout.value)
  }

  // Debounce auto-save (2 seconds after user stops typing)
  autoSaveTimeout.value = setTimeout(() => {
    saveContentBody()
  }, 2000)
})

// Cleanup timeout on unmount
onBeforeUnmount(() => {
  if (autoSaveTimeout.value) {
    clearTimeout(autoSaveTimeout.value)
  }
})

const archiveContent = async () => {
  if (!contentEntry.value)
    return

  try {
    await $fetch(`/api/content/${contentEntry.value.id}/archive`, { method: 'POST' })
    removeContent(contentEntry.value.id)
    // Navigate to content list after successful archive
    await navigateTo('/content')
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
  }
}

// Don't set header title - we want no header for content pages
watch([contentEntry, error], () => {
  setHeaderTitle?.(null)
}, { immediate: true })

watch(latestUpdate, (update) => {
  if (!update) {
    return
  }
  if (update.contentId === contentId.value && saveStatus.value === 'saved') {
    refreshContent()
  }
})
</script>

<template>
  <div class="space-y-4 sm:space-y-6 px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
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
      <!-- Body Markdown Editor - moved to top -->
      <UCard class="mb-4">
        <template #header>
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
            <p class="text-sm sm:text-base font-semibold truncate min-w-0 flex-1">
              {{ contentEntry.title }}
            </p>
            <div class="flex items-center gap-2 flex-shrink-0">
              <span
                v-if="saveStatus === 'saving'"
                class="text-xs text-muted-500 whitespace-nowrap"
              >
                Saving...
              </span>
              <span
                v-else-if="saveStatus === 'saved'"
                class="text-xs text-emerald-600 dark:text-emerald-400 whitespace-nowrap"
              >
                Saved
              </span>
              <span
                v-else
                class="text-xs text-warning-600 dark:text-warning-400 whitespace-nowrap"
              >
                Unsaved
              </span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-archive"
                class="flex-shrink-0"
                @click="archiveContent"
              >
                <span class="hidden sm:inline">Archive</span>
              </UButton>
            </div>
          </div>
        </template>
        <ClientOnly>
          <UEditor
            v-model="editorContent"
            placeholder="Start writing..."
            content-type="markdown"
            :extensions="[Emoji]"
            :starter-kit="{
              headings: { levels: [1, 2, 3, 4] },
              link: { openOnClick: false },
              dropcursor: { color: 'var(--ui-primary)', width: 2 }
            }"
            class="w-full"
          >
            <template #default="slotProps">
              <UEditorToolbar
                v-if="slotProps?.editor"
                :editor="slotProps.editor"
                :items="editorToolbarItems"
                layout="fixed"
                class="mb-2 overflow-x-auto"
              />
              <UEditorSuggestionMenu
                v-if="slotProps?.editor"
                :editor="slotProps.editor"
                :items="editorSuggestionItems"
              />
              <UEditorMentionMenu
                v-if="slotProps?.editor"
                :editor="slotProps.editor"
                :items="editorMentionItems"
              />
              <UEditorEmojiMenu
                v-if="slotProps?.editor"
                :editor="slotProps.editor"
                :items="editorEmojiItems"
              />
              <UEditorDragHandle
                v-if="slotProps?.editor"
                :editor="slotProps.editor"
              />
            </template>
          </UEditor>
          <template #fallback>
            <UTextarea
              :model-value="editorContent"
              placeholder="Loading editor..."
              :rows="20"
              autoresize
              class="w-full"
              @update:model-value="editorContent = $event ?? ''"
            />
          </template>
        </ClientOnly>
      </UCard>

      <!-- Schema validation alerts -->
      <div class="space-y-3 sm:space-y-4 mb-4">
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
