<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import StepContent from './StepContent.vue'
import StepHeader from './StepHeader.vue'

export interface Step {
  stepNumber: number
  toolCallId: string
  toolName: string
  status: 'preparing' | 'running' | 'success' | 'error'
  args?: Record<string, any>
  result?: any
  error?: string
  progressMessage?: string
  timestamp?: string
}

interface Props {
  step: Step
  collapsed?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (event: 'toggle', toolCallId: string): void
}>()

const isCollapsed = ref(props.collapsed ?? false)

// Determine step type from toolName and result
const stepType = computed(() => {
  // TODO: Implement logic to determine step type
  // Examples:
  // - If toolName includes 'edit' or result has fileEdits → 'file_edit'
  // - If toolName includes 'read' or 'analyze' → 'analysis'
  // - If toolName includes 'search' → 'search'
  // - If result has thinking content → 'thinking'
  // - Default → 'tool_execution'

  if (props.step.result?.fileEdits || props.step.toolName.includes('edit')) {
    return 'file_edit'
  }
  if (props.step.toolName.includes('read') || props.step.toolName.includes('analyze')) {
    return 'analysis'
  }
  if (props.step.toolName.includes('search')) {
    return 'search'
  }
  return 'tool_execution'
})

const handleToggle = () => {
  isCollapsed.value = !isCollapsed.value
  emit('toggle', props.step.toolCallId)
}

// Watch for prop changes
watch(() => props.collapsed, (newVal) => {
  if (newVal !== undefined) {
    isCollapsed.value = newVal
  }
})
</script>

<template>
  <div class="progress-step rounded-lg border border-muted-200 dark:border-muted-800 bg-muted/30 dark:bg-muted-800/50 overflow-hidden">
    <StepHeader
      :step-number="step.stepNumber"
      :tool-name="step.toolName"
      :status="step.status"
      :collapsed="isCollapsed"
      @toggle="handleToggle"
    />

    <div
      v-if="!isCollapsed"
      class="step-content-wrapper"
    >
      <StepContent
        :step="step"
        :step-type="stepType"
      />
    </div>
  </div>
</template>
