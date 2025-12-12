<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import type { ConversationQuotaUsagePayload } from '~/types/conversation'
import { useClipboard, useDebounceFn } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'

import BillingUpgradeModal from '~/components/billing/UpgradeModal.vue'
import ChatConversationMessages from './ChatConversationMessages.vue'
import PromptComposer from './PromptComposer.vue'
import QuotaLimitModal from './QuotaLimitModal.vue'

interface ContentConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  payload?: Record<string, any> | null
  createdAt: string | Date
}

// Props for embedding the widget
interface Props {
  contentId?: string | null // Link chat to specific content
  conversationId?: string | null // Resume existing conversation
  initialMode?: 'chat' | 'agent' // Default chat mode
}

const props = withDefaults(defineProps<Props>(), {
  contentId: null,
  conversationId: null,
  initialMode: 'chat'
})

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const auth = useAuth()
const { loggedIn, useActiveOrganization, refreshActiveOrganizationExtras, signIn } = auth
const activeOrgState = useActiveOrganization()

const {
  messages,
  status,
  errorMessage,
  sendMessage,
  isBusy,
  conversationId: activeConversationId,
  resetConversation,
  prompt,
  mode,
  hydrateConversation,
  getCachedMessagesMeta
} = useConversation()

// Set initial mode from props
if (props.initialMode) {
  mode.value = props.initialMode
}

if (!loggedIn.value && mode.value === 'agent') {
  mode.value = 'chat'
}

watch(
  [loggedIn, () => mode.value],
  ([isLoggedIn, currentMode]) => {
    if (!isLoggedIn && currentMode === 'agent') {
      mode.value = 'chat'
    }
  },
  { immediate: true }
)

// Mode dropdown items - conditionally disable agent mode for non-logged-in users
const modeItems = computed(() => [
  { value: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' },
  { value: 'agent', label: 'Agent', icon: 'i-lucide-bot', disabled: !loggedIn.value }
])

const promptSubmitting = ref(false)
const showQuotaModal = ref(false)
const quotaModalData = ref<{ limit: number | null, used: number | null, remaining: number | null, planLabel: string | null } | null>(null)
const showUpgradeModal = ref(false)
const showAgentModeLoginModal = ref(false)
const { copy } = useClipboard()
const toast = useToast()
const runtimeConfig = useRuntimeConfig()

const parseConversationLimitValue = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed))
      return parsed
  }
  return fallback
}

const guestConversationLimit = computed(() => parseConversationLimitValue((runtimeConfig.public as any)?.conversationQuota?.anonymous, 10))
const verifiedConversationLimit = computed(() => parseConversationLimitValue((runtimeConfig.public as any)?.conversationQuota?.verified, 50))

const archivingConversationId = ref<string | null>(null)
const conversationQuotaState = useState<ConversationQuotaUsagePayload | null>('conversation-quota-usage', () => null)

interface ConversationListResponse {
  conversations: Array<{
    id: string
    status: string
    updatedAt: Date | string
    createdAt: Date | string
    contentId: string | null
    sourceContentId: string | null
    metadata: Record<string, any> | null
    _computed?: {
      artifactCount: number
      latestArtifactTitle: string | null
    }
  }>
  conversationQuota?: ConversationQuotaUsagePayload | null
}

const {
  data: conversationsPayload,
  refresh: refreshConversations
} = await useFetch<ConversationListResponse>('/api/conversations', {
  lazy: true, // Don't block page load
  default: () => ({
    conversations: []
  })
})
const debouncedRefreshConversations = useDebounceFn(() => refreshConversations(), 300)
// Populate conversation list cache for header reuse
const conversationListCache = useState<Map<string, any>>('conversation-list-cache', () => new Map())

const updateLocalConversationStatus = (conversationId: string, status: string) => {
  const currentPayload = conversationsPayload.value
  if (!currentPayload?.conversations?.length)
    return

  const nextConversations = currentPayload.conversations.map((conv) => {
    if (conv.id !== conversationId)
      return conv
    return {
      ...conv,
      status
    }
  })

  conversationsPayload.value = {
    ...currentPayload,
    conversations: nextConversations
  }

  const archivedConversation = nextConversations.find(conv => conv.id === conversationId)
  if (archivedConversation) {
    conversationListCache.value.set(conversationId, archivedConversation)
  }
}

