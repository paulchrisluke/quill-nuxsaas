<script setup lang="ts">
import type { FileTreeNode } from './WorkspaceFileTreeNode.vue'
import { NON_ORG_SLUG } from '~~/shared/constants/routing'
import { useContentList } from '~/composables/useContentList'
import { useFileList } from '~/composables/useFileList'
import WorkspaceFileTreeNode from './WorkspaceFileTreeNode.vue'

const emit = defineEmits<{
  (e: 'open', node: FileTreeNode): void
}>()

const { isAuthenticatedUser, useActiveOrganization } = useAuth()
const router = useRouter()
const route = useRoute()
const localePath = useLocalePath()
const activeOrg = useActiveOrganization()
const openWorkspace = inject<(() => void) | undefined>('openWorkspace')

const orgSlug = computed(() => {
  const param = route.params.slug
  const routeSlug = Array.isArray(param) ? param[0] : param
  if (routeSlug && routeSlug !== NON_ORG_SLUG)
    return routeSlug
  const fallback = activeOrg.value?.data?.slug
  return fallback && fallback !== NON_ORG_SLUG ? fallback : null
})

const {
  items: contentItems,
  pending: contentPending,
  error: contentError,
  initialized: contentInitialized,
  loadInitial: loadContentInitial,
  remove: removeContent,
  refresh: refreshContent,
  reset: resetContent
} = useContentList({ pageSize: 100, stateKey: 'workspace-file-tree' })

const {
  items: fileItems,
  pending: filePending,
  error: fileError,
  initialized: fileInitialized,
  loadInitial: loadFileInitial,
  refresh: refreshFileList,
  remove: removeFile,
  reset: resetFileList
} = useFileList({ pageSize: 100, stateKey: 'workspace-file-tree' })

const expandedPaths = ref<Set<string>>(new Set(['files', 'content']))
const toast = useToast()
// Track in-flight archive operations to prevent concurrent invocations
const archivingFiles = ref<Set<string>>(new Set())
const archivingContent = ref<Set<string>>(new Set())

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

