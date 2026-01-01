<script setup lang="ts">
import { computed, nextTick, ref, useAttrs, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  open: boolean
  query: string
  groups: ReferenceSuggestionGroups
  activeIndex: number
}>()

const emit = defineEmits<{
  select: [item: ReferenceSuggestionItem]
  close: []
  navigate: [delta: number]
  queryChange: [value: string]
}>()

interface ReferenceSuggestionItem {
  id: string
  label: string
  subtitle?: string
  insertText: string
  type: 'file' | 'content' | 'section'
}

interface ReferenceSuggestionGroups {
  files: ReferenceSuggestionItem[]
  contents: ReferenceSuggestionItem[]
}

const attrs = useAttrs()
const inputRef = ref<HTMLInputElement | null>(null)
const rootRef = ref<HTMLDivElement | null>(null)

defineExpose({ rootRef })

const flatItems = computed(() => [
  ...props.groups.contents,
  ...props.groups.files
])

const offsets = computed(() => ({
  files: props.groups.contents.length
}))

const emptyMessage = computed(() => {
  if (props.query) {
    return 'No matches found.'
  }
  return 'Start typing to search for content or files.'
})

const focusInput = async () => {
  await nextTick()
  if (inputRef.value) {
    inputRef.value.focus()
    inputRef.value.select()
  }
}

watch(() => props.open, (open) => {
  if (open) {
    void focusInput()
  }
})

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    emit('navigate', 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    emit('navigate', -1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const item = flatItems.value[props.activeIndex]
    if (item) {
      emit('select', item)
    }
  } else if (event.key === 'Tab') {
    event.preventDefault()
    const item = flatItems.value[props.activeIndex]
    if (item) {
      emit('select', item)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition duration-100 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div
      v-if="open"
      v-bind="attrs"
      ref="rootRef"
      class="relative rounded-3xl border border-neutral-200/70 dark:border-neutral-800/60 bg-gray-50 dark:bg-neutral-900 shadow-2xl"
    >
      <div class="border-b border-neutral-200/70 dark:border-neutral-800/60 px-3 py-2">
        <input
          ref="inputRef"
          :value="query"
          type="text"
          placeholder="Search content or files"
          class="w-full bg-transparent text-sm text-muted-900 dark:text-muted-100 placeholder:text-muted-400 focus:outline-none"
          @keydown="handleKeyDown"
          @input="emit('queryChange', ($event.target as HTMLInputElement).value)"
        >
      </div>
      <div class="max-h-[50vh] overflow-y-auto hide-scrollbar px-2 py-3">
        <p
          v-if="flatItems.length === 0"
          class="px-3 py-4 text-sm text-muted-500"
        >
          {{ emptyMessage }}
        </p>
        <div
          v-else
          class="space-y-3"
        >
          <div v-if="groups.contents.length">
            <p class="px-3 text-[11px] uppercase tracking-wide text-muted-400">
              Content
            </p>
            <button
              v-for="(item, index) in groups.contents"
              :key="item.id"
              type="button"
              class="w-full rounded-2xl px-3 py-2 text-sm text-left hover:bg-muted-100 dark:hover:bg-muted-800"
              :class="index === activeIndex ? 'bg-muted-100 dark:bg-muted-800' : ''"
              @click="emit('select', item)"
            >
              <div class="flex flex-col">
                <span class="font-medium text-muted-900 dark:text-muted-100">{{ item.label }}</span>
                <span
                  v-if="item.subtitle"
                  class="text-xs text-muted-500 dark:text-muted-400 truncate"
                >
                  {{ item.subtitle }}
                </span>
              </div>
            </button>
          </div>

          <div v-if="groups.files.length">
            <p class="px-3 text-[11px] uppercase tracking-wide text-muted-400">
              Files
            </p>
            <button
              v-for="(item, index) in groups.files"
              :key="item.id"
              type="button"
              class="w-full rounded-2xl px-3 py-2 text-sm text-left hover:bg-muted-100 dark:hover:bg-muted-800"
              :class="offsets.files + index === activeIndex ? 'bg-muted-100 dark:bg-muted-800' : ''"
              @click="emit('select', item)"
            >
              <div class="flex flex-col">
                <span class="font-medium text-muted-900 dark:text-muted-100">{{ item.label }}</span>
                <span
                  v-if="item.subtitle"
                  class="text-xs text-muted-500 dark:text-muted-400 truncate"
                >
                  {{ item.subtitle }}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-gray-50 dark:from-neutral-900 to-transparent" />
    </div>
  </Transition>
</template>