const conversationQuotaUsage = computed<ConversationQuotaUsagePayload | null>(() =>
  conversationsPayload.value?.conversationQuota ?? null
)
const quotaPlanLabel = computed(() => conversationQuotaUsage.value?.label ?? (loggedIn.value ? 'Current plan' : 'Guest access'))

watch(conversationQuotaUsage, (value) => {
  if (value) {
    conversationQuotaState.value = {
      limit: value.limit ?? null,
      used: value.used ?? null,
      remaining: value.remaining ?? null,
      label: value.label ?? null,
      unlimited: value.unlimited ?? false
    }
  } else {
    conversationQuotaState.value = null
  }
}, { immediate: true, deep: true })

const fetchedConversationEntries = computed(() => {
  const list = Array.isArray(conversationsPayload.value?.conversations) ? conversationsPayload.value?.conversations : []
  return list.map((conv: any) => {
    let updatedAt: Date | null = null
    if (conv.updatedAt) {
      const parsedDate = new Date(conv.updatedAt)
      updatedAt = Number.isFinite(parsedDate.getTime()) ? parsedDate : null
    }

    return {
      id: conv.id,
      title: conv._computed?.title || conv._computed?.latestArtifactTitle || 'Untitled conversation',
      status: conv.status,
      updatedAt,
      lastMessage: conv._computed?.lastMessage || null
    }
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
})

// Filter out archived conversations - show only active/completed
const conversationEntries = computed(() => {
  return fetchedConversationEntries.value.filter((entry) => {
    const status = (entry.status || '').toLowerCase().trim()
    return status !== 'archived'
  })
})

// Convert conversations to UNavigationMenu format (array of arrays for groups)
const conversationMenuItems = computed(() => {
  const items = conversationEntries.value.map(conv => ({
    label: conv.title,
    to: `/conversations/${conv.id}`,
    badge: conv.status === 'pending' ? 'pending' : undefined
  }))
  // Return as array of arrays (groups) like other menus
  return items.length > 0 ? [items] : []
})

// Share conversation menu items via shared state (accessible from layout)
const conversationMenuItemsState = useState<any[][]>('conversation-menu-items', () => [])
watch(conversationMenuItems, (items) => {
  conversationMenuItemsState.value = items
}, { immediate: true })

const uiStatus = computed(() => status.value)

// Tool progress is now shown inline as message parts, no need for placeholder
const displayMessages = computed<ChatMessage[]>(() => messages.value)
const openQuotaModal = (payload?: { limit?: number | null, used?: number | null, remaining?: number | null, label?: string | null } | null) => {
  const fallback = conversationQuotaUsage.value

  // Simplified: guest vs logged-in only
  const isGuest = !loggedIn.value
  const baseLimit = payload?.limit ?? fallback?.limit ?? (isGuest ? guestConversationLimit.value : verifiedConversationLimit.value)
  const usedValue = payload?.used ?? fallback?.used ?? 0
  const remainingValue = payload?.remaining ?? fallback?.remaining ?? (baseLimit !== null ? Math.max(0, baseLimit - usedValue) : null)

  quotaModalData.value = {
    limit: baseLimit,
    used: usedValue,
    remaining: remainingValue,
    planLabel: payload?.label ?? fallback?.label ?? quotaPlanLabel.value ?? null
  }
  showQuotaModal.value = true
}

const quotaModalMessage = computed(() => {
  if (!loggedIn.value) {
    return `Make an account to unlock ${verifiedConversationLimit.value} total conversations or archive conversations to continue chatting.`
  }
  if (conversationQuotaUsage.value?.unlimited) {
    return 'Your current plan includes unlimited conversations.'
  }
  return 'Starter plans have a conversation limit. Upgrade to unlock unlimited conversations or archive conversations to continue chatting.'
})

const quotaModalTitle = computed(() => {
  const limit = quotaModalData.value?.limit ?? conversationQuotaUsage.value?.limit ?? null
  const used = quotaModalData.value?.used ?? conversationQuotaUsage.value?.used ?? null
  if (typeof limit === 'number') {
    const remaining = Math.max(0, limit - (typeof used === 'number' ? used : 0))
    return `You have ${remaining}/${limit} conversations remaining.`
  }
  if (conversationQuotaUsage.value?.unlimited) {
    return 'Unlimited conversations unlocked.'
  }
  return loggedIn.value ? 'Upgrade to unlock more conversations.' : 'Create an account for more conversations.'
})

const quotaPrimaryLabel = computed(() => {
  if (!loggedIn.value)
    return 'Sign up'
  if (conversationQuotaUsage.value?.unlimited)
    return 'Close'
  return 'Upgrade'
})

const handleQuotaModalPrimary = () => {
  showQuotaModal.value = false
  if (conversationQuotaUsage.value?.unlimited) {
    // For unlimited plans, just close the modal
    return
  }
  if (loggedIn.value) {
    showUpgradeModal.value = true
    return
  }
  const destination = `/signup?redirect=${encodeURIComponent('/')}`
  router.push(destination)
}

const handleQuotaModalCancel = () => {
  showQuotaModal.value = false
}

const handleUpgradeSuccess = async () => {
  showUpgradeModal.value = false
  // Wait for modal to close and DOM to update before refreshing
  await nextTick()
  try {
    await refreshActiveOrganizationExtras(activeOrgState.value?.data?.id)
    await refreshConversations()
  } catch (error) {
    // Silently handle errors during refresh to prevent crashes
    // Component may be unmounting or in a transitional state
    console.error('Error refreshing after upgrade:', error)
  }
}

const handleQuotaGoogleSignup = () => {
  showQuotaModal.value = false
  if (typeof window === 'undefined')
    return
  try {
    signIn.social?.({
      provider: 'google',
      callbackURL: window.location.href
    })
  } catch (error) {
    console.error('Failed to start Google signup', error)
  }
}

const handleQuotaEmailSignup = () => {
  showQuotaModal.value = false
  const redirect = route.fullPath || '/'
  router.push(`/signup?redirect=${encodeURIComponent(redirect)}`)
}

const handleAgentModeGoogleSignup = () => {
  showAgentModeLoginModal.value = false
  if (typeof window === 'undefined')
    return
  try {
    signIn.social?.({
      provider: 'google',
      callbackURL: window.location.href
    })
  } catch (error) {
    console.error('Failed to start Google signup', error)
  }
}

const handleAgentModeEmailSignup = () => {
  showAgentModeLoginModal.value = false
  const redirect = route.fullPath || '/'
  router.push(`/signup?redirect=${encodeURIComponent(redirect)}`)
}

const handleAgentModeSignIn = () => {
  showAgentModeLoginModal.value = false
  const redirect = route.fullPath || '/'
  router.push(`/signin?redirect=${encodeURIComponent(redirect)}`)
}

if (import.meta.client) {
  const handleQuotaEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ limit?: number, used?: number, remaining?: number, label?: string, unlimited?: boolean }>).detail
    openQuotaModal(detail || undefined)
  }
  onMounted(() => {
    window.addEventListener('quillio:show-quota', handleQuotaEvent as EventListener)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('quillio:show-quota', handleQuotaEvent as EventListener)
  })
}

