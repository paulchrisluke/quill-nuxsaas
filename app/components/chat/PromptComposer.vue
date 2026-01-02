<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useContentList } from '~/composables/useContentList'
import { useFileList } from '~/composables/useFileList'
import { normalizeContentId } from '~/utils/contentIdentifier'
import ReferencePickerPanel from './ReferencePickerPanel.vue'

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
  submit: [value: string, selections?: ReferenceSelection[]]
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

interface ReferenceSuggestionGroups {
  files: ReferenceSuggestionItem[]
  contents: ReferenceSuggestionItem[]
  sections: ReferenceSuggestionItem[]
}

interface ReferenceSelection {
  type: 'file' | 'content' | 'section' | 'source'
  id: string
  label?: string
  identifier?: string
}

const modelValue = defineModel<string>({ default: '' })
const composerRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const cursorIndex = ref(0)
const activeMention = ref<{ startIndex: number, query: string } | null>(null)
const highlightedIndex = ref(0)
const isAutocompleteOpen = ref(false)
const isComposing = ref(false)
const panelPosition = ref({ bottom: 0, left: 0, right: 0 })
const referenceResolution = ref<ReferenceResolutionResponse | null>(null)
const referenceLoading = ref(false)
const lastResolvedMessage = ref('')
const selectedReferences = ref<ReferenceSelection[]>([])
const suggestionGroups = ref<ReferenceSuggestionGroups>({
  files: [],
  contents: [],
  sections: [] // Sections not shown in picker, only used for LLM context
})

const { useActiveOrganization } = useAuth()
const activeOrganization = useActiveOrganization()
const organizationId = computed(() => activeOrganization.value?.data?.id || null)

const {
  items: sidebarContentItems,
  initialized: sidebarContentInitialized
} = useContentList({ pageSize: 40 })

const {
  items: treeContentItems,
  initialized: treeContentInitialized
} = useContentList({ pageSize: 100, stateKey: 'workspace-file-tree' })

const {
  items: treeFileItems,
  initialized: treeFileInitialized
} = useFileList({ pageSize: 100, stateKey: 'workspace-file-tree' })

const combinedSuggestions = computed(() => {
  if (!activeMention.value) {
    return { files: [], contents: [], sections: [] }
  }
  // API handles all filtering - just return what the API returned
  return {
    files: suggestionGroups.value.files,
    contents: suggestionGroups.value.contents,
    sections: [] // Sections not shown in picker, only used for LLM context
  }
})

const isBoundaryChar = (value: string | undefined) => {
  if (!value) {
    return true
  }
  return /\s/.test(value) || /[.,!?;:()[\]{}<>"']/.test(value)
}

const referenceTokenSanitizer = /[^\p{L}\p{N}._\u002f-]+/gu

const normalizeReferenceToken = (value: string | null | undefined): string => {
  const trimmed = (value ?? '').trim()
  if (!trimmed) {
    return ''
  }
  return trimmed
    .replace(/\s+/g, '-')
    .replace(referenceTokenSanitizer, '')
    .replace(/-+/g, '-')
}

const mergeLocalContentItems = () => {
  const seen = new Set<string>()
  const merged: Array<{ id: string, displayLabel: string }> = []

  for (const item of sidebarContentItems.value) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      merged.push({ id: item.id, displayLabel: item.displayLabel })
    }
  }

  for (const item of treeContentItems.value) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      merged.push({ id: item.id, displayLabel: item.displayLabel })
    }
  }

  return merged
}

const matchesQuery = (query: string, values: Array<string | null | undefined>) => {
  if (!query) {
    return true
  }
  const normalizedQuery = query.toLowerCase()
  return values.some((value) => {
    if (!value) {
      return false
    }
    const raw = value.toLowerCase()
    if (raw.includes(normalizedQuery)) {
      return true
    }
    const tokenized = normalizeReferenceToken(value).toLowerCase()
    return tokenized.includes(normalizedQuery)
  })
}

