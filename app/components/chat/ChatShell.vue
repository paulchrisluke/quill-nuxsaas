<script setup lang="ts">
import type { ChatMessage, FileRecord } from '#shared/utils/types'
import type { FileListItem } from '~/composables/useFileList'
import { useClipboard } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'

import { KNOWN_LOCALES } from '~~/shared/constants/routing'
import { stripLocalePrefix } from '~~/shared/utils/routeMatching'
import { useContentUpdates } from '~/composables/useContentUpdates'
import { useFileList } from '~/composables/useFileList'
import { useFileManager } from '~/composables/useFileManager'
import ChatConversationMessages from './ChatConversationMessages.vue'
import PromptComposer from './PromptComposer.vue'

declare global {
  interface Window {
    gapi?: any
    google?: any
    __googleApiLoaderPromise?: Promise<void>
    __googlePickerLoaderPromise?: Promise<void>
  }
}

const props = withDefaults(defineProps<{
  contentId?: string | null
  conversationId?: string | null
  initialMode?: 'chat' | 'agent'
  syncRoute?: boolean
  useRouteConversationId?: boolean
  showMessages?: boolean
}>(), {
  contentId: null,
  conversationId: null,
  initialMode: 'chat',
  syncRoute: true,
  useRouteConversationId: true,
  showMessages: true
})

const router = useRouter()
const route = useRoute()
const localePath = useLocalePath()
const { signIn, useActiveOrganization, isAuthenticatedUser } = useAuth()
const activeOrg = useActiveOrganization()
const runtimeConfig = useRuntimeConfig()
const googlePickerApiKey = runtimeConfig.public.googlePickerApiKey || ''

// Check for Google Drive integration
const organizationIdForIntegrations = computed(() => activeOrg.value?.data?.id)
const { data: integrationsResponse, refresh: refreshIntegrations } = useFetch('/api/organization/integrations', {
  key: () => `chat-shell-integrations-${organizationIdForIntegrations.value || 'none'}`,
  watch: [organizationIdForIntegrations],
  default: () => ({ data: [] }),
  immediate: false
})

// Fetch integrations on mount if organization ID is already available
onMounted(() => {
  if (organizationIdForIntegrations.value) {
    refreshIntegrations()
  }
})

watch(organizationIdForIntegrations, (orgId) => {
  if (orgId) {
    refreshIntegrations()
  }
}, { immediate: true })

const hasGoogleDrive = computed(() => {
  if (!integrationsResponse.value)
    return false
  const list = integrationsResponse.value?.data || []
  return list.some((item: any) => item.type === 'google_drive' && item.isActive)
})

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
  getCachedMessagesMeta,
  stopResponse
} = useConversation()

if (props.initialMode)
  mode.value = props.initialMode
if (!isAuthenticatedUser.value && mode.value === 'agent')
  mode.value = 'chat'

watch([isAuthenticatedUser, () => mode.value], ([isLoggedIn, currentMode]) => {
  if (!isLoggedIn && currentMode === 'agent')
    mode.value = 'chat'
}, { immediate: true })

