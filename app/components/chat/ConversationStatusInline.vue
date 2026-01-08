<script setup lang="ts">
interface StatusStep {
  id: string
  label: string
  status: 'preparing' | 'running'
  progressMessage?: string | null
}

const props = withDefaults(defineProps<{
  phase?: 'idle' | 'submitting' | 'working' | 'streaming' | 'error'
  label?: string | null
  steps?: StatusStep[]
  showDetails?: boolean
  loading?: boolean
}>(), {
  phase: 'idle',
  label: null,
  steps: () => [],
  showDetails: false,
  loading: false
})

const emit = defineEmits<{
  (event: 'toggleDetails'): void
}>()

const showSteps = computed(() => props.steps.length > 0)
const isActive = computed(() => props.phase !== 'idle' || props.loading)
const iconName = computed(() => {
  if (props.phase === 'error') {
    return 'i-lucide-alert-triangle'
  }
  return 'i-lucide-loader-circle'
})

const iconClass = computed(() => (
  props.phase === 'error' ? 'text-red-500' : 'text-primary animate-spin'
))
</script>

<template>
  <div
    v-if="isActive || showSteps"
    class="mb-3 rounded-xl border border-muted-200/70 dark:border-muted-800/70 bg-muted/30 dark:bg-muted-800/40 px-3 py-2 text-sm"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <UIcon
          :name="iconName"
          class="h-4 w-4"
          :class="iconClass"
        />
        <span class="font-medium text-muted-700 dark:text-muted-200">
          {{ label || (loading ? 'Loading conversation...' : 'Working...') }}
        </span>
      </div>
      <UButton
        v-if="showSteps"
        size="xs"
        variant="ghost"
        color="neutral"
        :icon="showDetails ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="emit('toggleDetails')"
      >
        {{ showDetails ? 'Hide details' : 'Show details' }}
      </UButton>
    </div>

    <div
      v-if="showSteps"
      class="mt-2 space-y-1 text-xs text-muted-600 dark:text-muted-400"
    >
      <div
        v-for="step in steps"
        :key="step.id"
        class="flex items-center justify-between gap-2"
      >
        <div class="flex items-center gap-2">
          <span class="inline-flex h-1.5 w-1.5 rounded-full bg-primary/70" />
          <span>{{ step.label }}</span>
        </div>
        <span class="text-[11px] uppercase tracking-wide">
          {{ step.status }}
        </span>
      </div>
      <p
        v-if="steps[0]?.progressMessage"
        class="text-[11px]"
      >
        {{ steps[0].progressMessage }}
      </p>
    </div>
  </div>
</template>
