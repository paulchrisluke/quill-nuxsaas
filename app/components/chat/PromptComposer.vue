<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  placeholder?: string
  disabled?: boolean
  status?: 'idle' | 'submitted' | 'streaming' | 'error' | string | null
  contextLabel?: string
  contextValue?: string | null
  hint?: string | null
  autofocus?: boolean
  contentId?: string | null
  mode?: 'chat' | 'agent'
}>(), {
  placeholder: '',
  disabled: false,
  status: 'idle',
  contextLabel: undefined,
  contextValue: null,
  hint: null,
  autofocus: false,
  contentId: null,
  mode: 'chat'
})

const emit = defineEmits<{
  submit: [value: string]
  stop: []
}>()

interface ReferenceToken {
  raw: string
  identifier: string
  anchor?: { kind: 'hash' | 'colon', value: string }
  startIndex: number
  endIndex: number
}

interface ReferenceCandidate {
  type: 'file' | 'content' | 'section' | 'source'
  id: string
  label: string
  subtitle?: string
  reference: string
}

interface ResolvedReference {
  type: 'file' | 'content' | 'section' | 'source'
  id: string
  token: ReferenceToken
  metadata: Record<string, any>
}

interface UnresolvedReference {
  token: ReferenceToken
  reason: string
  suggestions?: ReferenceCandidate[]
}

interface AmbiguousReference {
  token: ReferenceToken
  candidates: ReferenceCandidate[]
}

interface ReferenceResolutionResponse {
  tokens: ReferenceToken[]
  resolved: ResolvedReference[]
  unresolved: UnresolvedReference[]
  ambiguous: AmbiguousReference[]
}

interface ReferenceSuggestionItem {
  id: string
  label: string
  subtitle?: string
  insertText: string
  type: 'file' | 'content' | 'section'
}

const modelValue = defineModel<string>({ default: '' })
const composerRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const cursorIndex = ref(0)
const activeMention = ref<{ startIndex: number, query: string } | null>(null)
const highlightedIndex = ref(0)
const isAutocompleteOpen = ref(false)
const referenceResolution = ref<ReferenceResolutionResponse | null>(null)
const referenceLoading = ref(false)
const lastResolvedMessage = ref('')
const suggestionItems = ref<ReferenceSuggestionItem[]>([])

const { useActiveOrganization } = useAuth()
const activeOrganization = useActiveOrganization()
const organizationId = computed(() => activeOrganization.value?.data?.id || null)

const hasReferences = computed(() => {
  const resolution = referenceResolution.value
  if (!resolution) {
    return false
  }
  return resolution.resolved.length > 0 || resolution.ambiguous.length > 0 || resolution.unresolved.length > 0
})

const combinedSuggestions = computed(() => {
  if (!suggestionItems.value.length || !activeMention.value) {
    return []
  }
  const query = activeMention.value.query.toLowerCase()
  const filtered = suggestionItems.value.filter(item =>
    item.label.toLowerCase().includes(query) ||
    item.insertText.toLowerCase().includes(query) ||
    (item.subtitle ? item.subtitle.toLowerCase().includes(query) : false)
  )
  return filtered.slice(0, 8)
})

