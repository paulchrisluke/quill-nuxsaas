<script setup lang="ts">
import type { Step } from './ProgressStep.vue'
import { computed } from 'vue'

interface Props {
  step: Step
}

const props = defineProps<Props>()

// TODO: Calculate thinking time from timestamps
// For now, this is a placeholder
const thinkingTime = computed(() => {
  // If we have timestamps, calculate duration
  // Otherwise, show placeholder
  return 'Calculating...'
})

// TODO: Get thinking content from step.result or step.args
// This might need to be added to the data structure
const thinkingContent = computed(() => {
  return props.step.result?.thinking || props.step.args?.thinking || null
})
</script>

<template>
  <div class="thinking-indicator space-y-2">
    <div class="flex items-center gap-2 text-sm text-muted-600 dark:text-muted-400">
      <UIcon
        name="i-lucide-brain"
        class="h-4 w-4"
      />
      <span class="font-medium">Thought for {{ thinkingTime }}</span>
    </div>

    <!-- Expandable thinking content -->
    <div
      v-if="thinkingContent"
      class="mt-2 p-3 rounded-lg bg-muted/50 dark:bg-muted-700/50 text-sm whitespace-pre-wrap"
    >
      {{ thinkingContent }}
    </div>

    <!-- Placeholder if no content yet -->
    <div
      v-else-if="step.status === 'running' || step.status === 'preparing'"
      class="mt-2 text-xs text-muted-500 italic"
    >
      Processing...
    </div>
  </div>
</template>
