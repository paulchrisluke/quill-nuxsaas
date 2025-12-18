<script setup lang="ts">
export interface FileTreeNode {
  type: 'folder' | 'file'
  name: string
  path: string
  children?: FileTreeNode[]
  metadata?: {
    contentId?: string
    sourceId?: string
    sourceType?: string
    displayLabel?: string
  }
}

defineOptions({
  name: 'WorkspaceFileTreeNode'
})

const props = defineProps<{
  node: FileTreeNode
  depth?: number
  expandedPaths: Set<string>
  collapsed?: boolean
  activeContentId?: string | null
  activeSourceId?: string | null
}>()

const emit = defineEmits<{
  (e: 'toggle', path: string): void
  (e: 'select', node: FileTreeNode): void
}>()

const depth = computed(() => props.depth ?? 0)

const isFolder = computed(() => props.node.type === 'folder')
const isExpanded = computed(() => isFolder.value && props.expandedPaths.has(props.node.path))

const isActive = computed(() => {
  if (props.node.type !== 'file')
    return false
  const meta = props.node.metadata || {}
  if (meta.contentId && props.activeContentId && meta.contentId === props.activeContentId)
    return true
  if (meta.sourceId && props.activeSourceId && meta.sourceId === props.activeSourceId)
    return true
  return false
})

const iconName = computed(() => {
  if (isFolder.value)
    return isExpanded.value ? 'i-lucide-folder-open' : 'i-lucide-folder'

  const sourceType = props.node.metadata?.sourceType
  if (sourceType === 'youtube')
    return 'i-lucide-youtube'
  if (sourceType === 'context')
    return 'i-lucide-notebook'

  return 'i-lucide-file-text'
})

const paddingStyle = computed(() => ({
  paddingLeft: `${Math.max(depth.value - 0.25, 0) * 0.875}rem`
}))

const label = computed(() => props.node.name || props.node.metadata?.displayLabel || '')

const toggleFolder = () => {
  if (!isFolder.value)
    return
  emit('toggle', props.node.path)
}

const selectNode = () => {
  if (isFolder.value) {
    toggleFolder()
    return
  }
  emit('select', props.node)
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    selectNode()
  }
}
</script>

<template>
  <li>
    <div
      class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer"
      :class="[
        isActive ? 'bg-primary-50 text-primary-900 dark:bg-primary-900/20 dark:text-primary-100' : 'hover:bg-neutral-100/70 dark:hover:bg-neutral-800/70'
      ]"
      :style="paddingStyle"
      tabindex="0"
      role="treeitem"
      :aria-expanded="isFolder ? isExpanded : undefined"
      @click="selectNode"
      @keydown="handleKeydown"
    >
      <button
        v-if="isFolder"
        type="button"
        class="flex items-center justify-center flex-shrink-0"
        aria-label="Toggle folder"
        @click.stop="toggleFolder"
      >
        <UIcon
          :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="h-4 w-4 text-muted-500 flex-shrink-0"
        />
      </button>
      <span
        v-else
        class="w-4 flex-shrink-0"
      />

      <UIcon
        :name="iconName"
        class="h-4 w-4 text-muted-500 flex-shrink-0"
      />
      <span class="truncate">{{ label }}</span>
    </div>

    <ul
      v-if="isFolder && isExpanded && node.children?.length"
      role="group"
      class="space-y-0.5"
    >
      <WorkspaceFileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :expanded-paths="expandedPaths"
        :active-content-id="activeContentId"
        :active-source-id="activeSourceId"
        @toggle="emit('toggle', $event)"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>
