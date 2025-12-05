<script setup lang="ts">
interface DraftEntry {
  id: string
  title: string
  slug: string
  status: string
  updatedAt: Date | null
  contentType: string
  additions?: number
  deletions?: number
}

interface Props {
  draftsPending: boolean
  contentEntries: DraftEntry[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  openWorkspace: [entry: DraftEntry]
}>()

const activeTab = ref(0)

const tabs = [
  { label: 'Drafts', value: 0 },
  { label: 'Archived', value: 1 }
]

const filteredEntries = computed(() => {
  if (activeTab.value === 1) {
    // Show only archived items
    return props.contentEntries.filter((entry) => {
      const status = (entry.status || '').toLowerCase().trim()
      return status === 'archived'
    })
  }
  // Show non-archived items (Drafts tab)
  return props.contentEntries.filter((entry) => {
    const status = (entry.status || '').toLowerCase().trim()
    return status !== 'archived'
  })
})

const hasFilteredContent = computed(() => filteredEntries.value.length > 0)

const handleOpenWorkspace = (entry: DraftEntry) => {
  emit('openWorkspace', entry)
}

const formatUpdatedAt = (date: Date | null) => {
  if (!date) {
    return '—'
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}
</script>

<template>
  <section class="space-y-3 w-full">
    <UTabs
      v-model="activeTab"
      variant="link"
      :items="tabs"
    />

    <div
      v-if="hasFilteredContent"
      class="divide-y divide-muted-200/60"
    >
      <button
        v-for="entry in filteredEntries"
        :key="entry.id"
        type="button"
        class="w-full text-left py-4 px-1 space-y-2 hover:bg-muted/30 transition-colors"
        @click="handleOpenWorkspace(entry)"
      >
        <div class="flex items-center justify-between gap-3">
          <p class="font-medium leading-tight truncate">
            {{ entry.title }}
          </p>
          <UBadge
            color="neutral"
            variant="soft"
            class="capitalize"
          >
            {{ entry.status || 'draft' }}
          </UBadge>
        </div>
        <div class="text-xs text-muted-500 flex flex-wrap items-center gap-1">
          <span>{{ formatUpdatedAt(entry.updatedAt) }}</span>
          <span>·</span>
          <span class="capitalize">
            {{ entry.contentType || 'content' }}
          </span>
          <span>·</span>
          <span class="font-mono text-[11px] text-muted-600 truncate">
            {{ entry.id }}
          </span>
          <span>·</span>
          <span class="text-emerald-500 dark:text-emerald-400">
            +{{ entry.additions ?? 0 }}
          </span>
          <span class="text-rose-500 dark:text-rose-400">
            -{{ entry.deletions ?? 0 }}
          </span>
        </div>
      </button>
    </div>
    <div
      v-else
      class="text-center text-sm text-muted-500"
    >
      {{ activeTab === 1 ? 'No archived drafts' : 'No drafts yet' }}
    </div>
  </section>
</template>