const handlePromptSubmit = async (value?: string) => {
  const input = typeof value === 'string' ? value : prompt.value
  const trimmed = input.trim()
  if (!trimmed) {
    return
  }
  promptSubmitting.value = true
  prompt.value = ''
  try {
    await sendMessage(trimmed)
  } finally {
    promptSubmitting.value = false
  }
}

// Get conversationId from route params (for /conversations/[id] route)
const routeConversationId = computed(() => {
  const id = route.params.id
  if (Array.isArray(id)) {
    return id[0] || null
  }
  return id || null
})

// Effective conversation ID: prioritize prop, then route, then active conversation
const conversationId = computed(() => {
  return props.conversationId || routeConversationId.value || activeConversationId.value
})

// Simple UUID validation (matches server-side validation)
const isValidUUID = (id: string | null): boolean => {
  if (!id) {
    return false
  }
  // UUID v7 format: 8-4-4-4-12 hex digits
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

const loadConversationMessages = async (conversationId: string, options?: { force?: boolean }) => {
  if (!conversationId) {
    return
  }

  // Skip loading if conversationId is "new" or not a valid UUID
  if (conversationId === 'new' || !isValidUUID(conversationId)) {
    return
  }

  // OPTIMIZATION: Check cache first for instant display
  const cached = getCachedMessagesMeta(conversationId)
  if (cached) {
    // Show cached messages immediately (optimistic navigation)
    hydrateConversation({
      conversationId,
      messages: cached.messages
    }, { skipCache: true }) // Don't re-cache what we just loaded from cache
  }

  const shouldFetch = options?.force || !cached || cached.isStale

  if (!shouldFetch) {
    return
  }

  // Fetch fresh data in background when needed
  try {
    const messagesResponse = await $fetch<{ data: ContentConversationMessage[] }>(`/api/conversations/${conversationId}/messages`)

    // Convert ContentConversationMessage to ChatResponse format
    const convertedMessages = (messagesResponse.data || []).map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      parts: msg.content ? [{ type: 'text' as const, text: msg.content }] : [],
      payload: msg.payload,
      createdAt: msg.createdAt instanceof Date ? msg.createdAt : new Date(msg.createdAt)
    }))

    // Update with fresh data (this will also update the cache)
    hydrateConversation({
      conversationId,
      messages: convertedMessages
    })
  } catch (error) {
    // Only show error if we didn't have cached data
    if (!cached) {
      console.error('Unable to load conversation messages', error)
      toast.add({
        title: 'Failed to load messages',
        description: 'Unable to load conversation history. Please try refreshing.',
        color: 'error',
        icon: 'i-lucide-alert-triangle'
      })
    } else {
      // Silently fail if we have cached data - user can still interact
      console.warn('Failed to refresh conversation messages, using cached data', error)
    }
  }
}