const buildLocalSuggestions = (query: string) => {
  const trimmed = query.trim().toLowerCase()
  const localContents = mergeLocalContentItems()
    .filter(item => matchesQuery(trimmed, [item.displayLabel, item.id]))
    .slice(0, 10)
    .map(item => ({
      id: item.id,
      label: item.displayLabel,
      insertText: normalizeReferenceToken(item.displayLabel) || item.id,
      type: 'content' as const
    }))

  const localFiles = treeFileItems.value
    .filter(file => matchesQuery(trimmed, [file.originalName, file.fileName, file.id]))
    .slice(0, 10)
    .map(file => ({
      id: file.id,
      label: file.originalName || file.fileName || file.id,
      subtitle: file.fileName && file.originalName && file.fileName !== file.originalName ? file.fileName : undefined,
      insertText: normalizeReferenceToken(file.originalName || file.fileName || file.id) || file.id,
      type: 'file' as const
    }))

  return {
    files: localFiles,
    contents: localContents,
    sections: []
  }
}

const updatePanelPosition = () => {
  if (composerRef.value) {
    const rect = composerRef.value.getBoundingClientRect()
    panelPosition.value = {
      bottom: window.innerHeight - rect.top + 16, // 16px = mb-4
      left: rect.left,
      right: window.innerWidth - rect.right
    }
  }
}

const closeAutocomplete = () => {
  isAutocompleteOpen.value = false
  activeMention.value = null
  nextTick(() => {
    textareaRef.value?.focus()
  })
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
  if (/\s/.test(query)) {
    activeMention.value = null
    isAutocompleteOpen.value = false
    return
  }
  const firstChar = query[0]
  if (query && firstChar && !/[a-z0-9]/i.test(firstChar)) {
    activeMention.value = null
    isAutocompleteOpen.value = false
    return
  }

  activeMention.value = { startIndex: atIndex, query }
  highlightedIndex.value = 0
  isAutocompleteOpen.value = true

  // Calculate panel position for fixed positioning
  nextTick(() => {
    updatePanelPosition()
  })
}

const applySuggestion = (item: ReferenceSuggestionItem) => {
  const mention = activeMention.value
  if (!mention) {
    return
  }

  const insertText = item.insertText.startsWith('@') ? item.insertText : `@${item.insertText}`
  const mentionEnd = mention.startIndex + 1 + mention.query.length
  const value = modelValue.value
  const before = value.slice(0, mention.startIndex)
  const after = value.slice(mentionEnd)
  const nextValue = `${before}${insertText}${after}`

  modelValue.value = nextValue
  isAutocompleteOpen.value = false
  activeMention.value = null

  nextTick(() => {
    if (textareaRef.value) {
      const position = before.length + insertText.length
      textareaRef.value.setSelectionRange(position, position)
      textareaRef.value.focus()
      cursorIndex.value = position
    }
  })

  const selectionKey = `${item.type}:${item.id}`
  const exists = selectedReferences.value.some(selection => `${selection.type}:${selection.id}` === selectionKey)
  if (!exists) {
    selectedReferences.value = [
      ...selectedReferences.value,
      {
        type: item.type,
        id: item.id,
        label: item.label,
        identifier: item.insertText
      }
    ]
  }
}

const handleQueryChange = (value: string) => {
  const mention = activeMention.value
  if (!mention) {
    return
  }
  const nextQuery = value.replace(/\s+/g, '')
  const mentionEnd = mention.startIndex + 1 + mention.query.length
  const currentValue = modelValue.value
  const before = currentValue.slice(0, mention.startIndex + 1)
  const after = currentValue.slice(mentionEnd)

  modelValue.value = `${before}${nextQuery}${after}`
  activeMention.value = { startIndex: mention.startIndex, query: nextQuery }
  highlightedIndex.value = 0
  cursorIndex.value = mention.startIndex + 1 + nextQuery.length
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (isComposing.value) {
    return
  }
  if (isAutocompleteOpen.value && event.key === 'Escape') {
    event.preventDefault()
    closeAutocomplete()
    return
  }
  const flatSuggestions = [
    ...combinedSuggestions.value.files,
    ...combinedSuggestions.value.contents
  ]
  if (!isAutocompleteOpen.value || flatSuggestions.length === 0) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    highlightedIndex.value = (highlightedIndex.value + 1) % flatSuggestions.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    highlightedIndex.value = (highlightedIndex.value - 1 + flatSuggestions.length) % flatSuggestions.length
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    const item = flatSuggestions[highlightedIndex.value]
    if (item) {
      applySuggestion(item)
    }
  }
}

const updateCursor = () => {
  if (!textareaRef.value) {
    return
  }
  cursorIndex.value = textareaRef.value.selectionStart || 0
  if (isComposing.value) {
    return
  }
  updateActiveMention()
}

const handleCompositionStart = () => {
  isComposing.value = true
}

