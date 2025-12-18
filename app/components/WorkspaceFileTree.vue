<script setup lang="ts">
import type * as schema from '~~/server/db/schema'
import type { FileTreeNode } from './WorkspaceFileTreeNode.vue'
import { NON_ORG_SLUG } from '~~/shared/constants/routing'
import { useContentList } from '~/composables/useContentList'
import { useFileList } from '~/composables/useFileList'
import WorkspaceFileTreeNode from './WorkspaceFileTreeNode.vue'

type SourceContentItem = typeof schema.sourceContent.$inferSelect

const emit = defineEmits<{
  (e: 'open', node: FileTreeNode): void
}>()

const { useActiveOrganization } = useAuth()
const router = useRouter()
const route = useRoute()
const localePath = useLocalePath()
const activeOrg = useActiveOrganization()

const orgSlug = computed(() => {
  const slug = activeOrg.value?.data?.slug
  if (!slug || slug === NON_ORG_SLUG)
    return null
  return slug
})

const {
  items: contentItems,
  pending: contentPending,
  error: contentError,
  initialized: contentInitialized,
  loadInitial: loadContentInitial
} = useContentList({ pageSize: 100, stateKey: 'workspace-file-tree' })

const {
  items: fileItems,
  pending: filePending,
  error: fileError,
  initialized: fileInitialized,
  loadInitial: loadFileInitial
} = useFileList({ pageSize: 100, stateKey: 'workspace-file-tree' })

const sourceItems = ref<SourceContentItem[]>([])
const sourcePending = ref(false)
const sourceError = ref<string | null>(null)
const sourceInitialized = ref(false)

const expandedPaths = ref<Set<string>>(new Set(['files', 'content', 'sources']))

const activeContentId = computed(() => {
  const path = route.path
  if (/\/[^/]+\/content\//.test(path)) {
    const id = route.params.id
    if (Array.isArray(id))
      return id[0] || null
    return id || null
  }
  return null
})

const normalizeSegment = (value: string | null | undefined) => {
  if (!value)
    return null
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\.+/g, '')
    || null
}

const buildContentFilename = (label: string, fallback: string) => {
  const slug = normalizeSegment(label) || normalizeSegment(fallback) || fallback
  return `${slug}.mdx`
}

const buildSourceName = (title: string | null, fallback: string) => {
  return normalizeSegment(title) || fallback
}

const buildTreeFromEntries = (entries: { path: string, metadata?: FileTreeNode['metadata'] }[]): FileTreeNode[] => {
  const roots: FileTreeNode[] = []

  for (const entry of entries) {
    const segments = entry.path.split('/').filter(Boolean)
    if (!segments.length)
      continue

    let children = roots
    let currentPath = ''

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const isLeaf = i === segments.length - 1
      const existing = children.find(node => node.name === segment)

      if (isLeaf) {
        const fileNode: FileTreeNode = {
          type: 'file',
          name: segment,
          path: currentPath,
          metadata: entry.metadata
        }
        if (existing) {
          Object.assign(existing, fileNode)
        } else {
          children.push(fileNode)
        }
        continue
      }

      if (existing && existing.type === 'folder') {
        children = existing.children = existing.children || []
        continue
      }

      if (existing) {
        // Existing file node conflicts with folder path - skip this entry
        console.warn(`Path conflict: "${currentPath}" exists as file but needed as folder`)
        break
      }

      const folderNode: FileTreeNode = {
        type: 'folder',
        name: segment,
        path: currentPath,
        children: []
      }
      children.push(folderNode)
      children = folderNode.children!
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type)
        return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((node) => {
      if (node.children?.length)
        sortNodes(node.children)
    })
  }

  sortNodes(roots)
  return roots
}

const contentEntries = computed(() => {
  return contentItems.value.map(content => ({
    path: ['content', buildContentFilename(content.displayLabel, content.id)].join('/'),
    metadata: {
      contentId: content.id,
      displayLabel: content.displayLabel
    }
  }))
})

const fileEntries = computed(() => {
  return fileItems.value.map(file => ({
    path: ['files', file.fileName].join('/'),
    metadata: {
      fileId: file.id,
      fileType: file.fileType,
      mimeType: file.mimeType,
      displayLabel: file.originalName,
      url: file.url,
      contentId: file.contentId || undefined
    }
  }))
})

const sourceEntries = computed(() => {
  return sourceItems.value.map(source => ({
    path: ['sources', normalizeSegment(source.sourceType) || 'other', buildSourceName(source.title, source.id)].join('/'),
    metadata: {
      sourceId: source.id,
      sourceType: source.sourceType || undefined,
      displayLabel: source.title || source.id
    }
  }))
})

