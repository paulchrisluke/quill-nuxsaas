<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentList } from '~/composables/useContentList'
import { useFileList } from '~/composables/useFileList'

definePageMeta({
  ssr: false
})

const route = useRoute()
const localePath = useLocalePath()
const { useActiveOrganization, isAuthenticatedUser } = useAuth()
const activeOrg = useActiveOrganization()

const slug = computed(() => {
  const param = route.params.slug
  return Array.isArray(param) ? param[0] : param || ''
})

const {
  items: contentItems,
  pending: contentPending,
  loadInitial: loadContentInitial
} = useContentList({ pageSize: 6, stateKey: 'dashboard-content' })

const {
  items: fileItems,
  pending: filePending,
  loadInitial: loadFileInitial
} = useFileList({ pageSize: 6, stateKey: 'dashboard-files' })

const recentContent = computed(() => contentItems.value.slice(0, 6))
const recentFiles = computed(() => fileItems.value.slice(0, 6))

const loadDashboardData = async () => {
  if (!isAuthenticatedUser.value) {
    return
  }
  await Promise.allSettled([
    loadContentInitial(),
    loadFileInitial()
  ])
}

onMounted(() => {
  loadDashboardData().catch(() => {})
})

watch(isAuthenticatedUser, (value) => {
  if (value) {
    loadDashboardData().catch(() => {})
  }
})
</script>

<template>
  <div class="space-y-6 px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
    <div class="space-y-1">
      <p class="text-xs uppercase tracking-wide text-muted-500">
        Workspace
      </p>
      <h1 class="text-2xl sm:text-3xl font-semibold">
        {{ activeOrg.value?.data?.name || 'Dashboard' }}
      </h1>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard>
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-600">
            Content items
          </p>
          <p class="text-2xl font-semibold">
            {{ contentItems.length }}
          </p>
          <UButton
            :to="localePath(`/${slug}/content`)"
            size="sm"
            variant="ghost"
            icon="i-lucide-file-text"
          >
            View content
          </UButton>
        </div>
      </UCard>
      <UCard>
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-600">
            Uploaded files
          </p>
          <p class="text-2xl font-semibold">
            {{ fileItems.length }}
          </p>
          <UButton
            :to="localePath(`/${slug}/files`)"
            size="sm"
            variant="ghost"
            icon="i-lucide-folder"
          >
            View files
          </UButton>
        </div>
      </UCard>
      <UCard>
        <div class="space-y-2">
          <p class="text-sm font-medium text-muted-600">
            Quick actions
          </p>
          <div class="flex flex-col gap-2">
            <UButton
              :to="localePath(`/${slug}/content`)"
              size="sm"
              icon="i-lucide-plus"
            >
              Create content
            </UButton>
            <UButton
              :to="localePath(`/${slug}/conversations`)"
              size="sm"
              variant="soft"
              icon="i-lucide-messages-square"
            >
              Open conversations
            </UButton>
          </div>
        </div>
      </UCard>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">
              Recent content
            </h2>
            <UButton
              :to="localePath(`/${slug}/content`)"
              size="xs"
              variant="ghost"
            >
              See all
            </UButton>
          </div>
        </template>
        <div class="space-y-3">
          <div
            v-if="contentPending"
            class="space-y-2"
          >
            <USkeleton class="h-4 w-3/4" />
            <USkeleton class="h-4 w-2/3" />
            <USkeleton class="h-4 w-1/2" />
          </div>
          <div
            v-else-if="recentContent.length === 0"
            class="text-sm text-muted-500"
          >
            No content yet. Start a conversation to create your first draft.
          </div>
          <div
            v-else
            class="space-y-2"
          >
            <NuxtLink
              v-for="item in recentContent"
              :key="item.id"
              :to="localePath(`/${slug}/content/${item.id}`)"
              class="flex items-center justify-between gap-2 rounded-lg border border-surface-200/60 dark:border-surface-800/60 p-3 text-sm transition-colors hover:bg-surface-50 dark:hover:bg-surface-900/50"
            >
              <div class="min-w-0">
                <p class="font-medium truncate">
                  {{ item.displayLabel }}
                </p>
                <p class="text-xs text-muted-500">
                  Updated {{ item.updatedAgo }}
                </p>
              </div>
              <UIcon
                name="i-lucide-chevron-right"
                class="h-4 w-4 text-muted-400"
              />
            </NuxtLink>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">
              Recent uploads
            </h2>
            <UButton
              :to="localePath(`/${slug}/files`)"
              size="xs"
              variant="ghost"
            >
              See all
            </UButton>
          </div>
        </template>
        <div class="space-y-3">
          <div
            v-if="filePending"
            class="space-y-2"
          >
            <USkeleton class="h-4 w-3/4" />
            <USkeleton class="h-4 w-2/3" />
            <USkeleton class="h-4 w-1/2" />
          </div>
          <div
            v-else-if="recentFiles.length === 0"
            class="text-sm text-muted-500"
          >
            No files yet. Upload images from the chat bar.
          </div>
          <div
            v-else
            class="space-y-2"
          >
            <NuxtLink
              v-for="file in recentFiles"
              :key="file.id"
              :to="localePath(`/${slug}/files/${file.id}`)"
              class="flex items-center justify-between gap-2 rounded-lg border border-surface-200/60 dark:border-surface-800/60 p-3 text-sm transition-colors hover:bg-surface-50 dark:hover:bg-surface-900/50"
            >
              <div class="min-w-0">
                <p class="font-medium truncate">
                  {{ file.originalName || file.fileName }}
                </p>
                <p class="text-xs text-muted-500">
                  {{ file.fileType || file.mimeType }}
                </p>
              </div>
              <UIcon
                name="i-lucide-chevron-right"
                class="h-4 w-4 text-muted-400"
              />
            </NuxtLink>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