const handleCompositionEnd = () => {
  isComposing.value = false
  updateCursor()
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
      textareaRef.value.removeEventListener('compositionstart', handleCompositionStart)
      textareaRef.value.removeEventListener('compositionend', handleCompositionEnd)
    }
    textareaRef.value = node
    textareaRef.value.addEventListener('keydown', handleKeyDown)
    textareaRef.value.addEventListener('input', updateCursor)
    textareaRef.value.addEventListener('click', updateCursor)
    textareaRef.value.addEventListener('keyup', updateCursor)
    textareaRef.value.addEventListener('compositionstart', handleCompositionStart)
    textareaRef.value.addEventListener('compositionend', handleCompositionEnd)
  }
}

const fetchSuggestions = async (query?: string) => {
  const queryValue = query ?? ''
  const localSuggestions = buildLocalSuggestions(queryValue)
  const hasLocalResults = localSuggestions.files.length > 0 || localSuggestions.contents.length > 0
  const localReady = sidebarContentInitialized.value || treeContentInitialized.value || treeFileInitialized.value

  if (hasLocalResults) {
    suggestionGroups.value = localSuggestions
    return
  }

  if (localReady && !queryValue) {
    suggestionGroups.value = localSuggestions
    return
  }

  if (!organizationId.value) {
    suggestionGroups.value = localSuggestions
    return
  }

  try {
    const data = await $fetch('/api/chat/reference-suggestions', {
      query: {
        contentId: normalizeContentId(props.contentId) || undefined,
        contentIdentifier: props.contentId || undefined,
        q: queryValue || undefined
      }
    }) as {
      files: Array<{ id: string, label: string, subtitle?: string, insertText: string }>
      contents: Array<{ id: string, label: string, subtitle?: string, insertText: string }>
      sections: Array<{ id: string, label: string, subtitle?: string, insertText: string }>
    }

    suggestionGroups.value = {
      files: data.files.map(item => ({ ...item, type: 'file' as const })),
      contents: data.contents.map(item => ({ ...item, type: 'content' as const })),
      sections: [] // Sections not shown in picker, only used for LLM context
    }
  } catch (error) {
    console.error('[PromptComposer] Failed to load reference suggestions', error)
    suggestionGroups.value = { files: [], contents: [], sections: [] }
  }
}

const resolveTimeout = ref<ReturnType<typeof setTimeout> | null>(null)
const suggestionTimeout = ref<ReturnType<typeof setTimeout> | null>(null)

