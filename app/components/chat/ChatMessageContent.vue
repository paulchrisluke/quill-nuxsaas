<script setup lang="ts">
import type { ChatMessage, MessagePart } from '#shared/utils/types'
import { computed } from 'vue'
import { useContentPaths } from '~/composables/useContentPaths'
import AgentProgressTracker from './progress/AgentProgressTracker.vue'

const props = withDefaults(defineProps<{
  message: ChatMessage
  displayText?: string | null
  bodyClass?: string
  showToolDetails?: boolean
}>(), {
  displayText: null,
  bodyClass: '',
  showToolDetails: false
})

const { t } = useI18n()
const localePath = useLocalePath()
const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const { currentActivity, activeToolActivities } = useConversation()
const { resolveCreatedContentPath } = useContentPaths()

const liveToolActivities = computed(() => {
  const activities = activeToolActivities.value ?? []
  const getTimestamp = (value?: string) => {
    if (!value) {
      return Number.POSITIVE_INFINITY
    }
    const parsed = new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
  }
  return activities
    .filter(activity => activity.messageId === props.message.id)
    .sort((a, b) => {
      const aTime = getTimestamp(a.startedAt)
      const bTime = getTimestamp(b.startedAt)
      return aTime - bTime
    })
})
const hasLiveToolActivities = computed(() => liveToolActivities.value.length > 0)

