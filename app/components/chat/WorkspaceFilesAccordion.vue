<script setup lang="ts">
import type { WorkspaceFilePayload } from '~/server/services/content/workspaceFiles'
import { NON_ORG_SLUG } from '~~/shared/constants/routing'

const props = defineProps<{
  files: WorkspaceFilePayload[]
}>()

const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const localePath = useLocalePath()

const contentIdCache = ref<Record<string, string>>({})
const filePaths = ref<Record<string, string>>({})
const pathsReady = ref(false)

const lookupContentId = async (versionId: string): Promise<string> => {
  if (contentIdCache.value[versionId]) {
    return contentIdCache.value[versionId]
  }

  const data = await $fetch<{ contentId: string }>(`/api/content/version/${versionId}/content-id`)
  if (!data?.contentId) {
    throw new Error(`[WorkspaceFilesAccordion] Failed to lookup contentId for version ${versionId}`)
  }
  contentIdCache.value[versionId] = data.contentId
  return data.contentId
}

const resolveFilePaths = async () => {
  const slug = activeOrg.value?.data?.slug
  if (!slug || slug === NON_ORG_SLUG) {
    // Organization not yet loaded or invalid - wait for watcher to re-trigger
    pathsReady.value = false
    return
  }

  if (!props.files || props.files.length === 0) {
    pathsReady.value = true
    return
  }

  pathsReady.value = false
  try {
    for (const file of props.files) {
      if (filePaths.value[file.id]) {
        continue
      }

      const contentId = file.contentId || await lookupContentId(file.id)
      if (!contentId) {
        throw new Error(`[WorkspaceFilesAccordion] Failed to get contentId for file ${file.id}`)
      }
      filePaths.value[file.id] = localePath(`/${slug}/content/${contentId}`)
    }
    pathsReady.value = true
  } catch (error) {
    console.error('[WorkspaceFilesAccordion] Error resolving file paths:', error)
    throw error
  }
}

watch(() => [props.files, activeOrg.value?.data?.slug], async () => {
  try {
    await resolveFilePaths()
  } catch (error) {
    console.error('[WorkspaceFilesAccordion] Failed to resolve file paths:', error)
  }
}, { immediate: true })

const getContentPath = (file: WorkspaceFilePayload): string => {
  const path = filePaths.value[file.id]
  if (!path) {
    throw new Error(`[WorkspaceFilesAccordion] Path not resolved for file ${file.id}`)
  }
  return path
}

const getFileSlug = (file: WorkspaceFilePayload): string => {
  if (file.slug) {
    return file.slug
  }
  // Extract slug from filename: content/[orgSlug]/[slug].mdx -> [slug]
  const match = file.filename.match(/content\/[^/]+\/(.+)\.mdx$/)
  return match ? match[1] : file.filename.replace(/\.mdx$/, '')
}

const formatDiffStats = (diffStats: { additions: number, deletions: number } | null | undefined) => {
  if (!diffStats || (diffStats.additions === 0 && diffStats.deletions === 0))
    return null
  return `+${diffStats.additions} -${diffStats.deletions}`
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs uppercase tracking-wide text-muted-foreground">
      Files
    </p>
    <div class="space-y-2">
      <template v-if="pathsReady">
        <NuxtLink
          v-for="file in files"
          :key="file.id"
          :to="getContentPath(file)"
          class="flex items-center justify-between gap-2 rounded-lg border border-surface-200/60 dark:border-surface-800/60 p-3 transition-colors hover:bg-surface-50 dark:hover:bg-surface-900/50 cursor-pointer"
        >
          <div class="min-w-0 flex-1">
            <p class="font-medium truncate text-sm text-foreground">
              {{ getFileSlug(file) }}
            </p>
            <div
              v-if="formatDiffStats(file.diffStats)"
              class="mt-0.5 text-xs text-muted-foreground"
            >
              {{ formatDiffStats(file.diffStats) }}
            </div>
          </div>
          <UIcon
            name="i-lucide-chevron-right"
            class="h-4 w-4 text-muted-foreground flex-shrink-0"
          />
        </NuxtLink>
      </template>
    </div>
  </div>
</template>