const scheduleReferenceResolution = (value: string) => {
  if (resolveTimeout.value) {
    clearTimeout(resolveTimeout.value)
  }

  if (!value || !value.includes('@') || !organizationId.value) {
    referenceResolution.value = null
    referenceLoading.value = false
    return
  }

  resolveTimeout.value = setTimeout(async () => {
    referenceLoading.value = true
    try {
      const response = await $fetch('/api/chat/resolve-references', {
        method: 'POST',
        body: {
          message: value,
          organizationId: organizationId.value,
          currentContentId: normalizeContentId(props.contentId),
          currentContentIdentifier: props.contentId || null,
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

const _replaceToken = (token: ReferenceToken, reference: string) => {
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
    console.warn('[PromptComposer] Token not found in current value, skipping replacement', token.raw)
    return
  }
  const before = currentValue.slice(0, rawIndex)
  const after = currentValue.slice(rawIndex + token.raw.length)
  modelValue.value = `${before}${replacement}${after}`
}

const handleSubmit = (value?: string | unknown) => {
  const input = typeof value === 'string' ? value : modelValue.value
  const trimmed = String(input || '').trim()
  if (trimmed) {
    const normalized = trimmed.toLowerCase()
    const resolvedTokens = referenceResolution.value && lastResolvedMessage.value.trim() === trimmed
      ? new Set(referenceResolution.value.tokens.map(token => token.identifier.toLowerCase()))
      : null
    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const isTokenMatch = (candidate: string) => {
      const stripped = candidate.startsWith('@') ? candidate.slice(1) : candidate
      const escaped = escapeRegex(stripped.toLowerCase())
      const pattern = new RegExp(`@${escaped}(?=\\s|$|[.,!?;:()\\[\\]{}<>"'])`, 'i')
      return pattern.test(normalized)
    }
    const selections = selectedReferences.value.filter((selection) => {
      const identifier = selection.identifier?.trim()
      if (identifier) {
        if (resolvedTokens && resolvedTokens.has(identifier.toLowerCase())) {
          return true
        }
        if (isTokenMatch(identifier)) {
          return true
        }
      }
      const label = selection.label?.trim()
      if (label) {
        if (resolvedTokens && resolvedTokens.has(label.toLowerCase())) {
          return true
        }
        if (isTokenMatch(label)) {
          return true
        }
      }
      return false
    })
    emit('submit', trimmed, selections.length ? selections : undefined)
    selectedReferences.value = []
  }
}

const handleStop = () => {
  emit('stop')
}

onMounted(() => {
  nextTick(setTextareaRef)
  window.addEventListener('resize', updatePanelPosition)
  window.addEventListener('scroll', updatePanelPosition, true)
})

onBeforeUnmount(() => {
  if (resolveTimeout.value) {
    clearTimeout(resolveTimeout.value)
    resolveTimeout.value = null
  }
  if (suggestionTimeout.value) {
    clearTimeout(suggestionTimeout.value)
    suggestionTimeout.value = null
  }
  // Reset to safe defaults to avoid callbacks running against unmounted component
  referenceLoading.value = false
  referenceResolution.value = null
  window.removeEventListener('resize', updatePanelPosition)
  window.removeEventListener('scroll', updatePanelPosition, true)
  if (textareaRef.value) {
    textareaRef.value.removeEventListener('keydown', handleKeyDown)
    textareaRef.value.removeEventListener('input', updateCursor)
    textareaRef.value.removeEventListener('click', updateCursor)
    textareaRef.value.removeEventListener('keyup', updateCursor)
    textareaRef.value.removeEventListener('compositionstart', handleCompositionStart)
    textareaRef.value.removeEventListener('compositionend', handleCompositionEnd)
  }
})

watch(composerRef, () => {
  nextTick(setTextareaRef)
})

watch(modelValue, (value) => {
  scheduleReferenceResolution(value)
  if (!value.trim()) {
    selectedReferences.value = []
  }
})

const scheduleSuggestionFetch = (query?: string) => {
  if (suggestionTimeout.value) {
    clearTimeout(suggestionTimeout.value)
  }
  suggestionTimeout.value = setTimeout(() => {
    void fetchSuggestions(query)
  }, 160)
}

watch([organizationId, () => props.contentId], () => {
  if (isAutocompleteOpen.value && activeMention.value) {
    refreshSuggestions(activeMention.value.query)
  } else {
    suggestionGroups.value = { files: [], contents: [], sections: [] }
  }
}, { immediate: true })

function refreshSuggestions(query?: string) {
  if (!isAutocompleteOpen.value) {
    return
  }
  scheduleSuggestionFetch(query ?? '')
  updatePanelPosition()
}

watch(() => activeMention.value?.query, (query) => {
  refreshSuggestions(query)
})

watch(combinedSuggestions, (value) => {
  const flat = [...value.files, ...value.contents]
  if (highlightedIndex.value >= flat.length) {
    highlightedIndex.value = 0
  }
})

watch([
  () => sidebarContentItems.value.length,
  () => treeContentItems.value.length,
  () => treeFileItems.value.length
], () => {
  if (isAutocompleteOpen.value && activeMention.value) {
    refreshSuggestions(activeMention.value.query)
  }
})

const handleNavigate = (delta: number) => {
  const flat = [
    ...combinedSuggestions.value.files,
    ...combinedSuggestions.value.contents,
    ...combinedSuggestions.value.sections
  ]
  if (!flat.length) {
    return
  }
  highlightedIndex.value = (highlightedIndex.value + delta + flat.length) % flat.length
}
</script>

<template>
  <div
    ref="composerRef"
    class="space-y-3 relative"
  >
    <div class="relative">
      <ReferencePickerPanel
        v-if="isAutocompleteOpen"
        :open="isAutocompleteOpen"
        :query="activeMention?.query || ''"
        :groups="combinedSuggestions"
        :active-index="highlightedIndex"
        :style="{
          position: 'fixed',
          bottom: `${panelPosition.bottom}px`,
          left: `${panelPosition.left}px`,
          right: `${panelPosition.right}px`,
          zIndex: 50
        }"
        class="pointer-events-auto"
        @select="applySuggestion"
        @close="closeAutocomplete"
        @navigate="handleNavigate"
        @query-change="handleQueryChange"
      />
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
      </div>
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