const activeFileId = computed(() => {
  const path = route.path
  if (/\/[^/]+\/files\//.test(path)) {
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

const tree = computed<FileTreeNode[]>(() => {
  const entries = [...fileEntries.value, ...contentEntries.value]
  const builtTree = buildTreeFromEntries(entries)

  // Always ensure root folders exist, even if empty
  const rootFolders = ['files', 'content']
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

  // Sort to ensure consistent order: content, files
  builtTree.sort((a, b) => {
    const order = { content: 0, files: 1 }
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

const resolveFilePath = (fileId: string | null | undefined) => {
  const slug = orgSlug.value
  if (!slug || !fileId)
    return null
  return `/${slug}/files/${fileId}`
}

const openNode = (node: FileTreeNode) => {
  emit('open', node)

  if (node.type !== 'file')
    return

  const metadata = node.metadata || {}
  if (metadata.fileId) {
    const path = resolveFilePath(metadata.fileId)
    if (path) {
      router.push(localePath(path))
      if (typeof openWorkspace === 'function') {
        openWorkspace()
      }
    } else if (metadata.url) {
      window.open(metadata.url, '_blank')
    }
  } else if (metadata.contentId) {
    const path = resolveContentPath(metadata.contentId)
    if (path) {
      router.push(localePath(path))
      // Open workspace drawer on mobile
      if (typeof openWorkspace === 'function') {
        openWorkspace()
      }
    }
  }
}

// Strategy: Use optimistic UI updates (removeFile/removeContent) for immediate feedback,
// then handle server errors by re-adding or refreshing on failure. This provides better UX
// than waiting for server refresh, and both archive operations now use the same approach.
const archiveFile = async (node: FileTreeNode) => {
  const fileId = node.metadata?.fileId
  if (!fileId)
    return

  // Prevent concurrent invocations for the same file
  if (archivingFiles.value.has(fileId))
    return

  // Mark as in-flight
  archivingFiles.value.add(fileId)

  // Optimistically remove from UI
  removeFile(fileId)

  try {
    await $fetch(`/api/file/${fileId}/archive`, { method: 'POST' })
    toast.add({
      id: `archive-file-${fileId}`,
      title: 'File archived',
      color: 'success'
    })
  } catch (error) {
    console.error('Failed to archive file', error)
    // On error, refresh to restore correct server state
    await refreshFileList()
    toast.add({
      id: `archive-file-error-${fileId}`,
      title: 'Failed to archive file',
      description: error instanceof Error ? error.message : 'Please try again.',
      color: 'error'
    })
  } finally {
    // Remove from in-flight tracker
    archivingFiles.value.delete(fileId)
  }
}

const archiveContent = async (node: FileTreeNode) => {
  const contentId = node.metadata?.contentId
  if (!contentId)
    return

  // Prevent concurrent invocations for the same content
  if (archivingContent.value.has(contentId))
    return

  // Mark as in-flight
  archivingContent.value.add(contentId)

  // Optimistically remove from UI
  removeContent(contentId)

  try {
    await $fetch(`/api/content/${contentId}/archive`, { method: 'POST' })
    toast.add({
      id: `archive-content-${contentId}`,
      title: 'Content archived',
      color: 'success'
    })
  } catch (error) {
    console.error('Failed to archive content', error)
    // On error, refresh to restore correct server state
    await refreshContent()
    toast.add({
      id: `archive-content-error-${contentId}`,
      title: 'Failed to archive content',
      description: error instanceof Error ? error.message : 'Please try again.',
      color: 'error'
    })
  } finally {
    // Remove from in-flight tracker
    archivingContent.value.delete(contentId)
  }
}

const initializeData = async () => {
  if (!isAuthenticatedUser.value)
    return
  loadContentInitial().catch(() => {})
  loadFileInitial().catch(() => {})
}

onMounted(() => {
  initializeData()
})

watch(isAuthenticatedUser, (isLoggedIn) => {
  if (isLoggedIn) {
    initializeData()
  } else {
    resetContent()
    resetFileList()
  }
})

const isEmptyState = computed(() => {
  return contentInitialized.value && fileInitialized.value && !contentItems.value.length && !fileItems.value.length
})
</script>

<template>
  <div
    class="h-full flex flex-col space-y-3"
    role="tree"
  >
    <div class="flex-1 overflow-y-auto px-1 pb-4">
      <template v-if="!isAuthenticatedUser">
        <div class="space-y-2 px-2">
          <div class="space-y-1">
            <p class="text-xs uppercase tracking-wide text-muted-foreground px-2">
              Content
            </p>
            <UButton
              block
              variant="ghost"
              :to="localePath('/signin')"
              class="justify-start"
            >
              Sign in to view content
            </UButton>
          </div>
          <div class="space-y-1">
            <p class="text-xs uppercase tracking-wide text-muted-foreground px-2">
              Files
            </p>
            <UButton
              block
              variant="ghost"
              :to="localePath('/signin')"
              class="justify-start"
            >
              Sign in to view files
            </UButton>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="contentPending || filePending">
          <div
            v-for="n in 6"
            :key="n"
            class="px-2 py-1.5"
          >
            <USkeleton class="h-4 w-3/4" />
          </div>
        </div>

        <ul
          v-else-if="!isEmptyState"
          class="space-y-0.5"
        >
          <WorkspaceFileTreeNode
            v-for="node in tree"
            :key="node.path"
            :node="node"
            :expanded-paths="expandedPaths"
            :active-content-id="activeContentId"
            :active-file-id="activeFileId"
            :archiving-file-ids="archivingFiles"
            :archiving-content-ids="archivingContent"
            @toggle="toggleFolder"
            @select="openNode"
            @archive-file="archiveFile"
            @archive-content="archiveContent"
          />
        </ul>

        <div
          v-else-if="isEmptyState"
          class="px-3 py-2 text-sm text-muted-foreground truncate whitespace-nowrap"
        >
          No workspace files yet.
        </div>

        <div
          v-if="contentError || fileError"
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
        </div>
      </template>
    </div>
  </div>
</template>
