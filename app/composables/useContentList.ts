import { computed } from 'vue'

export interface ContentListItem {
  id: string
  displayLabel: string
  updatedAgo: string
}

interface FetchResponse {
  contents: ContentListItem[]
  nextCursor: string | null
  hasMore: boolean
  limit: number
}

const DEFAULT_PAGE_SIZE = 30
const STATE_VERSION = 'v2'

export function useContentList(options?: { pageSize?: number, stateKey?: string, includeArchived?: boolean }) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  const includeArchived = options?.includeArchived ?? false

  // Use versioned key for default state to handle breaking changes
  const baseKey = options?.stateKey ?? `${STATE_VERSION}:default:${pageSize}:${includeArchived ? 'archived' : 'active'}`
  const resolveKey = (segment: string) => `content-list:${baseKey}:${segment}`

  // Initialize new state
  const itemsState = useState<ContentListItem[]>(resolveKey('items'), () => [])
  const cursorState = useState<string | null>(resolveKey('cursor'), () => null)
  const hasMoreState = useState<boolean>(resolveKey('has-more'), () => true)
  const pendingState = useState<boolean>(resolveKey('pending'), () => false)
  const errorState = useState<string | null>(resolveKey('error'), () => null)
  const initializedState = useState<boolean>(resolveKey('initialized'), () => false)

  // Migration: Check for old key format and migrate data if present
  // Old format: `default:${pageSize}` (without version or active/archived suffix)
  // Always call useState for old keys to ensure identical hook call order between server and client
  // (prevents SSR hydration mismatches), but only migrate when condition is met
  const oldBaseKey = `default:${pageSize}`
  const oldResolveKey = (segment: string) => `content-list:${oldBaseKey}:${segment}`

  // Always initialize old state (unconditional for SSR consistency)
  const oldItemsState = useState<ContentListItem[]>(oldResolveKey('items'), () => [])
  const oldCursorState = useState<string | null>(oldResolveKey('cursor'), () => null)
  const oldHasMoreState = useState<boolean>(oldResolveKey('has-more'), () => true)
  const oldInitializedState = useState<boolean>(oldResolveKey('initialized'), () => false)

  // Only migrate to the 'active' state (includeArchived: false) since old data didn't include archived content
  // Only migrate when using default key (not custom stateKey) and new state is empty
  if (!options?.stateKey && !includeArchived && !initializedState.value && itemsState.value.length === 0) {
    // Migrate if old state has data
    if (oldItemsState.value.length > 0 || oldInitializedState.value) {
      itemsState.value = [...oldItemsState.value]
      cursorState.value = oldCursorState.value
      hasMoreState.value = oldHasMoreState.value
      initializedState.value = oldInitializedState.value

      // Clear old state after migration
      oldItemsState.value = []
      oldCursorState.value = null
      oldHasMoreState.value = true
      oldInitializedState.value = false
    }
  }

  const mergeItems = (incoming: ContentListItem[], replace = false) => {
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
      const response = await $fetch<FetchResponse>('/api/content', {
        query: {
          limit: pageSize,
          cursor: opts?.cursor ?? undefined,
          includeArchived: includeArchived || undefined
        }
      })

      const records = response?.contents ?? []
      mergeItems(records, Boolean(opts?.replace || !opts?.cursor))
      cursorState.value = response?.nextCursor ?? null
      hasMoreState.value = Boolean(response?.hasMore && response.nextCursor)
      initializedState.value = true
    } catch (error) {
      console.error('[content-list] failed to fetch', error)
      errorState.value = error instanceof Error ? error.message : 'Failed to load content'
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

  const upsert = (entry: ContentListItem) => {
    const normalized: ContentListItem = {
      id: entry.id,
      displayLabel: entry.displayLabel || 'Untitled content',
      updatedAgo: entry.updatedAgo || 'Just now'
    }
    const next = itemsState.value.filter(item => item.id !== normalized.id)
    itemsState.value = [normalized, ...next]
  }

  const remove = (contentId: string) => {
    itemsState.value = itemsState.value.filter(item => item.id !== contentId)
  }

  const reset = () => {
    itemsState.value = []
    cursorState.value = null
    hasMoreState.value = true
    pendingState.value = false
    errorState.value = null
    initializedState.value = false
  }

  const hasContent = (contentId: string | null | undefined) => {
    if (!contentId)
      return false
    return itemsState.value.some(item => item.id === contentId)
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
    hasContent
  }
}
