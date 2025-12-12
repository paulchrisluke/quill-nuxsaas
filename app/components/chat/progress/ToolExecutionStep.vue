<script setup lang="ts">
import type { Step } from './ProgressStep.vue'
import { computed } from 'vue'

interface Props {
  step: Step
}

const props = defineProps<Props>()

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

const _displayName = computed(() =>
  toolDisplayNames[props.step.toolName] || props.step.toolName
)

// TODO: Format tool arguments for display
const formattedArgs = computed(() => {
  if (!props.step.args) {
    return null
  }
  // Format args for display (truncate long values, etc.)
  return JSON.stringify(props.step.args, null, 2)
})

// TODO: Format tool result for display
const formattedResult = computed(() => {
  if (!props.step.result) {
    return null
  }
  // Format result for display
  if (typeof props.step.result === 'string') {
    return props.step.result
  }
  return JSON.stringify(props.step.result, null, 2)
})
</script>

<template>
  <div class="tool-execution-step space-y-2">
    <!-- Tool Arguments (if available and not too long) -->
    <div
      v-if="formattedArgs && formattedArgs.length < 200"
      class="text-xs"
    >
      <span class="text-muted-600 dark:text-muted-400">Arguments:</span>
      <pre class="mt-1 p-2 rounded bg-muted/30 dark:bg-muted-700/30 font-mono text-xs overflow-x-auto">{{ formattedArgs }}</pre>
    </div>

    <!-- Progress Message -->
    <div
      v-if="step.progressMessage"
      class="text-xs text-muted-500 italic"
    >
      {{ step.progressMessage }}
    </div>

    <!-- Success Result -->
    <div
      v-if="step.status === 'success' && formattedResult"
      class="text-xs"
    >
      <span class="text-muted-600 dark:text-muted-400">Result:</span>
      <pre class="mt-1 p-2 rounded bg-muted/30 dark:bg-muted-700/30 font-mono text-xs overflow-x-auto max-h-32 overflow-y-auto">{{ formattedResult }}</pre>
    </div>

    <!-- Error Display -->
    <div
      v-if="step.status === 'error' && step.error"
      class="p-2 rounded border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400"
    >
      <UIcon
        name="i-lucide-alert-circle"
        class="h-3 w-3 inline mr-1"
      />
      {{ step.error }}
    </div>
  </div>
</template>
