<script setup lang="ts">
import { formatFileSize } from '~~/shared/utils/format'

interface FileResponse {
  file: {
    id: string
    originalName: string
    fileName: string
    mimeType: string
    fileType: string
    size: number
    url: string | null
    contentId: string | null
    createdAt: string
    updatedAt: string
  }
}

const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const toast = useToast()
const openWorkspace = inject<(() => void) | undefined>('openWorkspace')

const fileId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
})

const { data, pending, error, refresh } = useFetch<FileResponse>(() => `/api/file/${fileId.value}`, {
  key: computed(() => `file-${fileId.value}`),
  lazy: true,
  server: false
})

const file = computed(() => data.value?.file ?? null)
const isImage = computed(() => (file.value?.mimeType || '').startsWith('image/'))
const previewSrc = computed(() => file.value ? `/api/images/${file.value.id}` : null)
const downloadUrl = computed(() => file.value?.url ?? previewSrc.value)

const openLinkedContent = () => {
  if (!file.value?.contentId)
    return
  const slug = route.params.slug
  const slugValue = Array.isArray(slug) ? slug[0] : slug
  if (!slugValue)
    return
  router.push(localePath(`/${slugValue}/content/${file.value.contentId}`))
  if (typeof openWorkspace === 'function') {
    openWorkspace()
  }
}

const copyLink = async () => {
  if (!downloadUrl.value)
    return
  try {
    await navigator.clipboard.writeText(new URL(downloadUrl.value, window.location.origin).toString())
    toast.add({
      title: 'Link copied',
      color: 'success'
    })
  } catch (err) {
    console.error('Failed to copy link', err)
    toast.add({
      title: 'Unable to copy link',
      description: err instanceof Error ? err.message : 'Please try again.',
      color: 'error'
    })
  }
}
</script>

<template>
  <div class="p-4 sm:p-6 space-y-6">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="space-y-1">
        <p class="text-xs uppercase tracking-wide text-muted-foreground">
          File
        </p>
        <h1 class="text-xl font-semibold">
          {{ file?.originalName || 'Loading file…' }}
        </h1>
        <p
          v-if="file"
          class="text-sm text-muted-foreground"
        >
          {{ file.mimeType }} · {{ formatFileSize(file.size) }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="file?.contentId"
          icon="i-lucide-notebook-pen"
          variant="ghost"
          @click="openLinkedContent"
        >
          Open related content
        </UButton>
        <UButton
          v-if="downloadUrl"
          icon="i-lucide-copy"
          variant="ghost"
          color="neutral"
          @click="copyLink"
        >
          Copy link
        </UButton>
        <UButton
          v-if="downloadUrl"
          :href="downloadUrl"
          target="_blank"
          icon="i-lucide-external-link"
        >
          Open original
        </UButton>
      </div>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :title="error?.message || 'Failed to load file'"
      class="max-w-3xl"
      @close="refresh"
    />

    <div
      v-else
      class="grid grid-cols-1 gap-6 lg:grid-cols-3"
    >
      <div class="lg:col-span-2">
        <UCard v-if="pending">
          <div class="space-y-3">
            <USkeleton class="h-6 w-1/3" />
            <USkeleton class="h-64 w-full" />
          </div>
        </UCard>
        <UCard v-else-if="file">
          <div class="space-y-4">
            <div
              v-if="isImage && previewSrc"
              class="relative"
            >
              <img
                :src="previewSrc"
                :alt="file.originalName"
                class="w-full rounded-md border border-neutral-200 dark:border-neutral-800 object-contain max-h-[70vh]"
                loading="lazy"
                decoding="async"
              >
            </div>
            <div
              v-else
              class="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground"
            >
              <UIcon
                name="i-lucide-file"
                class="h-10 w-10"
              />
              <p class="text-sm">
                Preview is available for images. Use the button above to open the file.
              </p>
            </div>
          </div>
        </UCard>
      </div>

      <div class="space-y-4">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-medium">
                Details
              </h2>
              <UButton
                variant="ghost"
                size="xs"
                icon="i-lucide-rotate-ccw"
                :loading="pending"
                @click="refresh"
              >
                Refresh
              </UButton>
            </div>
          </template>
          <div
            v-if="pending"
            class="space-y-2"
          >
            <USkeleton class="h-4 w-1/2" />
            <USkeleton class="h-4 w-2/3" />
            <USkeleton class="h-4 w-1/3" />
          </div>
          <dl
            v-else-if="file"
            class="space-y-3 text-sm"
          >
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted-foreground">
                Filename
              </dt>
              <dd class="text-right break-all">
                {{ file.fileName }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted-foreground">
                MIME type
              </dt>
              <dd class="text-right">
                {{ file.mimeType }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted-foreground">
                Size
              </dt>
              <dd class="text-right">
                {{ formatFileSize(file.size) }}
              </dd>
            </div>
            <div
              v-if="file.contentId"
              class="flex items-start justify-between gap-3"
            >
              <dt class="text-muted-foreground">
                Linked content
              </dt>
              <dd class="text-right">
                <UButton
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-notebook-pen"
                  @click="openLinkedContent"
                >
                  Open
                </UButton>
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted-foreground">
                Uploaded
              </dt>
              <dd class="text-right">
                {{ new Date(file.createdAt).toLocaleString() }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-muted-foreground">
                Updated
              </dt>
              <dd class="text-right">
                {{ new Date(file.updatedAt).toLocaleString() }}
              </dd>
            </div>
          </dl>
        </UCard>
      </div>
    </div>
  </div>
</template>
