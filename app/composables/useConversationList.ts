import { computed } from 'vue'

export interface ConversationListItem {
  id: string
  displayLabel: string
  updatedAgo: string
  additions?: number
  deletions?: number
}

interface FetchResponse {
  conversations: ConversationListItem[]
  nextCursor: string | null
  hasMore: boolean
  limit: number
}

const DEFAULT_PAGE_SIZE = 30

export function useConversationList(options?: { pageSize?: number, stateKey?: string }) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  const baseKey = options?.stateKey ?? `default:${pageSize}`
  const resolveKey = (segment: string) => `conversation-list:${baseKey}:${segment}`

  const itemsState = useState<ConversationListItem[]>(resolveKey('items'), () => [])
  const cursorState = useState<string | null>(resolveKey('cursor'), () => null)
  const hasMoreState = useState<boolean>(resolveKey('has-more'), () => true)
  const pendingState = useState<boolean>(resolveKey('pending'), () => false)
  const errorState = useState<string | null>(resolveKey('error'), () => null)
  const initializedState = useState<boolean>(resolveKey('initialized'), () => false)

  const mergeItems = (incoming: ConversationListItem[], replace = false) => {
    if (replace) {
      itemsState.value = [...incoming]
      return
    }
    // Use Set for O(1) lookup of incoming IDs
    const incomingIds = new Set(incoming.map(item => item.id))
    // Filter out existing items that are in incoming (they'll be replaced)
    const existingItems = itemsState.value.filter(item => !incomingIds.has(item.id))
    // Append all incoming items at the end (preserves order: existing items stay, new/updated items appended)
    itemsState.value = [...existingItems, ...incoming]
  }

  const fetchPage = async (opts?: { cursor?: string | null, replace?: boolean }) => {
    if (pendingState.value)
      return

    pendingState.value = true
    errorState.value = null
    try {
      const response = await $fetch<FetchResponse>('/api/conversations', {
        query: {
          limit: pageSize,
          cursor: opts?.cursor ?? undefined
        }
      })

      const records = response?.conversations ?? []
      mergeItems(records, Boolean(opts?.replace || !opts?.cursor))
      cursorState.value = response?.nextCursor ?? null
      hasMoreState.value = Boolean(response?.hasMore && response.nextCursor)
      initializedState.value = true
    } catch (error) {
      console.error('[conversation-list] failed to fetch', error)
      errorState.value = error instanceof Error ? error.message : 'Failed to load conversations'
      throw error
    } finally {
      pendingState.value = false
    }
  }

  const loadInitial = async () => {
    if (initializedState.value)
      return
    await fetchPage({ replace: true })
  }

  const refresh = async () => {
    await fetchPage({ replace: true })
  }

  const loadMore = async () => {
    if (!hasMoreState.value || !cursorState.value)
      return
    await fetchPage({ cursor: cursorState.value })
  }

  const upsert = (entry: ConversationListItem) => {
    const normalized: ConversationListItem = {
      id: entry.id,
      displayLabel: entry.displayLabel || 'Untitled conversation',
      updatedAgo: entry.updatedAgo || 'Just now',
      additions: typeof entry.additions === 'number' ? entry.additions : undefined,
      deletions: typeof entry.deletions === 'number' ? entry.deletions : undefined
    }
    const next = itemsState.value.filter(item => item.id !== normalized.id)
    itemsState.value = [normalized, ...next]
  }

  const remove = (conversationId: string) => {
    itemsState.value = itemsState.value.filter(item => item.id !== conversationId)
  }

  const reset = () => {
    itemsState.value = []
    cursorState.value = null
    hasMoreState.value = true
    pendingState.value = false
    errorState.value = null
    initializedState.value = false
  }

  const hasConversation = (conversationId: string | null | undefined) => {
    if (!conversationId)
      return false
    return itemsState.value.some(item => item.id === conversationId)
  }

  return {
    items: computed(() => itemsState.value),
    pending: computed(() => pendingState.value),
    error: computed(() => errorState.value),
    hasMore: computed(() => hasMoreState.value && Boolean(cursorState.value)),
    initialized: computed(() => initializedState.value),
    loadInitial,
    refresh,
    loadMore,
    upsert,
    remove,
    reset,
    hasConversation
  }
}
