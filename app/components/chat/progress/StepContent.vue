<script setup lang="ts">
import type { Step } from './ProgressStep.vue'
import ThinkingIndicator from './ThinkingIndicator.vue'
import FileDiffView from './FileDiffView.vue'
import AnalysisStep from './AnalysisStep.vue'
import ToolExecutionStep from './ToolExecutionStep.vue'

interface Props {
  step: Step
  stepType: 'file_edit' | 'analysis' | 'search' | 'tool_execution' | 'thinking'
}

const props = defineProps<Props>()
</script>

<template>
  <div class="step-content px-4 pb-3 pt-2 space-y-2">
    <!-- Thinking Indicator -->
    <ThinkingIndicator
      v-if="stepType === 'thinking'"
      :step="step"
    />

    <!-- File Edit Display -->
    <FileDiffView
      v-else-if="stepType === 'file_edit'"
      :step="step"
    />

    <!-- Analysis/Search Display -->
    <AnalysisStep
      v-else-if="stepType === 'analysis' || stepType === 'search'"
      :step="step"
      :step-type="stepType"
    />

    <!-- Default Tool Execution Display -->
    <ToolExecutionStep
      v-else
      :step="step"
    />
  </div>
</template>
