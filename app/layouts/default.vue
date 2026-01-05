<script lang="ts" setup>
import { KNOWN_LOCALES, NON_ORG_SLUG } from '~~/shared/constants/routing'
import { stripLocalePrefix } from '~~/shared/utils/routeMatching'
import AuthModal from '~/components/AuthModal.vue'
import QuillioWidget from '~/components/chat/QuillioWidget.vue'
import OnboardingModal from '~/components/OnboardingModal.vue'

const { t } = useI18n()
const localePath = useLocalePath()
const { signOut, useActiveOrganization, isAuthenticatedUser } = useAuth()
const conversation = useConversation()
const activeOrg = useActiveOrganization()

const i18nHead = useLocaleHead()
const route = useRoute()

const authModalOpen = ref(false)
const authModalMode = ref<'signin' | 'signup'>('signin')

useHead(() => ({
  htmlAttrs: i18nHead.value.htmlAttrs,
  link: [...(i18nHead.value.link || [])]
}))

const pathWithoutLocale = computed(() => stripLocalePrefix(route.path, KNOWN_LOCALES))

// Simple page title - based on route only
const pageTitle = computed(() => {
  const path = pathWithoutLocale.value
  if (path.match(/^\/[^/]+\/conversations/)) {
    return 'Conversations'
  }
  return null
})

const authRoutePrefixes = ['/signin', '/signup', '/forgot-password', '/reset-password']

const isAuthPage = computed(() => {
  const path = pathWithoutLocale.value
  return authRoutePrefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
})

const isPublicPage = computed(() => route.meta?.auth === false)

// Sidebar drawer open state (for mobile hamburger menu)
const isSidebarOpen = ref(false)

// Workspace drawer open state (for mobile workspace view)
const isWorkspaceOpen = ref(false)

// Provide function to open workspace drawer on mobile
provide('openWorkspace', () => {
  if (import.meta.client && window.innerWidth < 1024) {
    isWorkspaceOpen.value = true
  }
})

// Check if current route is a workspace route (content, conversations, etc.)
const isWorkspaceRoute = computed(() => {
  if (!isAuthenticatedUser.value || isAuthPage.value || isPublicPage.value)
    return false
  const path = pathWithoutLocale.value
  // Workspace routes: /[slug]/content, /[slug]/conversations, /[slug]/integrations, etc.
  return /^\/[^/]+(?:\/(?:content|conversations|integrations)(?:\/|$)|$)/.test(path)
})

// Open workspace drawer on mobile when navigating to workspace routes
// But not on conversations empty state (redundant on mobile)
watch(() => route.path, (_newPath) => {
  if (!import.meta.client || window.innerWidth >= 1024)
    return
  const path = pathWithoutLocale.value
  // Don't open drawer on conversations empty state (exactly /[slug]/conversations)
  if (/^\/[^/]+\/conversations$/.test(path)) {
    isWorkspaceOpen.value = false
  } else if (isWorkspaceRoute.value) {
    isWorkspaceOpen.value = true
  }
}, { immediate: true })

// Sidebar is never collapsed (only hidden on auth pages via v-if)
// The collapse prop is for mobile drawer behavior, not visibility control
const isSidebarCollapsed = computed(() => false)

// Chat panel shows when logged in, not on auth pages, not on public pages
const shouldShowChatPanel = computed(() => isAuthenticatedUser.value && !isAuthPage.value && !isPublicPage.value && route.meta?.renderChatWidget !== false)

const contentRouteMatch = computed(() => pathWithoutLocale.value.match(/^\/[^/]+\/content\/([^/]+)(?:\/|$)/))

const normalizeRouteParam = (param?: string | string[]) => {
  if (Array.isArray(param))
    return param[0]
  if (typeof param === 'string')
    return param
  return undefined
}

const orgSlug = computed(() => {
  const param = route.params.slug
  const routeSlug = Array.isArray(param) ? param[0] : param
  if (routeSlug && routeSlug !== NON_ORG_SLUG)
    return routeSlug
  const fallback = activeOrg.value?.data?.slug
  return fallback && fallback !== NON_ORG_SLUG ? fallback : null
})

const userMenuItems = computed(() => {
  const items: any[] = []
  if (orgSlug.value) {
    items.push({
      label: t('global.nav.settings'),
      icon: 'i-lucide-settings',
      to: localePath(`/${orgSlug.value}/settings`)
    })
    items.push({
      label: t('global.nav.integrations'),
      icon: 'i-lucide-plug',
      to: localePath(`/${orgSlug.value}/integrations`)
    })
  }
  items.push({
    label: t('global.auth.signOut'),
    icon: 'i-lucide-log-out',
    onSelect: () => signOut()
  })
  return items
})

