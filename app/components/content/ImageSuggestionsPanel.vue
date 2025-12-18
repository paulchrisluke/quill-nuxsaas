<script setup lang="ts">
interface ImageSuggestion {
  sectionId: string
  position: number
  altText: string
  reason: string
  priority: 'high' | 'medium' | 'low'
  type?: 'generated' | 'screencap'
  videoId?: string
  estimatedTimestamp?: number
  thumbnailFileId?: string
  thumbnailUrl?: string
  fullSizeFileId?: string
  fullSizeUrl?: string
  status?: 'pending' | 'thumbnail_ready' | 'added' | 'failed'
  errorMessage?: string
}

interface Props {
  suggestions: ImageSuggestion[]
  contentId: string
  videoId?: string
}

const props = defineProps<Props>()

const pendingSuggestions = computed(() => {
  return props.suggestions.filter(s => s.status !== 'added' && s.status !== 'failed')
})

const formatTimestamp = (seconds?: number | null): string => {
  if (seconds === null || seconds === undefined) return 'N/A'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const getYouTubeUrl = (suggestion: ImageSuggestion): string | null => {
  const videoId = suggestion.videoId || props.videoId
  if (!videoId) return null

  const baseUrl = `https://www.youtube.com/watch?v=${videoId}`
  if (suggestion.estimatedTimestamp !== null && suggestion.estimatedTimestamp !== undefined) {
    return `${baseUrl}&t=${Math.floor(suggestion.estimatedTimestamp)}`
  }
  return baseUrl
}

const priorityLabel = (priority: string): string => {
  return priority.charAt(0).toUpperCase() + priority.slice(1)
}
</script>

<template>
  <UCard v-if="pendingSuggestions.length > 0">
    <template #header>
      <p class="text-sm font-medium">
        Image Suggestions
      </p>
    </template>

    <div class="space-y-4">
      <div
        v-for="(suggestion, idx) in pendingSuggestions"
        :key="`${suggestion.sectionId}-${suggestion.position}-${idx}`"
        class="space-y-4"
      >
        <div class="flex items-center gap-2 text-xs text-muted-500">
          <span>{{ priorityLabel(suggestion.priority) }}</span>
          <span>•</span>
          <span>Line {{ suggestion.position }}</span>
        </div>

        <div>
          <p class="text-xs uppercase tracking-wide text-muted-500">
            Alt text
          </p>
          <p class="text-sm">
            {{ suggestion.altText }}
          </p>
        </div>

        <div v-if="suggestion.reason">
          <p class="text-xs uppercase tracking-wide text-muted-500">
            Description
          </p>
          <p class="text-sm text-muted-600 dark:text-muted-400">
            {{ suggestion.reason }}
          </p>
        </div>

        <div
          v-if="suggestion.type === 'screencap' && suggestion.estimatedTimestamp !== null && suggestion.estimatedTimestamp !== undefined"
        >
          <p class="text-xs uppercase tracking-wide text-muted-500">
            Timestamp
          </p>
          <div class="text-sm">
            <a
              v-if="getYouTubeUrl(suggestion)"
              :href="getYouTubeUrl(suggestion)!"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary-600 dark:text-primary-400 hover:underline"
            >
              {{ formatTimestamp(suggestion.estimatedTimestamp) }}
            </a>
            <span v-else class="text-muted-500">
              {{ formatTimestamp(suggestion.estimatedTimestamp) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