const modeItems = computed(() => [
  { value: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' },
  { value: 'agent', label: 'Agent', icon: 'i-lucide-bot', disabled: !isAuthenticatedUser.value }
])

const promptSubmitting = ref(false)
const showAgentModeLoginModal = ref(false)
const { copy } = useClipboard()
const toast = useToast()
const chatContainerRef = ref<HTMLElement | null>(null)
const pendingConversationLoad = ref<string | null>(null)
const conversationLoadToken = ref(0)
const fileInputRef = ref<HTMLInputElement | null>(null)
const googlePickerOpening = ref(false)
const { latestCreated } = useContentUpdates()
const lastAutoOpenedContentId = useState<string | null>('chat/auto-opened-content', () => null)

const uiStatus = computed(() => status.value)
const displayMessages = computed<ChatMessage[]>(() => messages.value)
const {
  refresh: refreshWorkspaceFiles,
  upsert: upsertWorkspaceFile
} = useFileList({ pageSize: 100, stateKey: 'workspace-file-tree' })

const ensureIsoString = (value: string | Date | null | undefined) => {
  if (!value)
    return new Date().toISOString()
  if (typeof value === 'string')
    return value
  try {
    return value.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

const mapFileRecordToListItem = (file: FileRecord): FileListItem => ({
  id: file.id,
  originalName: file.originalName,
  fileName: file.fileName,
  mimeType: file.mimeType,
  fileType: file.fileType,
  size: Number(file.size) || 0,
  path: file.path,
  url: file.url ?? null,
  contentId: file.contentId ?? null,
  createdAt: ensureIsoString(file.createdAt),
  updatedAt: ensureIsoString(file.updatedAt)
})

const triggerWorkspaceFileRefresh = () => {
  refreshWorkspaceFiles().catch((error) => {
    console.error('[ChatShell] Failed to refresh workspace files after upload', error)
  })
}

const GOOGLE_PICKER_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif'
].join(',')

const ensureGooglePickerLoaded = async () => {
  if (typeof window === 'undefined') {
    throw new Error('Google Drive picker is only available in the browser.')
  }

  if (!window.__googleApiLoaderPromise) {
    window.__googleApiLoaderPromise = new Promise((resolve, reject) => {
      if (window.gapi) {
        resolve()
        return
      }
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-api]')
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve())
        existingScript.addEventListener('error', reject)
        return
      }
      const script = document.createElement('script')
      script.src = 'https://apis.google.com/js/api.js'
      script.async = true
      script.defer = true
      script.dataset.googleApi = 'true'
      script.onload = () => resolve()
      script.onerror = reject
      document.head.appendChild(script)
    })
  }

  await window.__googleApiLoaderPromise

  if (!window.__googlePickerLoaderPromise) {
    window.__googlePickerLoaderPromise = new Promise((resolve, reject) => {
      window.gapi.load('picker', {
        callback: resolve,
        onerror: reject
      })
    })
  }

  await window.__googlePickerLoaderPromise
  if (!window.google?.picker) {
    throw new Error('Google Picker failed to initialize.')
  }
}

