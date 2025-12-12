<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  stepNumber: number
  toolName: string
  status: 'preparing' | 'running' | 'success' | 'error'
  collapsed: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (event: 'toggle'): void
}>()

// Tool display names (reuse from AgentStatus.vue)
const toolDisplayNames: Record<string, string> = {
  source_ingest: 'Ingest Source',
  content_write: 'Write Content',
  edit_section: 'Edit Section',
  edit_metadata: 'Update Metadata',
  read_content: 'Read Content',
  read_section: 'Read Section',
  read_source: 'Read Source',
  read_content_list: 'List Content',
  read_source_list: 'List Sources',
  read_workspace_summary: 'Workspace Summary'
}

const displayName = computed(() =>
  toolDisplayNames[props.toolName] || props.toolName
)

const statusIcon = computed(() => {
  switch (props.status) {
    case 'preparing':
      return 'i-lucide-clock'
    case 'running':
      return 'i-lucide-loader-circle'
    case 'success':
      return 'i-lucide-check-circle'
    case 'error':
      return 'i-lucide-x-circle'
    default:
      return 'i-lucide-circle'
  }
})

const statusColor = computed(() => {
  switch (props.status) {
    case 'preparing':
      return 'neutral'
    case 'running':
      return 'primary'
    case 'success':
      return 'success'
    case 'error':
      return 'error'
    default:
      return 'neutral'
  }
})
</script>

<template>
  <div
    class="step-header flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 dark:hover:bg-muted-700/50 transition-colors"
    @click="emit('toggle')"
  >
    <!-- Step Number Badge -->
    <UBadge
      :color="statusColor"
      variant="soft"
      size="sm"
      class="font-mono font-semibold min-w-[2rem] justify-center"
    >
      {{ stepNumber }}
    </UBadge>

    <!-- Status Icon -->
    <UIcon
      :name="statusIcon"
      class="h-4 w-4 flex-shrink-0"
      :class="status === 'running' ? 'animate-spin' : (status === 'preparing' ? 'animate-pulse' : '')"
      :dynamic="true"
    />

    <!-- Tool Name -->
    <span class="font-medium text-sm flex-1">
      {{ displayName }}
    </span>

    <!-- Status Badge -->
    <UBadge
      v-if="status !== 'success'"
      :color="statusColor"
      variant="soft"
      size="xs"
    >
      {{ status === 'preparing' ? 'Preparing...' : status === 'running' ? 'Running...' : 'Failed' }}
    </UBadge>

    <!-- Collapse/Expand Icon -->
    <UIcon
      :name="collapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
      class="h-4 w-4 text-muted-500 flex-shrink-0"
    />
  </div>
</template>
