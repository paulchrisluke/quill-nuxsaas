import { useLocalStorage } from '@vueuse/core'
import { readonly } from 'vue'

export const useSidebarCollapse = () => {
  // Persist sidebar collapse state using useLocalStorage
  // Initialize with default value to prevent SSR hydration mismatch
  // Value will be synced from localStorage on client mount
  const isCollapsed = useLocalStorage('sidebar-collapsed', false, {
    // Only read from localStorage after component mounts (client-side only)
    // This prevents hydration mismatch between server (default) and client (localStorage value)
    initOnMounted: true
  })

  const toggle = () => {
    isCollapsed.value = !isCollapsed.value
  }

  return {
    isCollapsed: readonly(isCollapsed),
    toggle
  }
}