const contentId = computed(() => {
  if (!contentRouteMatch.value)
    return undefined
  const id = normalizeRouteParam(route.params.id)
  return id || contentRouteMatch.value[1]
})

const toast = useToast()

const {
  items: conversationItems,
  pending: conversationPending,
  error: conversationError,
  hasMore: conversationHasMore,
  initialized: conversationInitialized,
  loadInitial: loadConversationInitial,
  loadMore: loadConversationMore,
  remove: removeConversation,
  refresh: refreshConversation,
  reset: resetConversationList
} = useConversationList({ pageSize: 40, stateKey: 'shell' })

const chatView = ref<'chat' | 'list'>('chat')
const archivingConversationId = ref<string | null>(null)
const conversationsExpanded = ref(false)

watch(() => shouldShowChatPanel.value, (next) => {
  if (!next) {
    chatView.value = 'chat'
    conversationsExpanded.value = false
    return
  }
  if (!import.meta.client)
    return
  if (conversationPending.value && !conversationInitialized.value)
    resetConversationList()
  loadConversationInitial().catch((err) => {
    console.error('Failed to load initial conversations:', err)
    toast.add({
      title: 'Failed to load conversations',
      color: 'error'
    })
  })
})

onMounted(() => {
  if (!shouldShowChatPanel.value)
    return
  if (conversationPending.value && !conversationInitialized.value)
    resetConversationList()
  loadConversationInitial().catch((err) => {
    console.error('Failed to load initial conversations:', err)
    toast.add({
      title: 'Failed to load conversations',
      color: 'error'
    })
  })
})

watch(isAuthenticatedUser, (value, previous) => {
  if (value === previous)
    return
  resetConversationList()
  if (!value) {
    // Clear conversationId from localStorage on sign-out to prevent session leakage
    conversation.resetConversation()
  }
  if (!import.meta.client)
    return
  if (value && shouldShowChatPanel.value) {
    loadConversationInitial().catch((err) => {
      console.error('Failed to load initial conversations:', err)
      toast.add({
        title: 'Failed to load conversations',
        color: 'error'
      })
    })
  }
})

watch(() => activeOrg.value?.data?.id, (nextOrgId, previousOrgId) => {
  if (!nextOrgId || !previousOrgId || nextOrgId === previousOrgId)
    return
  resetConversationList()
  if (!import.meta.client)
    return
  if (shouldShowChatPanel.value) {
    loadConversationInitial().catch((err) => {
      console.error('Failed to load initial conversations:', err)
      toast.add({
        title: 'Failed to load conversations',
        color: 'error'
      })
    })
  }
})

const toggleChatView = () => {
  chatView.value = chatView.value === 'chat' ? 'list' : 'chat'
  conversationsExpanded.value = false
}

const startNewChat = () => {
  chatView.value = 'chat'
  conversation.conversationId.value = null
  conversation.resetConversation()
  conversation.prompt.value = ''
}

const selectConversation = (id: string) => {
  chatView.value = 'chat'
  conversation.conversationId.value = id
}

const chatTitle = computed(() => {
  if (chatView.value === 'list')
    return 'Conversations'
  const id = conversation.conversationId.value
  if (!id)
    return 'New chat'
  const match = conversationItems.value.find(item => item.id === id)
  return match?.displayLabel || 'Chat'
})

const archiveConversation = async (conversationId: string, event?: Event) => {
  event?.stopPropagation()
  if (!conversationId || archivingConversationId.value === conversationId)
    return

  archivingConversationId.value = conversationId
  try {
    await $fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' })
    removeConversation(conversationId)

    if (conversation.conversationId.value === conversationId)
      startNewChat()

    await refreshConversation().catch((err) => {
      console.error('refreshConversation failed', err)
    })
    toast.add({
      title: 'Conversation archived',
      color: 'success'
    })
  } catch (error) {
    console.error('Failed to archive conversation', error)
    toast.add({
      title: 'Failed to archive conversation',
      description: error instanceof Error ? error.message : 'Please try again.',
      color: 'error'
    })
  } finally {
    archivingConversationId.value = null
  }
}

const visibleConversationItems = computed(() => {
  if (conversationsExpanded.value)
    return conversationItems.value
  return conversationItems.value.slice(0, 3)
})