// Check if message has tool calls
const toolCalls = computed(() => props.message.parts.filter(p => p.type === 'tool_call'))
const hasToolCalls = computed(() => toolCalls.value.length > 0)
const textParts = computed(() => props.message.parts.filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text' && !!p.text?.trim()))

type MarkdownSegment =
  | { type: 'text', text: string }
  | { type: 'link', text: string, href: string, external: boolean }

function parseMarkdownLinks(text: string | null | undefined): MarkdownSegment[] {
  if (!text) {
    return []
  }

  const normalized = text
  const segments: MarkdownSegment[] = []
  const linkPattern = /\[([^[\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0

  let match = linkPattern.exec(normalized)
  while (match !== null) {
    const [fullMatch, label, url] = match
    const preceding = normalized.slice(lastIndex, match.index)
    if (preceding) {
      segments.push({ type: 'text', text: preceding })
    }
    if (label && url) {
      const href = url.trim()
      // Only allow http(s) URLs and relative paths starting with /
      const isHttpUrl = /^https?:\/\//i.test(href)
      const isRelativePath = /^\/[^/]/.test(href)
      const isSafe = isHttpUrl || isRelativePath

      if (href.length && isSafe) {
        segments.push({
          type: 'link',
          text: label.trim() || href,
          href,
          external: isHttpUrl
        })
      } else {
        segments.push({ type: 'text', text: fullMatch })
      }
    }
    lastIndex = match.index + fullMatch.length
    match = linkPattern.exec(normalized)
  }

  const trailing = normalized.slice(lastIndex)
  if (trailing) {
    segments.push({ type: 'text', text: trailing })
  }

  if (!segments.length) {
    segments.push({ type: 'text', text: normalized })
  }

  return segments
}

const renderedTextParts = computed(() => textParts.value.map(part => ({
  segments: parseMarkdownLinks(part.text)
})))

const ALLOWED_EMBED_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'player.vimeo.com'
  // Add other trusted domains
]

const payload = computed(() => (props.message.payload as Record<string, any> | null) ?? null)
const preview = computed(() => payload.value?.preview ?? null)
const isError = computed(() => payload.value?.type === 'agent_failure' || payload.value?.type === 'error')
const errorDetails = computed(() => payload.value?.error || null)
const createdContentItems = computed(() => {
  const payloadValue = payload.value
  let items: any[] | null = null
  if (payloadValue?.type === 'created_content') {
    items = payloadValue.items
  } else if (payloadValue?.type === 'workspace_files') {
    items = payloadValue.createdContent || payloadValue.created_content
  }
  if (!Array.isArray(items)) {
    return []
  }
  return items
    .filter(item => item && typeof item.id === 'string' && item.id.length > 0)
    .map(item => ({
      id: item.id,
      title: typeof item.title === 'string' && item.title.trim().length > 0
        ? item.title.trim()
        : 'Untitled content'
    }))
})

const safeEmbedUrl = computed(() => {
  const embedUrl = preview.value?.embedUrl
  if (!embedUrl) {
    return null
  }

  try {
    const url = new URL(embedUrl)
    if (url.protocol !== 'https:') {
      return null
    }
    if (!ALLOWED_EMBED_DOMAINS.includes(url.hostname)) {
      return null
    }
    return embedUrl
  } catch {
    return null
  }
})

const workspaceSummaryBullets = computed(() => {
  if (payload.value?.type !== 'workspace_summary') {
    return []
  }
  return toSummaryBullets(payload.value.summary)
})

const summaryEdits = computed(() => {
  if (payload.value?.type !== 'workspace_summary') {
    return []
  }
  const edits = payload.value?.edits
  if (!Array.isArray(edits)) {
    return []
  }
  return edits.filter((edit: any) => edit && typeof edit.contentId === 'string')
})

const orgSlug = computed(() => activeOrg.value?.data?.slug || null)

const buildEditLink = (edit: any) => {
  if (!orgSlug.value) {
    return null
  }
  const base = localePath(`/${orgSlug.value}/content/${edit.contentId}`)
  const params = new URLSearchParams()
  if (edit.lineRange?.start && edit.lineRange?.end) {
    params.set('lines', `${edit.lineRange.start}-${edit.lineRange.end}`)
  }
  if (edit.sectionTitle) {
    params.set('section', edit.sectionTitle)
  }
  const query = params.toString()
  return query ? `${base}?${query}` : base
}

const summaryEditsWithLinks = computed(() => summaryEdits.value.map(edit => ({
  ...edit,
  link: buildEditLink(edit)
})))

const baseClass = computed(() => ['prose prose-invert max-w-none text-[15px] leading-6', props.bodyClass].filter(Boolean).join(' '))

function toSummaryBullets(summary: string | null | undefined) {
  if (!summary) {
    return []
  }
  const normalized = summary.replace(/\r/g, '').trim()
  if (!normalized) {
    return []
  }
  const segments = normalized.split(/\n+/).map(segment => segment.trim()).filter(Boolean)
  if (segments.length > 1) {
    return segments
  }
  const sentences = normalized.split(/(?<=[.!?])\s+/).map(line => line.trim()).filter(Boolean)
  return sentences.length ? sentences : [normalized]
}
</script>

<template>
  <div
    v-if="createdContentItems.length"
    class="space-y-2"
  >
    <p class="text-xs uppercase tracking-wide text-muted-foreground">
      Created content
    </p>
    <div class="space-y-2">
      <template
        v-for="item in createdContentItems"
        :key="item.id"
      >
        <NuxtLink
          v-if="resolveCreatedContentPath(item.id)"
          :to="resolveCreatedContentPath(item.id)"
          class="flex items-center justify-between gap-2 rounded-lg border border-surface-200/60 dark:border-surface-800/60 p-3 transition-colors hover:bg-surface-50 dark:hover:bg-surface-900/50 cursor-pointer"
        >
          <p class="font-medium truncate text-sm text-foreground">
            {{ item.title }}
          </p>
          <UIcon
            name="i-lucide-chevron-right"
            class="h-4 w-4 text-muted-foreground flex-shrink-0"
          />
        </NuxtLink>
        <div
          v-else
          class="flex items-center justify-between gap-2 rounded-lg border border-surface-200/60 dark:border-surface-800/60 p-3"
        >
          <p class="font-medium truncate text-sm text-foreground">
            {{ item.title }}
          </p>
        </div>
      </template>
    </div>
  </div>
  <div
    v-else-if="payload?.type === 'workspace_summary'"
    :class="baseClass"
  >
    <p class="text-sm font-semibold">
      Summary
    </p>
    <ul class="list-disc pl-5 space-y-1">
      <li
        v-for="(item, index) in workspaceSummaryBullets"
        :key="index"
      >
        {{ item }}
      </li>
    </ul>
    <div
      v-if="summaryEditsWithLinks.length"
      class="mt-4 space-y-2"
    >
      <p class="text-sm font-semibold">
        Edited sections
      </p>
      <ul class="space-y-2">
        <li
          v-for="(edit, index) in summaryEditsWithLinks"
          :key="`edit-${index}`"
          class="flex flex-col gap-1"
        >
          <div class="flex items-center gap-2">
            <NuxtLink
              v-if="edit.link"
              :to="edit.link"
              class="text-primary underline decoration-dotted"
            >
              {{ edit.sectionTitle || edit.sectionId || 'Section edit' }}
            </NuxtLink>
            <span
              v-else
              class="text-muted-foreground"
            >
              {{ edit.sectionTitle || edit.sectionId || 'Section edit' }}
            </span>
            <span class="text-xs text-muted-500">
              {{ edit.contentTitle || 'Content' }}
            </span>
            <span
              v-if="edit.additions !== undefined || edit.deletions !== undefined"
              class="text-xs font-mono text-muted-500"
            >
              +{{ edit.additions ?? 0 }} / -{{ edit.deletions ?? 0 }}
            </span>
          </div>
          <div
            v-if="edit.reason"
            class="text-xs text-muted-500"
          >
            Why: {{ edit.reason }}
          </div>
        </li>
      </ul>
    </div>
  </div>
  <div
    v-else
    :class="baseClass"
  >
    <div
      v-if="safeEmbedUrl"
      class="mb-4"
    >
      <iframe
        :src="safeEmbedUrl"
        class="w-full aspect-video rounded-xl"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin"
        referrerpolicy="no-referrer"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
      />
    </div>
    <div
      v-else-if="preview?.thumbnailUrl && preview?.url"
      class="mb-4"
    >
      <NuxtLink
        :to="preview.url"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex flex-col gap-2 rounded-xl border border-surface-200/60 dark:border-surface-800/60 overflow-hidden"
      >
        <img
          :src="preview.thumbnailUrl"
          :alt="preview.title || 'Source preview'"
          class="w-full object-cover"
        >
        <div class="px-4 py-2 text-sm text-primary">
          {{ preview.title || 'View source' }}
        </div>
      </NuxtLink>
    </div>
    <div
      v-if="isError && errorDetails"
      class="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm"
    >
      <p class="font-medium mb-1">
        {{ t('chat.errorDetails') }}
      </p>
      <p class="font-mono text-xs whitespace-pre-wrap break-words opacity-90">
        {{ t('chat.genericError') }}
      </p>
    </div>

    <!-- Tool calls: Show first (they execute before the LLM response) -->
    <template v-if="props.showToolDetails && (hasToolCalls || hasLiveToolActivities)">
      <AgentProgressTracker
        :message="message"
        :current-activity="currentActivity"
        :live-activities="liveToolActivities"
      />
    </template>

    <!-- Text parts: Show after tool calls (LLM response reflects tool results) -->
    <template v-if="renderedTextParts.length > 0 && !hasLiveToolActivities">
      <p
        v-for="(part, index) in renderedTextParts"
        :key="`${message.id}-text-${index}`"
        class="whitespace-pre-line break-words"
      >
        <template
          v-for="(segment, segmentIndex) in part.segments"
          :key="`${message.id}-segment-${index}-${segmentIndex}`"
        >
          <NuxtLink
            v-if="segment.type === 'link' && !segment.external"
            :to="segment.href"
            class="text-primary underline decoration-dotted break-words"
          >
            {{ segment.text }}
          </NuxtLink>
          <a
            v-else-if="segment.type === 'link'"
            :href="segment.href"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline decoration-dotted break-words"
          >
            {{ segment.text }}
          </a>
          <span v-else>
            {{ segment.text }}
          </span>
        </template>
      </p>
    </template>
  </div>
</template>