// Load conversation from prop or route param when component mounts or changes
watch([() => props.conversationId, routeConversationId], async ([propId, routeId]) => {
  const targetId = propId || routeId

  if (targetId && targetId !== activeConversationId.value) {
    if (isValidUUID(targetId)) {
      activeConversationId.value = targetId
      await loadConversationMessages(targetId)
    }
  } else if (!targetId && activeConversationId.value) {
    // No conversation specified, reset
    activeConversationId.value = null
    resetConversation()
  }
}, { immediate: true })

// Watch composable conversationId - when chat creates/updates conversation, navigate to it
watch(activeConversationId, (value, previous) => {
  if (!value || value === previous)
    return

  // Only navigate if not embedded (no contentId prop) and route doesn't match
  if (!props.contentId && value !== routeConversationId.value) {
    router.push(`/conversations/${value}`)
  }

  // Refresh conversations to ensure new conversation appears in list
  const alreadyPresent = fetchedConversationEntries.value.some(entry => entry.id === value)

  if (!alreadyPresent) {
    debouncedRefreshConversations()
  }
})

const closeConversation = async () => {
  router.push('/conversations')
  resetConversation()
}

// Archive via context menu or other UI - not used in navigation menu
const _archiveConversation = async (entry: { id: string, title?: string | null }) => {
  if (!entry?.id || archivingConversationId.value === entry.id)
    return

  archivingConversationId.value = entry.id

  try {
    await $fetch(`/api/conversations/${entry.id}`, {
      method: 'DELETE'
    })

    updateLocalConversationStatus(entry.id, 'archived')

    if (activeConversationId.value === entry.id) {
      router.push('/conversations')
      resetConversation()
    }

    await refreshConversations()

    toast.add({
      title: 'Content archived',
      description: entry.title || 'Content moved to archive.',
      color: 'neutral',
      icon: 'i-lucide-archive'
    })
  } catch (error: any) {
    const message = error?.data?.statusMessage || error?.statusMessage || 'Failed to archive conversation'
    toast.add({
      title: 'Archive failed',
      description: message,
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
  } finally {
    archivingConversationId.value = null
  }
}

// Keep for potential future use (e.g., back button in UI)
function _handleBackNavigation() {
  if (activeConversationId.value) {
    closeConversation()
  } else {
    router.push('/')
  }
}

function getMessageText(message: ChatMessage) {
  return message.parts[0]?.text || ''
}

async function handleCopy(message: ChatMessage) {
  const rawText = getMessageText(message)
  const hasContent = rawText.trim().length > 0

  if (!hasContent) {
    toast.add({
      title: 'Nothing to copy',
      description: 'This message has no text content.',
      color: 'error'
    })
    return
  }

  try {
    await copy(rawText)
    toast.add({
      title: 'Copied to clipboard',
      description: 'Message copied successfully.',
      color: 'primary'
    })
  } catch (error) {
    console.error('Failed to copy message', error)
    toast.add({
      title: 'Copy failed',
      description: 'Could not copy message to clipboard.',
      color: 'error'
    })
  }
}

const handleRegenerate = async (message: ChatMessage) => {
  if (isBusy.value) {
    return
  }
  const text = message.parts[0]?.text?.trim() || ''

  if (!text) {
    toast.add({
      title: 'Cannot regenerate',
      description: 'This message has no text to resend.',
      color: 'error'
    })
    return
  }

  prompt.value = text
  await handlePromptSubmit(text)
}

async function handleSendAgain(message: ChatMessage) {
  const text = message.parts?.[0]?.text || ''
  if (text) {
    prompt.value = text
    try {
      await handlePromptSubmit(text)
    } catch (error) {
      console.error('Failed to send message again', error)
      toast.add({
        title: 'Send failed',
        description: 'Could not resend the message.',
        color: 'error'
      })
    }
  }
}

async function handleShare(message: ChatMessage) {
  const text = getMessageText(message)
  if (!text.trim()) {
    toast.add({
      title: 'Nothing to share',
      description: 'This message has no text content to share.',
      color: 'error'
    })
    return
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ text })
      toast.add({
        title: 'Shared',
        description: 'Message sent to your share target.',
        color: 'primary'
      })
      return
    }
  } catch (error) {
    const isAbortError = error && typeof error === 'object'
      && (
        (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
        || (error as { name?: string }).name === 'AbortError'
      )

    if (isAbortError) {
      console.info('Share cancelled by user', error)
      toast.add({
        title: 'Share cancelled',
        description: 'No message was shared.',
        color: 'neutral'
      })
      return
    }

    console.warn('Navigator share failed, falling back to copy', error)
  }

  copy(text)
  toast.add({
    title: 'Copied to clipboard',
    description: 'Message copied for sharing.',
    color: 'primary'
  })
}