const canExpandConversationList = computed(() => {
  return !conversationsExpanded.value && (conversationItems.value.length > 3 || conversationHasMore.value)
})
</script>

<template>
  <div class="relative min-h-screen bg-white dark:bg-neutral-950 lg:h-screen lg:overflow-hidden">
    <UDashboardGroup>
      <UDashboardSidebar
        v-if="!isAuthPage"
        :collapsed="isSidebarCollapsed"
        :open="isSidebarOpen"
        :ui="{
          root: 'bg-neutral-100 dark:bg-neutral-950 border-neutral-200/70 dark:border-neutral-800/60 w-[260px] min-w-[260px]'
        }"
      >
        <template #header>
          <div class="flex items-center border-b border-neutral-200/70 dark:border-neutral-800/60 px-2 h-[40px]">
            <NuxtLink
              :to="localePath('/')"
              class="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <span
                v-if="!isSidebarCollapsed"
                class="text-sm font-semibold whitespace-nowrap"
              >{{ t('global.appName') }}</span>
              <UIcon
                v-else
                name="i-lucide-box"
                class="w-5 h-5"
              />
            </NuxtLink>
          </div>
        </template>

        <template #default>
          <slot name="sidebar">
            <!-- Guest navigation -->
            <div
              v-if="!isAuthenticatedUser"
              class="p-4 space-y-2"
            >
              <UButton
                block
                variant="outline"
                icon="i-lucide-file-plus"
                @click="authModalMode = 'signup'; authModalOpen = true"
              >
                {{ t('global.sidebar.createContent') }}
              </UButton>
              <UButton
                block
                variant="ghost"
                icon="i-lucide-upload"
                @click="authModalMode = 'signup'; authModalOpen = true"
              >
                {{ t('global.sidebar.addFiles') }}
              </UButton>
            </div>
          </slot>
        </template>
      </UDashboardSidebar>

      <aside
        v-if="shouldShowChatPanel"
        class="flex w-full min-h-0 flex-col border-t border-neutral-200/70 bg-white dark:border-neutral-800/60 dark:bg-neutral-950 max-lg:h-full lg:h-full lg:w-[400px] lg:border-t-0 lg:border-l lg:border-r"
      >
        <div class="flex items-center gap-2 border-b border-neutral-200/70 px-2 h-[40px] dark:border-neutral-800/60">
          <UButton
            aria-label="Back"
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-arrow-left"
            @click="toggleChatView"
          />
          <UButton
            v-if="!isAuthPage"
            aria-label="Menu"
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-menu"
            class="lg:hidden"
            @click="isSidebarOpen = !isSidebarOpen"
          />
          <p class="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-700 dark:text-neutral-200">
            {{ chatTitle }}
          </p>
          <UDropdownMenu
            v-if="isAuthenticatedUser"
            :items="userMenuItems"
          >
            <UButton
              aria-label="Settings"
              variant="ghost"
              color="neutral"
              size="xs"
              icon="i-lucide-settings"
            />
          </UDropdownMenu>
          <UButton
            aria-label="New chat"
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-square-pen"
            @click="startNewChat"
          />
        </div>

        <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div
            v-if="chatView === 'list'"
            class="flex-1 min-h-0 overflow-y-auto"
          >
            <div class="p-3">
              <UAlert
                v-if="conversationError"
                color="error"
                variant="soft"
                title="Failed to load conversations"
                :description="conversationError"
              />
            </div>

            <div class="space-y-1 px-2 pb-2">
              <template v-if="conversationInitialized && visibleConversationItems.length">
                <div
                  v-for="entry in visibleConversationItems"
                  :key="entry.id"
                  class="group relative w-full rounded-md border border-transparent transition-colors"
                  :class="conversation.conversationId.value === entry.id
                    ? 'bg-neutral-100/80 dark:bg-neutral-800/60'
                    : 'hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40'"
                >
                  <button
                    type="button"
                    class="w-full rounded-md px-3 py-2 text-left"
                    @click="selectConversation(entry.id)"
                  >
                    <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                      <p class="text-sm font-semibold truncate">
                        {{ entry.displayLabel }}
                      </p>
                      <div class="flex items-center justify-end gap-2 font-mono text-xs tabular-nums">
                        <span
                          v-if="(entry.additions || 0) > 0"
                          class="text-emerald-500 dark:text-emerald-400"
                        >
                          +{{ entry.additions }}
                        </span>
                        <span
                          v-if="(entry.deletions || 0) > 0"
                          class="text-rose-500 dark:text-rose-400"
                        >
                          -{{ entry.deletions }}
                        </span>
                      </div>
                      <p class="text-xs text-muted-foreground text-right">
                        {{ entry.updatedAgo }}
                      </p>
                    </div>
                  </button>
                  <UButton
                    icon="i-lucide-archive"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Archive conversation"
                    @click="archiveConversation(entry.id, $event)"
                  />
                </div>
              </template>

              <template v-else-if="conversationPending && !conversationInitialized">
                <div
                  v-for="n in 8"
                  :key="n"
                  class="rounded-md border border-neutral-200/60 dark:border-neutral-800/60 px-3 py-2"
                >
                  <USkeleton class="h-4 w-3/4" />
                  <USkeleton class="h-3 w-1/3 mt-2" />
                </div>
              </template>

              <p
                v-else
                class="text-sm text-muted-foreground px-3 py-6 text-center"
              >
                No conversations yet.
              </p>
            </div>

            <div class="flex justify-center px-3 pb-2">
              <UButton
                v-if="canExpandConversationList"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="conversationsExpanded = true"
              >
                View all
              </UButton>
              <UButton
                v-else-if="conversationsExpanded && conversationItems.length > 3"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="conversationsExpanded = false"
              >
                Show less
              </UButton>
            </div>

            <div class="flex justify-center px-3 pb-4">
              <UButton
                v-if="conversationsExpanded && conversationHasMore"
                color="neutral"
                variant="outline"
                size="sm"
                :loading="conversationPending"
                @click="loadConversationMore()"
              >
                Load more
              </UButton>
            </div>
          </div>

          <QuillioWidget
            class="flex-1 min-h-0"
            :content-id="contentId"
            :conversation-id="conversation.conversationId.value"
            :sync-route="false"
            :use-route-conversation-id="false"
            :show-messages="chatView !== 'list'"
          />
        </div>
      </aside>

      <!-- Desktop: Workspace (right side) -->
      <div
        class="hidden lg:flex min-h-0 flex-1 flex-col"
        :class="{ 'lg:border-l border-neutral-200/70 dark:border-neutral-800/60': shouldShowChatPanel }"
      >
        <UDashboardNavbar
          v-if="(pageTitle || (!isAuthenticatedUser && !isAuthPage)) && !contentRouteMatch"
          :title="pageTitle || undefined"
        >
          <template
            v-if="!isAuthenticatedUser && !isAuthPage"
            #right
          >
            <div class="flex items-center gap-2">
              <UButton
                :to="localePath('/signin')"
                size="sm"
                variant="ghost"
              >
                {{ t('global.auth.signIn') }}
              </UButton>
              <UButton
                :to="localePath('/signup')"
                size="sm"
              >
                {{ t('global.auth.signUp') }}
              </UButton>
            </div>
          </template>
        </UDashboardNavbar>
        <div
          class="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        >
          <slot />
        </div>
      </div>

      <!-- Mobile: Direct content view (for non-workspace routes like homepage) -->
      <div
        v-if="!isWorkspaceRoute"
        class="lg:hidden flex min-h-0 flex-1 flex-col"
      >
        <UDashboardNavbar
          v-if="(pageTitle || (!isAuthenticatedUser && !isAuthPage)) && !contentRouteMatch"
          :title="pageTitle || undefined"
        >
          <template
            v-if="!isAuthenticatedUser && !isAuthPage"
            #right
          >
            <div class="flex items-center gap-2">
              <UButton
                :to="localePath('/signin')"
                size="sm"
                variant="ghost"
              >
                {{ t('global.auth.signIn') }}
              </UButton>
              <UButton
                :to="localePath('/signup')"
                size="sm"
              >
                {{ t('global.auth.signUp') }}
              </UButton>
            </div>
          </template>
        </UDashboardNavbar>
        <div
          class="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        >
          <slot />
        </div>
      </div>

      <!-- Mobile: Workspace in drawer (for workspace routes) -->
      <UDrawer
        v-if="isWorkspaceRoute"
        v-model:open="isWorkspaceOpen"
        :handle="false"
      >
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">
              {{ pageTitle || 'Workspace' }}
            </h2>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="isWorkspaceOpen = false"
            />
          </div>
        </template>
        <template #content>
          <div
            class="flex-1 overflow-y-auto overflow-x-hidden min-h-0 lg:hidden"
          >
            <slot />
          </div>
        </template>
      </UDrawer>
    </UDashboardGroup>
    <OnboardingModal />
    <AuthModal
      v-model:open="authModalOpen"
      v-model:mode="authModalMode"
    />
  </div>
</template>