const isBoundaryChar = (value: string | undefined) => {
  if (!value) {
    return true
  }
  return /\s/.test(value) || /[.,!?;:()[\]{}<>"']/.test(value)
}

const updateActiveMention = () => {
  const value = modelValue.value
  const caretIndex = cursorIndex.value
  const prefix = value.slice(0, caretIndex)
  const atIndex = prefix.lastIndexOf('@')

  if (atIndex < 0) {
    activeMention.value = null
    isAutocompleteOpen.value = false
    return
  }

  const prevChar = atIndex > 0 ? prefix[atIndex - 1] : undefined
  if (!isBoundaryChar(prevChar)) {
    activeMention.value = null
    isAutocompleteOpen.value = false
    return
  }

  const query = prefix.slice(atIndex + 1)
  if (!query || !/[a-z0-9]/i.test(query[0]) || /\s/.test(query)) {
    activeMention.value = null
    isAutocompleteOpen.value = false
    return
  }

  activeMention.value = { startIndex: atIndex, query }
  highlightedIndex.value = 0
}

const applySuggestion = (item: ReferenceSuggestionItem) => {
  const mention = activeMention.value
  if (!mention) {
    return
  }

  const insertion = `@${item.insertText}`
  const value = modelValue.value
  const before = value.slice(0, mention.startIndex)
  const after = value.slice(cursorIndex.value)
  const nextValue = `${before}${insertion}${after}`

  modelValue.value = nextValue
  isAutocompleteOpen.value = false
  activeMention.value = null

  nextTick(() => {
    if (textareaRef.value) {
      const position = before.length + insertion.length
      textareaRef.value.setSelectionRange(position, position)
      textareaRef.value.focus()
      cursorIndex.value = position
    }
  })
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (!isAutocompleteOpen.value || combinedSuggestions.value.length === 0) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    highlightedIndex.value = (highlightedIndex.value + 1) % combinedSuggestions.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    highlightedIndex.value = (highlightedIndex.value - 1 + combinedSuggestions.value.length) % combinedSuggestions.value.length
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    const item = combinedSuggestions.value[highlightedIndex.value]
    if (item) {
      applySuggestion(item)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    isAutocompleteOpen.value = false
    activeMention.value = null
  }
}

const updateCursor = () => {
  if (!textareaRef.value) {
    return
  }
  cursorIndex.value = textareaRef.value.selectionStart || 0
  updateActiveMention()
}

function setTextareaRef() {
  if (!composerRef.value) {
    textareaRef.value = null
    return
  }
  const node = composerRef.value.querySelector('textarea')
  if (node instanceof HTMLTextAreaElement) {
    if (textareaRef.value && textareaRef.value !== node) {
      textareaRef.value.removeEventListener('keydown', handleKeyDown)
      textareaRef.value.removeEventListener('input', updateCursor)
      textareaRef.value.removeEventListener('click', updateCursor)
      textareaRef.value.removeEventListener('keyup', updateCursor)
    }
    textareaRef.value = node
    textareaRef.value.addEventListener('keydown', handleKeyDown)
    textareaRef.value.addEventListener('input', updateCursor)
    textareaRef.value.addEventListener('click', updateCursor)
    textareaRef.value.addEventListener('keyup', updateCursor)
  }
}

const fetchSuggestions = async () => {
  if (!organizationId.value) {
    suggestionItems.value = []
    return
  }

  try {
    const data = await $fetch('/api/chat/reference-suggestions', {
      query: {
        contentId: props.contentId || undefined
      }
    }) as {
      files: Array<{ id: string, label: string, subtitle?: string, insertText: string }>
      contents: Array<{ id: string, label: string, subtitle?: string, insertText: string }>
      sections: Array<{ id: string, label: string, subtitle?: string, insertText: string }>
    }

    suggestionItems.value = [
      ...data.sections.map(item => ({ ...item, type: 'section' as const })),
      ...data.contents.map(item => ({ ...item, type: 'content' as const })),
      ...data.files.map(item => ({ ...item, type: 'file' as const }))
    ]
  } catch (error) {
    console.error('[PromptComposer] Failed to load reference suggestions', error)
    suggestionItems.value = []
  }
}

let resolveTimeout: ReturnType<typeof setTimeout> | null = null

const scheduleReferenceResolution = (value: string) => {
  if (resolveTimeout) {
    clearTimeout(resolveTimeout)
  }

  if (!value || !value.includes('@') || !organizationId.value) {
    referenceResolution.value = null
    referenceLoading.value = false
    return
  }

  resolveTimeout = setTimeout(async () => {
    referenceLoading.value = true
    try {
      const response = await $fetch('/api/chat/resolve-references', {
        method: 'POST',
        body: {
          message: value,
          organizationId: organizationId.value,
          currentContentId: props.contentId || null,
          mode: props.mode || 'chat'
        }
      }) as ReferenceResolutionResponse
      referenceResolution.value = response
      lastResolvedMessage.value = value
    } catch (error) {
      console.error('[PromptComposer] Failed to resolve references', error)
      referenceResolution.value = null
    } finally {
      referenceLoading.value = false
    }
  }, 320)
}

const findClosestTokenIndex = (value: string, raw: string, targetIndex: number) => {
  if (!raw) {
    return -1
  }
  const indices: number[] = []
  let cursor = value.indexOf(raw)
  while (cursor !== -1) {
    indices.push(cursor)
    cursor = value.indexOf(raw, cursor + raw.length)
  }
  if (!indices.length) {
    return -1
  }
  return indices.reduce((closest, index) =>
    Math.abs(index - targetIndex) < Math.abs(closest - targetIndex) ? index : closest
  )
}

const replaceToken = (token: ReferenceToken, reference: string) => {
  const replacement = `@${reference}`
  const currentValue = modelValue.value

  if (currentValue === lastResolvedMessage.value) {
    const before = currentValue.slice(0, token.startIndex)
    const after = currentValue.slice(token.endIndex)
    modelValue.value = `${before}${replacement}${after}`
    return
  }

  const rawIndex = findClosestTokenIndex(currentValue, token.raw, token.startIndex)
  if (rawIndex === -1) {
    modelValue.value = currentValue.replace(token.raw, replacement)
    return
  }
  const before = currentValue.slice(0, rawIndex)
  const after = currentValue.slice(rawIndex + token.raw.length)
  modelValue.value = `${before}${replacement}${after}`
}

const buildDropdownItems = (token: ReferenceToken, candidates: ReferenceCandidate[]) => {
  return [candidates.map(candidate => ({
    label: candidate.label,
    icon: candidate.type === 'file'
      ? 'i-lucide-file'
      : candidate.type === 'content'
        ? 'i-lucide-file-text'
        : candidate.type === 'section'
          ? 'i-lucide-list'
          : 'i-lucide-book',
    click: () => replaceToken(token, candidate.reference)
  }))]
}

const chipLabel = (reference: ResolvedReference) => {
  if (reference.type === 'file') {
    return reference.metadata?.fileName || reference.metadata?.originalName || reference.token.raw
  }
  if (reference.type === 'content') {
    return reference.metadata?.slug || reference.token.raw
  }
  if (reference.type === 'section') {
    return `${reference.metadata?.contentSlug || reference.token.raw}#${reference.metadata?.sectionId || reference.id}`
  }
  return reference.metadata?.title || reference.token.raw
}

const handleSubmit = (value?: string | unknown) => {
  const input = typeof value === 'string' ? value : modelValue.value
  const trimmed = String(input || '').trim()
  if (trimmed) {
    emit('submit', trimmed)
  }
}

const handleStop = () => {
  emit('stop')
}

onMounted(() => {
  nextTick(setTextareaRef)
})

onBeforeUnmount(() => {
  if (resolveTimeout) {
    clearTimeout(resolveTimeout)
    resolveTimeout = null
  }
  // Reset to safe defaults to avoid callbacks running against unmounted component
  referenceLoading.value = false
  referenceResolution.value = null
  if (textareaRef.value) {
    textareaRef.value.removeEventListener('keydown', handleKeyDown)
    textareaRef.value.removeEventListener('input', updateCursor)
    textareaRef.value.removeEventListener('click', updateCursor)
    textareaRef.value.removeEventListener('keyup', updateCursor)
  }
})

watch(composerRef, () => {
  nextTick(setTextareaRef)
})

watch(modelValue, (value) => {
  scheduleReferenceResolution(value)
})

watch([organizationId, () => props.contentId], async () => {
  try {
    await fetchSuggestions()
  } catch (error) {
    console.error('[PromptComposer] Failed to fetch suggestions in watch', error)
  }
}, { immediate: true })

watch(combinedSuggestions, (value) => {
  if (!value.length) {
    isAutocompleteOpen.value = false
  } else if (activeMention.value) {
    isAutocompleteOpen.value = true
  }
})
</script>

<template>
  <div
    ref="composerRef"
    class="space-y-3 relative"
  >
    <div class="rounded-3xl overflow-hidden relative">
      <UChatPrompt
        v-model="modelValue"
        :placeholder="props.placeholder"
        variant="subtle"
        :disabled="props.disabled"
        class="flex-1 w-full min-h-[144px] [&>form]:flex [&>form]:flex-col [&>form]:min-h-[144px] [&_[data-slot=footer]]:mt-auto [&_[data-slot=footer]]:pt-2"
        :autofocus="props.autofocus"
        @submit="handleSubmit"
      >
        <template #footer>
          <div
            data-slot="footer"
            class="flex items-center justify-between gap-2 w-full"
          >
            <div>
              <slot name="footer" />
            </div>
            <div>
              <slot name="submit">
                <UChatPromptSubmit
                  :status="props.status || 'idle'"
                  submitted-color="primary"
                  submitted-variant="solid"
                  submitted-icon="i-custom-square-solid"
                  streaming-color="primary"
                  streaming-variant="solid"
                  @stop="handleStop"
                />
              </slot>
            </div>
          </div>
        </template>
      </UChatPrompt>

      <div
        v-if="isAutocompleteOpen && combinedSuggestions.length"
        class="absolute left-3 right-3 bottom-16 z-20 rounded-2xl border border-muted-200 bg-white/95 dark:bg-gray-900/95 dark:border-muted-800 shadow-lg backdrop-blur"
      >
        <div class="max-h-56 overflow-y-auto py-2">
          <button
            v-for="(item, index) in combinedSuggestions"
            :key="item.id"
            type="button"
            class="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-muted-100 dark:hover:bg-muted-800"
            :class="index === highlightedIndex ? 'bg-muted-100 dark:bg-muted-800' : ''"
            @click="applySuggestion(item)"
          >
            <UIcon
              :name="item.type === 'file'
                ? 'i-lucide-image'
                : item.type === 'content'
                  ? 'i-lucide-file-text'
                  : 'i-lucide-list'"
              class="w-4 h-4 text-muted-500"
            />
            <div class="flex flex-col">
              <span class="font-medium text-muted-900 dark:text-muted-100">
                @{{ item.label }}
              </span>
              <span
                v-if="item.subtitle"
                class="text-xs text-muted-500"
              >
                {{ item.subtitle }}
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="hasReferences"
      class="flex flex-wrap items-center gap-2 text-xs"
    >
      <template
        v-for="reference in referenceResolution?.resolved"
        :key="reference.id"
      >
        <UBadge
          color="primary"
          variant="subtle"
        >
          @{{ chipLabel(reference) }}
        </UBadge>
      </template>

      <template
        v-for="item in referenceResolution?.ambiguous"
        :key="`ambiguous-${item.token.startIndex}-${item.token.raw}`"
      >
        <UDropdownMenu
          v-if="item.candidates.length"
          :items="buildDropdownItems(item.token, item.candidates)"
        >
          <UBadge
            color="warning"
            variant="subtle"
            class="cursor-pointer"
          >
            {{ item.token.raw }} (ambiguous)
          </UBadge>
        </UDropdownMenu>
        <UBadge
          v-else
          color="warning"
          variant="subtle"
        >
          {{ item.token.raw }} (ambiguous)
        </UBadge>
      </template>

      <template
        v-for="item in referenceResolution?.unresolved"
        :key="`unresolved-${item.token.startIndex}-${item.token.raw}`"
      >
        <UDropdownMenu
          v-if="item.suggestions?.length"
          :items="buildDropdownItems(item.token, item.suggestions)"
        >
          <UBadge
            color="error"
            variant="subtle"
            class="cursor-pointer"
          >
            {{ item.token.raw }} (not found)
          </UBadge>
        </UDropdownMenu>
        <UBadge
          v-else
          color="error"
          variant="subtle"
        >
          {{ item.token.raw }} (not found)
        </UBadge>
      </template>

      <UBadge
        v-if="referenceLoading"
        color="neutral"
        variant="subtle"
      >
        Resolving references…
      </UBadge>
    </div>

    <div
      v-if="props.contextLabel || props.hint || $slots.context"
      class="flex flex-wrap items-center justify-between text-xs text-muted-500 mt-1"
    >
      <div
        v-if="props.contextLabel"
        class="flex items-center gap-1"
      >
        <span class="uppercase tracking-wide">
          {{ props.contextLabel }}:
        </span>
        <span class="font-medium text-muted-700 dark:text-muted-200">
          {{ props.contextValue || 'None' }}
        </span>
      </div>
      <slot
        v-else
        name="context"
      />
      <p
        v-if="props.hint"
        class="ml-auto"
      >
        {{ props.hint }}
      </p>
    </div>
  </div>
</template>