const tree = computed<FileTreeNode[]>(() => {
  const entries = [...fileEntries.value, ...contentEntries.value, ...sourceEntries.value]
  const builtTree = buildTreeFromEntries(entries)

  // Always ensure root folders exist, even if empty
  const rootFolders = ['files', 'content', 'sources']
  const existingRootPaths = new Set(builtTree.map(node => node.path))

  for (const folderName of rootFolders) {
    if (!existingRootPaths.has(folderName)) {
      builtTree.push({
        type: 'folder',
        name: folderName,
        path: folderName,
        children: []
      })
    }
  }

  // Sort to ensure consistent order: content, files, sources
  builtTree.sort((a, b) => {
    const order = { content: 0, files: 1, sources: 2 }
    const aOrder = order[a.path as keyof typeof order] ?? 999
    const bOrder = order[b.path as keyof typeof order] ?? 999
    return aOrder - bOrder
  })

  return builtTree
})

const toggleFolder = (path: string) => {
  const next = new Set(expandedPaths.value)
  if (next.has(path))
    next.delete(path)
  else
    next.add(path)
  expandedPaths.value = next
}

const resolveContentPath = (contentId: string | null | undefined) => {
  const slug = orgSlug.value
  if (!slug)
    return null
  return `/${slug}/content/${contentId}`
}

const resolveSourcePath = (sourceId: string | null | undefined) => {
  const slug = orgSlug.value
  if (!slug)
    return null
  // Navigate to source content route (can be created later if needed)
  // For now, we'll use a query parameter approach or emit event
  return `/${slug}/sources/${sourceId}`
}

const openNode = (node: FileTreeNode) => {
  emit('open', node)

  if (node.type !== 'file')
    return

  const metadata = node.metadata || {}
  if (metadata.fileId && metadata.url) {
    // For files, open the URL in a new tab
    window.open(metadata.url, '_blank')
  } else if (metadata.contentId) {
    const path = resolveContentPath(metadata.contentId)
    if (path)
      router.push(localePath(path))
  } else if (metadata.sourceId) {
    // For sources, we can navigate to a route or show in a modal
    // For now, navigate to a route pattern that could be created
    const path = resolveSourcePath(metadata.sourceId)
    if (path) {
      // Try to navigate, but if route doesn't exist, emit event for parent to handle
      router.push(localePath(path)).catch(() => {
        // Route doesn't exist yet - parent already received 'open' event above
        // to handle source display in embedding scenarios
      })
    }
  }
}

const fetchSources = async () => {
  sourcePending.value = true
  sourceError.value = null
  try {
    const response = await $fetch<{ data: SourceContentItem[] }>('/api/source-content', {
      query: {
        limit: 100
      }
    })
    sourceItems.value = response?.data || []
    sourceInitialized.value = true
  } catch (error) {
    console.error('Failed to fetch sources', error)
    sourceError.value = error instanceof Error ? error.message : 'Failed to load sources'
    sourceInitialized.value = true
  } finally {
    sourcePending.value = false
  }
}

onMounted(() => {
  loadContentInitial().catch(() => {})
  loadFileInitial().catch(() => {})
  fetchSources()
})

const isEmptyState = computed(() => {
  return contentInitialized.value && fileInitialized.value && sourceInitialized.value && !contentItems.value.length && !fileItems.value.length && !sourceItems.value.length
})

// Debug: log file count for troubleshooting
watch([fileItems, fileInitialized], () => {
  if (fileInitialized.value) {
    console.log('[WorkspaceFileTree] Files loaded:', fileItems.value.length, fileItems.value)
  }
}, { immediate: true })
</script>

<template>
  <div
    class="h-full flex flex-col space-y-3"
    role="tree"
  >
    <div class="flex-1 overflow-y-auto px-1 pb-4">
      <div v-if="contentPending || filePending || sourcePending">
        <div
          v-for="n in 6"
          :key="n"
          class="px-2 py-1.5"
        >
          <USkeleton class="h-4 w-3/4" />
        </div>
      </div>

      <ul
        v-else-if="tree.length"
        class="space-y-0.5"
      >
        <WorkspaceFileTreeNode
          v-for="node in tree"
          :key="node.path"
          :node="node"
          :expanded-paths="expandedPaths"
          :active-content-id="activeContentId"
          @toggle="toggleFolder"
          @select="openNode"
        />
      </ul>

      <div
        v-else-if="isEmptyState"
        class="px-3 py-2 text-sm text-muted-foreground"
      >
        No workspace files yet.
      </div>

      <div
        v-if="contentError || fileError || sourceError"
        class="px-3 space-y-2"
      >
        <UAlert
          v-if="contentError"
          color="error"
          variant="soft"
          :title="contentError"
        />
        <UAlert
          v-if="fileError"
          color="error"
          variant="soft"
          :title="fileError"
        />
        <UAlert
          v-if="sourceError"
          color="error"
          variant="soft"
          :title="sourceError"
        />
      </div>
    </div>
  </div>
</template>