watch(conversationsPayload, (payload) => {
  if (!payload?.conversations)
    return
  const cache = conversationListCache.value
  payload.conversations.forEach((conv: any) => {
    if (conv.id) {
      cache.set(conv.id, conv)
    }
  })
}, { immediate: true, deep: true })

if (import.meta.client) {
  watch(loggedIn, () => {
    debouncedRefreshConversations()
  }, { immediate: true })

  // Watch mode changes - block agent mode for anonymous users
  watch(mode, (newMode) => {
    if (newMode === 'agent' && !loggedIn.value) {
      // Reset to chat mode
      mode.value = 'chat'
      // Show login prompt
      showAgentModeLoginModal.value = true
    }
  })
}
</script>

<template>
  <div class="w-full h-full flex flex-col py-4 px-4 sm:px-6 pb-40 lg:pb-4">
    <div class="w-full flex-1 flex flex-col justify-center lg:justify-center">
      <div class="space-y-8">
        <ChatConversationMessages
          :messages="messages"
          :display-messages="displayMessages"
          :conversation-id="conversationId"
          :status="status"
          :ui-status="uiStatus"
          :error-message="errorMessage"
          :is-busy="isBusy"
          :prompt-submitting="promptSubmitting"
          @copy="handleCopy"
          @regenerate="handleRegenerate"
          @send-again="handleSendAgain"
          @share="handleShare"
        />

        <!-- Main chat input - always visible -->
        <div class="w-full flex flex-col justify-center mt-8 lg:mt-4 fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm z-40 pb-safe lg:static lg:bg-transparent lg:dark:bg-transparent lg:backdrop-blur-none lg:pb-0">
          <div class="w-full max-w-3xl mx-auto px-4 py-4 lg:py-0">
            <PromptComposer
              v-model="prompt"
              placeholder="Paste a transcript or describe what you need..."
              :disabled="isBusy || promptSubmitting"
              :status="promptSubmitting ? 'submitted' : uiStatus"
              @submit="handlePromptSubmit"
            >
              <template #footer>
                <component
                  :is="!loggedIn ? 'UTooltip' : 'div'"
                  v-bind="!loggedIn ? { text: 'Sign in to unlock agent mode' } : {}"
                >
                  <UInputMenu
                    v-model="mode"
                    :items="modeItems"
                    value-key="value"
                    label-key="label"
                    variant="ghost"
                    size="sm"
                    ignore-filter
                    readonly
                    open-on-click
                  >
                    <template #leading>
                      <UIcon
                        :name="mode === 'agent' ? 'i-lucide-bot' : 'i-lucide-message-circle'"
                        class="w-4 h-4"
                        :class="{ 'opacity-50': mode === 'agent' && !loggedIn }"
                      />
                    </template>
                  </UInputMenu>
                </component>
              </template>
            </PromptComposer>

            <!-- Legal Disclaimer - Only for anonymous/guest users, below composer on mobile -->
            <i18n-t
              v-if="!loggedIn"
              keypath="global.legal.chatDisclaimer"
              tag="p"
              class="text-xs text-muted-600 dark:text-muted-400 text-center mt-2 lg:hidden"
            >
              <template #terms>
                <NuxtLink
                  :to="localePath('/terms')"
                  class="underline hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {{ t('global.legal.terms') }}
                </NuxtLink>
              </template>
              <template #privacy>
                <NuxtLink
                  :to="localePath('/privacy')"
                  class="underline hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {{ t('global.legal.privacyPolicy') }}
                </NuxtLink>
              </template>
            </i18n-t>
          </div>
        </div>
      </div>
    </div>

    <QuotaLimitModal
      v-model:open="showQuotaModal"
      :title="quotaModalTitle"
      :limit="quotaModalData?.limit ?? conversationQuotaUsage?.limit ?? null"
      :used="quotaModalData?.used ?? conversationQuotaUsage?.used ?? null"
      :remaining="quotaModalData?.remaining ?? conversationQuotaUsage?.remaining ?? null"
      :plan-label="quotaModalData?.planLabel ?? quotaPlanLabel"
      :message="quotaModalMessage"
      :primary-label="quotaPrimaryLabel"
      @primary="handleQuotaModalPrimary"
      @cancel="handleQuotaModalCancel"
    >
      <template
        v-if="!loggedIn"
        #actions
      >
        <div class="flex flex-col gap-3 pt-4">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <UButton
              color="neutral"
              variant="soft"
              icon="i-simple-icons-google"
              class="flex-1 justify-center"
              @click="handleQuotaGoogleSignup"
            >
              Continue with Google
            </UButton>
            <div class="flex-1 text-center sm:text-left">
              <button
                type="button"
                class="text-sm text-primary-400 font-semibold hover:underline"
                @click="handleQuotaEmailSignup"
              >
                Sign up
              </button>
            </div>
          </div>
        </div>
      </template>
    </QuotaLimitModal>
    <BillingUpgradeModal
      v-model:open="showUpgradeModal"
      :organization-id="activeOrgState?.value?.data?.id || undefined"
      @upgraded="handleUpgradeSuccess"
    />

    <!-- Agent Mode Login Modal -->
    <UModal
      v-model:open="showAgentModeLoginModal"
      title="Sign in to unlock agent mode"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted-600 dark:text-muted-400">
            Agent mode requires authentication to create and save content. Sign in to unlock the full power of AI-assisted content creation.
          </p>

          <div class="flex flex-col gap-3 pt-4">
            <UButton
              color="primary"
              block
              icon="i-simple-icons-google"
              @click="handleAgentModeGoogleSignup"
            >
              Continue with Google
            </UButton>
            <div class="flex items-center gap-2">
              <UButton
                color="neutral"
                variant="outline"
                block
                @click="handleAgentModeSignIn"
              >
                Sign In
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                block
                @click="handleAgentModeEmailSignup"
              >
                Sign Up
              </UButton>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              block
              @click="showAgentModeLoginModal = false"
            >
              Maybe later
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