const notifyFileAdded = (
  file: FileRecord,
  options?: { title?: string, description?: string, resetInput?: boolean }
) => {
  const title = options?.title ?? 'File uploaded'
  const description = options?.description ?? `"${file.originalName || file.fileName}" has been added to this workspace.`

  toast.add({
    title,
    description,
    color: 'success',
    icon: 'i-lucide-check-circle'
  })

  try {
    upsertWorkspaceFile(mapFileRecordToListItem(file))
  } catch (error) {
    console.warn('[ChatShell] Failed to upsert file into tree', error)
  }

  triggerWorkspaceFileRefresh()

  if (options?.resetInput && fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

const importDriveDocument = async (doc: Record<string, any>) => {
  const googlePicker = window.google?.picker
  const docId = doc.id ?? doc?.[googlePicker?.Document?.ID]
  if (!docId) {
    toast.add({
      title: 'Import failed',
      description: 'Could not determine the selected file ID.',
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
    return
  }
  const docName = doc.name ?? doc?.[googlePicker?.Document?.NAME] ?? 'drive-image'
  const docMimeType = (doc.mimeType ?? doc?.[googlePicker?.Document?.MIME_TYPE] ?? '').toLowerCase()

  if (!docMimeType || !docMimeType.startsWith('image/')) {
    toast.add({
      title: 'Unsupported file type',
      description: 'Please select an image file from Google Drive.',
      color: 'warning',
      icon: 'i-lucide-alert-circle'
    })
    return
  }

  try {
    const response = await $fetch<{ file: FileRecord }>('/api/integration/google-drive/import', {
      method: 'POST',
      body: {
        fileId: docId,
        fileName: docName,
        mimeType: docMimeType,
        contentId: props.contentId || null
      }
    })

    notifyFileAdded(response.file, {
      title: 'Image imported',
      description: `"${response.file.originalName || response.file.fileName}" has been imported from Google Drive.`
    })
  } catch (error: any) {
    console.error('[ChatShell] Failed to import Drive file', error)
    toast.add({
      title: 'Import failed',
      description: error?.data?.statusMessage || error?.message || 'Unable to import the selected file.',
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
  }
}

const openGoogleDrivePickerInstance = (accessToken: string) => {
  if (typeof window === 'undefined' || !window.google?.picker) {
    throw new Error('Google Picker is not available.')
  }

  const pickerBuilder = new window.google.picker.PickerBuilder()
    .setOAuthToken(accessToken)
    .setDeveloperKey(googlePickerApiKey)
    .setCallback(async (data: any) => {
      try {
        const picker = window.google?.picker
        if (!picker)
          return
        const action = data?.[picker.Response.ACTION] ?? data?.action
        if (action !== picker.Action.PICKED)
          return
        const documents = data?.[picker.Response.DOCUMENTS] ?? data?.docs ?? []
        if (!Array.isArray(documents) || !documents.length)
          return

        await Promise.allSettled(documents.map(doc => importDriveDocument(doc)))
      } catch (error) {
        console.error('[ChatShell] Picker callback failed', error)
        toast.add({
          title: 'Import failed',
          description: error instanceof Error ? error.message : 'Unable to import the selected file.',
          color: 'error',
          icon: 'i-lucide-alert-triangle'
        })
      }
    })
    .setTitle('Select a Google Drive image')
    .enableFeature(window.google.picker.Feature.SIMPLE_UPLOAD_ENABLED)
    .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)

  if (window.location?.origin) {
    pickerBuilder.setOrigin(window.location.origin)
  }

  const docsView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMimeTypes(GOOGLE_PICKER_IMAGE_MIME_TYPES)
    .setLabel('Images')

  const uploadView = new window.google.picker.DocsUploadView()
    .setIncludeFolders(true)
    .setMimeTypes(GOOGLE_PICKER_IMAGE_MIME_TYPES)

  pickerBuilder.addView(docsView)
  pickerBuilder.addView(uploadView)

  const picker = pickerBuilder.build()
  picker.setVisible(true)
}

const handleGoogleDriveClick = async () => {
  if (googlePickerOpening.value)
    return

  if (!hasGoogleDrive.value) {
    toast.add({
      title: 'Google Drive not connected',
      description: 'Please connect Google Drive in your organization settings first.',
      color: 'warning',
      icon: 'i-lucide-alert-circle'
    })
    return
  }

  if (!googlePickerApiKey) {
    toast.add({
      title: 'Google Drive unavailable',
      description: 'Missing Google Picker API key. Contact support to configure it.',
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
    return
  }

  if (!import.meta.client) {
    toast.add({
      title: 'Google Drive unavailable',
      description: 'Drive imports can only be started in the browser.',
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
    return
  }

  googlePickerOpening.value = true
  try {
    await ensureGooglePickerLoaded()
    const { accessToken } = await $fetch<{ accessToken: string }>('/api/integration/google-drive/picker-token')
    openGoogleDrivePickerInstance(accessToken)
  } catch (error: any) {
    console.error('[ChatShell] Failed to open Google Drive picker', error)
    toast.add({
      title: 'Unable to open Google Drive',
      description: error?.data?.statusMessage || error?.message || 'Please try again after reconnecting the integration.',
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
  } finally {
    googlePickerOpening.value = false
  }
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
  const target = localePath({ path: '/signup', query: { redirect } })
  router.push(target)
}

const handleAgentModeSignIn = () => {
  showAgentModeLoginModal.value = false
  const redirect = route.fullPath || '/'
  const target = localePath({ path: '/signin', query: { redirect } })
  router.push(target)
}

const handlePromptSubmit = async (value?: string, selections?: Array<{ type: 'file' | 'content' | 'section' | 'source', id: string, label?: string, identifier?: string }>) => {
  const input = typeof value === 'string' ? value : prompt.value
  const trimmed = input.trim()
  if (!trimmed)
    return

  promptSubmitting.value = true
  prompt.value = ''
  try {
    await sendMessage(trimmed, { referenceSelections: selections, contentId: props.contentId || null })
  } catch (error) {
    prompt.value = trimmed
    console.error('Failed to send prompt', error)
    toast.add({
      title: 'Unable to send message',
      description: error instanceof Error ? error.message : 'Please try again.',
      color: 'error'
    })
    return
  } finally {
    promptSubmitting.value = false
  }
}

const handleStopStreaming = () => {
  const stopped = stopResponse()
  if (stopped) {
    promptSubmitting.value = false
  }
}

const handleImageUploadClick = () => {
  console.log('[ChatShell] Image upload clicked, fileInputRef:', fileInputRef.value)
  if (fileInputRef.value) {
    fileInputRef.value.click()
  } else {
    console.error('[ChatShell] fileInputRef is null!')
  }
}

const uploadMenuDisabled = computed(() => {
  return !isAuthenticatedUser.value || isBusy.value || promptSubmitting.value
})

const uploadMenuItems = computed(() => [
  {
    label: 'Upload Images',
    icon: 'i-lucide-upload',
    onSelect: handleImageUploadClick
  },
  {
    label: hasGoogleDrive.value ? 'Import from Google Drive' : 'Google Drive (Connect in Settings)',
    icon: 'i-simple-icons-googledrive',
    disabled: !hasGoogleDrive.value || googlePickerOpening.value,
    onSelect: handleGoogleDriveClick
  }
])

const { uploading: _fileUploading, uploadMultipleFiles } = useFileManager({
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: ['image/*'],
  contentId: props.contentId || null,
  parallelUploads: true,
  onSuccess: (file) => {
    notifyFileAdded(file as FileRecord, {
      title: 'Image uploaded',
      description: `"${file.originalName || file.fileName}" has been uploaded successfully.`,
      resetInput: true
    })
  },
  onError: (error) => {
    toast.add({
      title: 'Upload failed',
      description: error.message,
      color: 'error',
      icon: 'i-lucide-alert-triangle'
    })
  }
})

const handleFileSelect = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0)
    return

  const selected = Array.from(files).filter(file => file.type.startsWith('image/'))
  if (!selected.length) {
    toast.add({
      title: 'Invalid file type',
      description: 'Please select image files.',
      color: 'error'
    })
    return
  }

  if (selected.length !== files.length) {
    toast.add({
      title: 'Some files skipped',
      description: 'Only image files can be uploaded.',
      color: 'warning'
    })
  }

  try {
    await uploadMultipleFiles(selected)
  } catch (error) {
    console.error('File upload failed:', error)
  }
}

const routeConversationId = computed(() => {
  if (!props.useRouteConversationId)
    return null
  const path = stripLocalePrefix(route.path, KNOWN_LOCALES)
  const match = path.match(/^\/[^/]+\/conversations\/([^/]+)(?:\/|$)/)
  if (!match)
    return null

  const id = route.params.id
  if (Array.isArray(id))
    return id[0] || match[1] || null
  return id || match[1] || null
})

const conversationId = computed(() => {
  // Props take precedence (for embedded/widget use cases)
  if (props.conversationId)
    return props.conversationId
  // Otherwise, derive from route
  if (routeConversationId.value)
    return routeConversationId.value
  // Fallback to active conversation (e.g., when programmatically created)
  return activeConversationId.value
})

const showWelcomeState = computed(() => {
  // Show welcome when at /conversations (no ID) and not busy
  return !conversationId.value && !isBusy.value && !promptSubmitting.value
})

const isValidUUID = (id: string | null): boolean => {
  if (!id)
    return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

const resolveContentPath = (slug: string, contentId: string) => {
  return localePath(`/${slug}/content/${contentId}`)
}

watch([latestCreated, () => activeOrg.value?.data?.slug, isBusy], ([created, slug, busy]) => {
  if (!props.syncRoute) {
    return
  }
  if (busy) {
    return
  }
  if (!created || !slug) {
    return
  }
  if (lastAutoOpenedContentId.value === created.contentId) {
    return
  }

  const targetPath = stripLocalePrefix(resolveContentPath(slug, created.contentId), KNOWN_LOCALES)
  const currentPath = stripLocalePrefix(route.path, KNOWN_LOCALES)
  if (currentPath === targetPath) {
    lastAutoOpenedContentId.value = created.contentId
    return
  }

  lastAutoOpenedContentId.value = created.contentId
  router.push(resolveContentPath(slug, created.contentId))
})

interface ContentConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  payload?: Record<string, any> | null
  createdAt: string | Date
}

const loadConversationMessages = async (conversationId: string, options?: { force?: boolean }) => {
  if (!conversationId || conversationId === 'new' || !isValidUUID(conversationId))
    return

  const cached = getCachedMessagesMeta(conversationId)
  if (cached) {
    hydrateConversation({ conversationId, messages: cached.messages }, { skipCache: true })
  }

  const shouldFetch = options?.force || !cached || cached.isStale
  if (!shouldFetch)
    return

  const myToken = ++conversationLoadToken.value

  try {
    const messagesResponse = await $fetch<{ data: ContentConversationMessage[] }>(`/api/conversations/${conversationId}/messages`)
    if (myToken !== conversationLoadToken.value || conversationId !== activeConversationId.value)
      return
    const converted = (messagesResponse.data || []).map((msg) => {
      const createdAt = msg.createdAt instanceof Date ? msg.createdAt : new Date(msg.createdAt)
      const text = msg.content || ''
      return {
        id: msg.id,
        role: msg.role,
        parts: [{ type: 'text' as const, text }],
        createdAt,
        payload: msg.payload ?? null
      }
    }) as ChatMessage[]

    hydrateConversation({ conversationId, messages: converted })
  } catch (error: any) {
    const statusCode = error?.statusCode || error?.response?.status || error?.data?.statusCode
    const statusMessage = error?.data?.statusMessage || error?.statusMessage || error?.message
    const isNotFound = statusCode === 404 || statusMessage === 'Conversation not found'

    if (isNotFound) {
      const slugParam = route.params.slug
      const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam
      resetConversation()
      activeConversationId.value = null
      if (props.syncRoute) {
        if (slug) {
          await navigateTo(localePath(`/${slug}/conversations`))
        } else {
          await navigateTo(localePath('/'))
        }
      } else {
        toast.add({
          title: 'Conversation unavailable',
          description: 'That conversation could not be found. Starting a new chat.',
          color: 'error',
          icon: 'i-lucide-alert-triangle'
        })
      }
      return
    }

    if (!cached) {
      console.error('Unable to load conversation messages', error)
      toast.add({
        title: 'Failed to load messages',
        description: 'Unable to load conversation history. Please try refreshing.',
        color: 'error',
        icon: 'i-lucide-alert-triangle'
      })
    }
  }
}

const requestConversationMessages = async (conversationId: string, options?: { force?: boolean }) => {
  // Always try to hydrate from cache immediately, even if not visible
  // This ensures the UI updates right away when navigating
  const cached = getCachedMessagesMeta(conversationId)
  if (cached && !cached.isStale) {
    hydrateConversation({ conversationId, messages: cached.messages }, { skipCache: true })
  }

  // Always load immediately (avoid deferring loads behind element-visibility;
  // it can be flaky with nested overflow containers and causes stale conversations to stick)
  pendingConversationLoad.value = null
  await loadConversationMessages(conversationId, options)
}

const switchingConversation = ref(false)

const loadConversationById = async (targetId: string | null) => {
  if (switchingConversation.value)
    return

  if (!targetId) {
    if (activeConversationId.value) {
      pendingConversationLoad.value = null
      activeConversationId.value = null
      resetConversation()
    }
    return
  }

  if (!isValidUUID(targetId))
    return

  switchingConversation.value = true
  try {
    pendingConversationLoad.value = null
    resetConversation()
    activeConversationId.value = targetId
    await requestConversationMessages(targetId, { force: true })
  } catch (error) {
    console.error('Failed to load conversation history', error)
  } finally {
    switchingConversation.value = false
  }
}

watch(() => props.conversationId, (next, previous) => {
  if (next === previous)
    return
  loadConversationById(next ?? null)
}, { immediate: true })

watch(routeConversationId, (next, previous) => {
  if (next === previous)
    return
  if (props.conversationId)
    return
  loadConversationById(next)
}, { immediate: true })

const getMessageText = (message: ChatMessage) => {
  return (message.parts || [])
    .filter((part): part is { type: 'text', text: string } => part.type === 'text' && typeof (part as any).text === 'string')
    .map(part => part.text)
    .join('')
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
  if (isBusy.value)
    return

  const text = getMessageText(message).trim()
  if (!text) {
    toast.add({
      title: 'Cannot regenerate',
      description: 'This message has no text to resend.',
      color: 'error'
    })
    return
  }

  await handlePromptSubmit(text)
}

async function handleSendAgain(message: ChatMessage) {
  if (isBusy.value)
    return

  const text = getMessageText(message)
  if (!text)
    return

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
        description: 'Message sent to your share target.'
      })
      return
    }
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError'
    if (isAbort) {
      toast.add({
        title: 'Share cancelled',
        color: 'neutral'
      })
      return
    }
    console.warn('Navigator share failed, falling back to copy', error)
  }

  try {
    await copy(text)
    toast.add({
      title: 'Copied to clipboard',
      description: 'Message copied for sharing.',
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

if (import.meta.client) {
  watch(mode, (newMode) => {
    if (newMode === 'agent' && !isAuthenticatedUser.value) {
      mode.value = 'chat'
      showAgentModeLoginModal.value = true
    }
  })
}
</script>

<template>
  <div
    ref="chatContainerRef"
    class="w-full flex flex-col h-full min-h-0 overflow-hidden"
  >
    <div
      v-if="props.showMessages"
      class="w-full flex-1 min-h-0 flex flex-col px-3 py-3"
    >
      <div class="w-full flex-1 min-h-0">
        <h1
          v-if="showWelcomeState"
          class="hidden lg:block text-3xl font-semibold text-center px-4"
        >
          What would you like to write today?
        </h1>

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
      </div>
    </div>

    <div
      class="w-full flex flex-col justify-center overflow-x-hidden mt-auto border-t border-neutral-200/70 dark:border-neutral-800/60 px-3 py-2 touch-manipulation"
    >
      <div class="w-full">
        <PromptComposer
          v-model="prompt"
          placeholder="Paste a transcript or describe what you need..."
          :disabled="isBusy || promptSubmitting"
          :status="promptSubmitting ? 'submitted' : uiStatus"
          :content-id="props.contentId"
          :mode="mode"
          @submit="handlePromptSubmit"
          @stop="handleStopStreaming"
        >
          <template #footer>
            <div class="flex items-center gap-2">
              <UDropdownMenu
                v-if="!isBusy && !promptSubmitting"
                :items="uploadMenuItems"
              >
                <component
                  :is="uploadMenuDisabled ? 'UTooltip' : 'div'"
                  v-bind="uploadMenuDisabled ? { text: 'Sign in to upload images' } : {}"
                >
                  <UButton
                    type="button"
                    icon="i-lucide-plus"
                    size="sm"
                    variant="ghost"
                    color="neutral"
                    :disabled="uploadMenuDisabled"
                  />
                </component>
              </UDropdownMenu>
              <input
                ref="fileInputRef"
                type="file"
                accept="image/*"
                class="hidden"
                multiple
                @change="handleFileSelect"
              >
              <component
                :is="!isAuthenticatedUser ? 'UTooltip' : 'div'"
                v-bind="!isAuthenticatedUser ? { text: 'Sign in to unlock agent mode' } : {}"
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
                      :class="{ 'opacity-50': mode === 'agent' && !isAuthenticatedUser }"
                    />
                  </template>
                </UInputMenu>
              </component>
            </div>
          </template>
        </PromptComposer>

        <i18n-t
          v-if="!isAuthenticatedUser"
          keypath="global.legal.chatDisclaimer"
          tag="p"
          class="text-xs text-muted-600 dark:text-muted-400 text-center mt-2"
        >
          <template #terms>
            <NuxtLink
              :to="localePath('/terms')"
              class="underline hover:text-primary-600 dark:hover:text-primary-400"
            >
              {{ $t('global.legal.terms') }}
            </NuxtLink>
          </template>
          <template #privacy>
            <NuxtLink
              :to="localePath('/privacy')"
              class="underline hover:text-primary-600 dark:hover:text-primary-400"
            >
              {{ $t('global.legal.privacyPolicy') }}
            </NuxtLink>
          </template>
        </i18n-t>
      </div>
    </div>

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
