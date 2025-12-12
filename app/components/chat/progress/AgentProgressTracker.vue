<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { computed, ref } from 'vue'
import ProgressControls from './ProgressControls.vue'
import ProgressStep from './ProgressStep.vue'

interface Props {
  message: ChatMessage
  showControls?: boolean
  defaultCollapsed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showControls: true,
  defaultCollapsed: false
})

// Extract all tool calls and organize them as numbered steps
const progressSteps = computed(() => {
  return props.message.parts
    .filter(part => part.type === 'tool_call')
    .map((part, index) => ({
      stepNumber: index + 1,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      status: part.status,
      args: part.args,
      result: part.result,
      error: part.error,
      progressMessage: part.progressMessage,
      timestamp: part.timestamp
    }))
})

// Only show tracker if there are tool calls
const hasSteps = computed(() => progressSteps.value.length > 0)

// Global collapse state
const allCollapsed = ref(props.defaultCollapsed)
const individualCollapsed = ref<Set<string>>(new Set())

const handleCollapseAll = () => {
  allCollapsed.value = true
  individualCollapsed.value = new Set(progressSteps.value.map(s => s.toolCallId))
}

const handleExpandAll = () => {
  allCollapsed.value = false
  individualCollapsed.value.clear()
}

const isStepCollapsed = (toolCallId: string) => {
  return allCollapsed.value || individualCollapsed.value.has(toolCallId)
}

const toggleStep = (toolCallId: string) => {
  if (individualCollapsed.value.has(toolCallId)) {
    individualCollapsed.value.delete(toolCallId)
  } else {
    individualCollapsed.value.add(toolCallId)
  }
}
</script>

<template>
  <div
    v-if="hasSteps"
    class="agent-progress-tracker space-y-2"
  >
    <ProgressControls
      v-if="showControls && progressSteps.length > 1"
      :all-collapsed="allCollapsed"
      @collapse-all="handleCollapseAll"
      @expand-all="handleExpandAll"
    />

    <div class="space-y-2">
      <ProgressStep
        v-for="step in progressSteps"
        :key="step.toolCallId"
        :step="step"
        :collapsed="isStepCollapsed(step.toolCallId)"
        @toggle="toggleStep(step.toolCallId)"
      />
    </div>
  </div>
</template>
