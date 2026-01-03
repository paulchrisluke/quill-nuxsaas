<script setup lang="ts">
import { GITHUB_INTEGRATION_SCOPES } from '#shared/constants/githubScopes'
import { GOOGLE_INTEGRATION_SCOPES } from '#shared/constants/googleScopes'

const { formatDateRelative } = useDate()

definePageMeta({
  layout: 'settings'
})

useHead({
  title: 'Integrations'
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Integrations')

const currentRoute = useRoute()
const router = useRouter()
const slug = computed(() => currentRoute.params.slug as string)
const toast = useToast()

const { user, useActiveOrganization, refreshActiveOrg } = useAuth()
const activeOrg = useActiveOrganization()
const hasActiveOrg = computed(() => Boolean(activeOrg.value?.data?.id))

const youtubeScopes = [...GOOGLE_INTEGRATION_SCOPES.youtube]
const googleDriveScopes = [...GOOGLE_INTEGRATION_SCOPES.google_drive]
const githubScopes = [...GITHUB_INTEGRATION_SCOPES.github]

const organizationId = computed(() => activeOrg.value?.data?.id ?? null)
interface OrgMember {
  userId?: string | null
  name?: string | null
  email?: string | null
  role?: string | null
}

const members = computed<OrgMember[]>(() => activeOrg.value?.data?.members ?? [])

const currentUserRole = computed(() => {
  if (!members.value.length || !user.value?.id)
    return null

  return members.value.find(member => member.userId === user.value!.id)?.role ?? null
})

const canManageIntegrations = computed(() => {
  return currentUserRole.value === 'owner' || currentUserRole.value === 'admin'
})

watch(
  () => user.value?.id,
  async (id) => {
    if (!id)
      return
    await refreshActiveOrg()
  },
  { immediate: true }
)

const {
  data: integrationsResponse,
  pending,
  error,
  refresh
} = await useFetch(() => '/api/organization/integrations', {
  key: () => `org-integrations-${organizationId.value || 'none'}`,
  watch: [organizationId]
})

// Handle both array (legacy) and object (new) response formats
const integrations = computed(() => {
  const value = integrationsResponse.value
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value
  }
  if (value && typeof value === 'object' && 'data' in value) {
    return Array.isArray(value.data) ? value.data : []
  }
  return []
})

const youtubeIntegration = computed(() => {
  const list = integrations.value || []
  return list.find(item => item.provider === 'youtube') || null
})

const googleDriveIntegration = computed(() => {
  const list = integrations.value || []
  return list.find(item => item.provider === 'google_drive') || null
})

const githubIntegration = computed(() => {
  const list = integrations.value || []
  return list.find(item => item.provider === 'github') || null
})

const youtubeIntegrationStatus = computed(() => {
  const integration = youtubeIntegration.value
  if (!integration)
    return 'disconnected'
  if (!('status' in integration) || integration.status == null)
    return 'unknown'
  return integration.status
})

const googleDriveIntegrationStatus = computed(() => {
  const integration = googleDriveIntegration.value
  if (!integration)
    return 'disconnected'
  if (!('status' in integration) || integration.status == null)
    return 'unknown'
  return integration.status
})

const githubIntegrationStatus = computed(() => {
  const integration = githubIntegration.value
  if (!integration)
    return 'disconnected'
  if (!('status' in integration) || integration.status == null)
    return 'unknown'
  return integration.status
})

const githubConfig = reactive({
  publishEnabled: false,
  repoFullName: '',
  baseBranch: 'main',
  contentPath: '',
  jsonPath: '',
  branchPrefix: 'quillio/publish',
  prTitle: '',
  prBody: 'Automated publish from Quillio.',
  importRepoFullName: '',
  importBaseBranch: 'main',
  importContentPath: '',
  importStatus: 'draft'
})
const githubConfigReady = ref(false)
const githubConfigSaving = ref(false)
const githubImportLoading = ref(false)

const youtubeConnectedByUser = computed(() => {
  const integration = youtubeIntegration.value
  if (!integration?.connectedByUserId)
    return null
  return members.value.find(member => member.userId === integration.connectedByUserId) || null
})

const googleDriveConnectedByUser = computed(() => {
  const integration = googleDriveIntegration.value
  if (!integration?.connectedByUserId)
    return null
  return members.value.find(member => member.userId === integration.connectedByUserId) || null
})

const githubConnectedByUser = computed(() => {
  const integration = githubIntegration.value
  if (!integration?.connectedByUserId)
    return null
  return members.value.find(member => member.userId === integration.connectedByUserId) || null
})

watch(githubIntegration, (integration) => {
  if (!integration)
    return
  const config = integration.config && typeof integration.config === 'object' ? integration.config : {}
  const publish = config.publish && typeof config.publish === 'object' ? config.publish : {}
  const importConfig = config.import && typeof config.import === 'object' ? config.import : {}

  githubConfig.publishEnabled = Boolean(publish.enabled)
  githubConfig.repoFullName = publish.repoFullName || config.repoFullName || ''
  githubConfig.baseBranch = publish.baseBranch || 'main'
  githubConfig.contentPath = publish.contentPath || ''
  githubConfig.jsonPath = publish.jsonPath || ''
  githubConfig.branchPrefix = publish.branchPrefix || 'quillio/publish'
  githubConfig.prTitle = publish.prTitle || ''
  githubConfig.prBody = publish.prBody || 'Automated publish from Quillio.'

  githubConfig.importRepoFullName = importConfig.repoFullName || publish.repoFullName || config.repoFullName || ''
  githubConfig.importBaseBranch = importConfig.baseBranch || publish.baseBranch || 'main'
  githubConfig.importContentPath = importConfig.contentPath || publish.contentPath || ''
  githubConfig.importStatus = importConfig.status || 'draft'

  githubConfigReady.value = true
}, { immediate: true })

const connectLoading = reactive({
  youtube: false,
  google_drive: false,
  github: false
})
const disconnectLoading = reactive({
  youtube: false,
  google_drive: false,
  github: false
})

function assertOrgId() {
  if (!organizationId.value) {
    throw new Error('Active organization not found.')
  }
}

async function connectYoutube() {
  if (!import.meta.client)
    return
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  connectLoading.youtube = true
  try {
    const callbackURL = `${window.location.origin}/${slug.value}/integrations?connected=youtube`
    const response = await $fetch<{
      url?: string
      redirect?: boolean
    }>('/api/auth/link-social', {
      method: 'POST',
      body: {
        provider: 'google',
        scopes: youtubeScopes,
        callbackURL,
        disableRedirect: true
      }
    })

    if (!response?.url) {
      toast.add({
        title: 'Unable to start YouTube connection',
        description: 'Please try again in a few moments.',
        color: 'error'
      })
      return
    }

    const redirectUrl = new URL(response.url)
    redirectUrl.searchParams.set('prompt', 'consent')
    redirectUrl.searchParams.set('access_type', 'offline')
    redirectUrl.searchParams.set('include_granted_scopes', 'true')

    window.location.href = redirectUrl.toString()
  } catch (error: any) {
    toast.add({
      title: 'Error connecting YouTube',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    connectLoading.youtube = false
  }
}

async function connectGoogleDrive() {
  if (!import.meta.client)
    return
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  connectLoading.google_drive = true
  try {
    const callbackURL = `${window.location.origin}/${slug.value}/integrations?connected=google_drive`
    const response = await $fetch<{
      url?: string
      redirect?: boolean
    }>('/api/auth/link-social', {
      method: 'POST',
      body: {
        provider: 'google',
        scopes: googleDriveScopes,
        callbackURL,
        disableRedirect: true
      }
    })

    if (!response?.url) {
      toast.add({
        title: 'Unable to start Google Drive connection',
        description: 'Please try again in a few moments.',
        color: 'error'
      })
      return
    }

    const redirectUrl = new URL(response.url)
    redirectUrl.searchParams.set('prompt', 'consent')
    redirectUrl.searchParams.set('access_type', 'offline')
    redirectUrl.searchParams.set('include_granted_scopes', 'true')

    window.location.href = redirectUrl.toString()
  } catch (error: any) {
    toast.add({
      title: 'Error connecting Google Drive',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    connectLoading.google_drive = false
  }
}

async function connectGithub() {
  if (!import.meta.client)
    return
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  connectLoading.github = true
  try {
    const callbackURL = `${window.location.origin}/${slug.value}/integrations?connected=github`
    const response = await $fetch<{
      url?: string
      redirect?: boolean
    }>('/api/auth/link-social', {
      method: 'POST',
      body: {
        provider: 'github',
        scopes: githubScopes,
        callbackURL,
        disableRedirect: true
      }
    })

    if (!response?.url) {
      toast.add({
        title: 'Unable to start GitHub connection',
        description: 'Please try again in a few moments.',
        color: 'error'
      })
      return
    }

    window.location.href = response.url
  } catch (error: any) {
    toast.add({
      title: 'Error connecting GitHub',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    connectLoading.github = false
  }
}

async function saveGithubConfig() {
  if (!githubIntegration.value) {
    toast.add({ title: 'GitHub not connected', description: 'Connect GitHub before saving settings.', color: 'error' })
    return
  }
  githubConfigSaving.value = true
  try {
    const existingConfig = (githubIntegration.value.config && typeof githubIntegration.value.config === 'object')
      ? githubIntegration.value.config
      : {}

    const payload = {
      ...existingConfig,
      publish: {
        enabled: githubConfig.publishEnabled,
        repoFullName: githubConfig.repoFullName,
        baseBranch: githubConfig.baseBranch,
        contentPath: githubConfig.contentPath,
        jsonPath: githubConfig.jsonPath || githubConfig.contentPath,
        branchPrefix: githubConfig.branchPrefix,
        prTitle: githubConfig.prTitle || undefined,
        prBody: githubConfig.prBody || undefined
      },
      import: {
        repoFullName: githubConfig.importRepoFullName || githubConfig.repoFullName,
        baseBranch: githubConfig.importBaseBranch || githubConfig.baseBranch,
        contentPath: githubConfig.importContentPath || githubConfig.contentPath,
        status: githubConfig.importStatus
      }
    }

    await $fetch(`/api/organization/integrations/${githubIntegration.value.id}`, {
      method: 'PUT',
      body: {
        config: payload
      }
    })
    toast.add({ title: 'GitHub settings saved', color: 'success' })
    await refresh()
  } catch (error: any) {
    toast.add({
      title: 'Unable to save GitHub settings',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    githubConfigSaving.value = false
  }
}

async function runGithubImport() {
  if (!githubIntegration.value) {
    toast.add({ title: 'GitHub not connected', description: 'Connect GitHub before importing.', color: 'error' })
    return
  }
  githubImportLoading.value = true
  try {
    const response = await $fetch<{
      imported: Array<{ path: string }>
      skipped: Array<{ path: string, reason: string }>
    }>('/api/integration/github/import', {
      method: 'POST',
      body: {
        repoFullName: githubConfig.importRepoFullName || githubConfig.repoFullName,
        contentPath: githubConfig.importContentPath || githubConfig.contentPath,
        baseBranch: githubConfig.importBaseBranch || githubConfig.baseBranch,
        status: githubConfig.importStatus
      }
    })

    toast.add({
      title: 'GitHub import complete',
      description: `Imported ${response.imported?.length || 0} files, skipped ${response.skipped?.length || 0}.`,
      color: 'success'
    })
  } catch (error: any) {
    toast.add({
      title: 'GitHub import failed',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    githubImportLoading.value = false
  }
}

async function disconnectYoutube() {
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  // eslint-disable-next-line no-alert
  const confirmed = window.confirm('Disconnecting will revoke caption access until you reconnect. Continue?')
  if (!confirmed)
    return

  disconnectLoading.youtube = true
  try {
    await $fetch('/api/organization/integration/disconnect', {
      method: 'DELETE',
      query: {
        organizationId: organizationId.value!,
        provider: 'youtube'
      }
    })
    toast.add({ title: 'YouTube disconnected', color: 'success' })
    await refresh()
  } catch (error: any) {
    toast.add({
      title: 'Error disconnecting YouTube',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    disconnectLoading.youtube = false
  }
}

async function disconnectGoogleDrive() {
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  // eslint-disable-next-line no-alert
  const confirmed = window.confirm('Disconnecting will remove Codex access to Drive and Docs until you reconnect. Continue?')
  if (!confirmed)
    return

  disconnectLoading.google_drive = true
  try {
    await $fetch('/api/organization/integration/disconnect', {
      method: 'DELETE',
      query: {
        organizationId: organizationId.value!,
        provider: 'google_drive'
      }
    })
    toast.add({ title: 'Google Drive disconnected', color: 'success' })
    await refresh()
  } catch (error: any) {
    toast.add({
      title: 'Error disconnecting Google Drive',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    disconnectLoading.google_drive = false
  }
}

async function disconnectGithub() {
  try {
    assertOrgId()
  } catch (error: any) {
    toast.add({ title: 'Organization unavailable', description: error?.message, color: 'error' })
    return
  }

  // eslint-disable-next-line no-alert
  const confirmed = window.confirm('Disconnecting will remove Codex access to GitHub repositories until you reconnect. Continue?')
  if (!confirmed)
    return

  disconnectLoading.github = true
  try {
    await $fetch('/api/organization/integration/disconnect', {
      method: 'DELETE',
      query: {
        organizationId: organizationId.value!,
        provider: 'github'
      }
    })
    toast.add({ title: 'GitHub disconnected', color: 'success' })
    await refresh()
  } catch (error: any) {
    toast.add({
      title: 'Error disconnecting GitHub',
      description: error?.data?.statusMessage || error?.message || 'Unexpected error occurred.',
      color: 'error'
    })
  } finally {
    disconnectLoading.github = false
  }
}

if (import.meta.client) {
  const stripConnectedQuery = () => {
    const newQuery = { ...currentRoute.query }
    delete newQuery.connected
    router.replace({ path: currentRoute.path, query: newQuery }).catch((error) => {
      // Avoid blowing up the page if a navigation race occurs; log for debugging instead.
      console.warn('[integrations] Unable to strip ?connected query param', error)
    })
  }

  onMounted(() => {
    watch(
      () => currentRoute.query.connected,
      (value) => {
        const possibleValues = Array.isArray(value) ? value : value ? [value] : []
        const provider = possibleValues.find(item => item === 'youtube' || item === 'google_drive' || item === 'github')
        if (!provider)
          return

        const messages = {
          youtube: {
            title: 'YouTube connected',
            description: 'You can now get transcripts from your own YouTube videos automatically.'
          },
          google_drive: {
            title: 'Google Drive connected',
            description: 'Docs can now be imported without copying content manually.'
          },
          github: {
            title: 'GitHub connected',
            description: 'Repositories can now be synced without manual exports.'
          }
        } as const

        const message = messages[provider as keyof typeof messages]
        toast.add({
          title: message.title,
          description: message.description,
          color: 'success'
        })
        // Force refresh integrations data with sync to show the newly connected integration
        // Use force_sync=true to bypass cooldown and immediately sync the new connection
        console.log('[integrations] Triggering force sync for provider:', provider)
        $fetch('/api/organization/integrations?force_sync=true').then((response) => {
          console.log('[integrations] Force sync response:', response)
          // Update the integrationsResponse with the new data
          integrationsResponse.value = response as any
        }).catch((error) => {
          console.error('[integrations] Failed to refresh after connection', error)
          // Fallback to regular refresh if force sync fails
          refresh()
        })
        stripConnectedQuery()
      },
      { immediate: true }
    )
  })
}
</script>

<template>
  <UContainer class="py-10">
    <div class="space-y-8">
      <div class="space-y-1">
        <h1 class="text-3xl font-semibold">
          Integrations
        </h1>
        <p class="text-muted-500">
          Connect Codex to YouTube, Google Drive, and GitHub. Get transcripts from your own YouTube videos, import Google Docs, and sync GitHub repositories automatically.
        </p>
      </div>

      <UAlert
        v-if="hasActiveOrg && !canManageIntegrations"
        icon="i-lucide-lock"
        color="neutral"
        variant="subtle"
        title="You need admin or owner access to manage integrations."
      />

      <div class="grid gap-4">
        <UCard>
          <template #header>
            <div class="flex items-center gap-3">
              <UAvatar
                icon="i-simple-icons-youtube"
                color="primary"
                size="md"
              />
              <div>
                <p class="text-lg font-medium">
                  YouTube
                </p>
                <p class="text-sm text-muted-500">
                  Get transcripts from your own YouTube videos automatically.
                </p>
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted-500">
                Status
              </span>
              <UBadge
                :color="youtubeIntegrationStatus === 'connected' ? 'primary' : youtubeIntegrationStatus === 'expired' ? 'warning' : 'neutral'"
                variant="soft"
                size="xs"
                class="capitalize"
              >
                {{ youtubeIntegrationStatus }}
              </UBadge>
            </div>

            <div class="rounded-lg border border-dashed border-muted-200/70 p-3 text-sm text-muted-500 space-y-1">
              <p v-if="youtubeIntegration && youtubeConnectedByUser">
                Connected by <strong>{{ youtubeConnectedByUser.name || youtubeConnectedByUser.email }}</strong>
              </p>
              <p v-else-if="youtubeIntegration">
                Connected by <strong>{{ youtubeIntegration.connectedByUserName || youtubeIntegration.connectedByUserEmail || 'Unknown user' }}</strong>
              </p>
              <p>
                Last updated:
                <strong>
                  {{ formatDateRelative(youtubeIntegration?.updatedAt, { includeTime: true }) }}
                </strong>
              </p>
            </div>

            <UAlert
              icon="i-lucide-info"
              color="neutral"
              variant="subtle"
              title="Note"
              description="You can only get transcripts from videos you own. Videos from other channels are not accessible."
            />

            <div class="flex flex-wrap gap-3">
              <UButton
                color="primary"
                :disabled="!canManageIntegrations"
                :loading="connectLoading.youtube"
                @click="connectYoutube"
              >
                {{ youtubeIntegration ? 'Reconnect' : 'Connect YouTube' }}
              </UButton>

              <UButton
                v-if="youtubeIntegration"
                color="neutral"
                variant="ghost"
                :disabled="!canManageIntegrations"
                :loading="disconnectLoading.youtube"
                @click="disconnectYoutube"
              >
                Disconnect
              </UButton>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-3">
              <UAvatar
                icon="i-lucide-github"
                color="primary"
                size="md"
              />
              <div>
                <p class="text-lg font-medium">
                  GitHub Repos
                </p>
                <p class="text-sm text-muted-500">
                  Required for syncing private repositories into Codex.
                </p>
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted-500">
                Status
              </span>
              <UBadge
                :color="githubIntegrationStatus === 'connected' ? 'primary' : githubIntegrationStatus === 'expired' ? 'warning' : 'neutral'"
                variant="soft"
                size="xs"
                class="capitalize"
              >
                {{ githubIntegrationStatus }}
              </UBadge>
            </div>

            <div class="rounded-lg border border-dashed border-muted-200/70 p-3 text-sm text-muted-500 space-y-1">
              <p v-if="githubIntegration && githubConnectedByUser">
                Connected by <strong>{{ githubConnectedByUser.name || githubConnectedByUser.email }}</strong>
              </p>
              <p v-else-if="githubIntegration">
                Connected by <strong>{{ githubIntegration.connectedByUserName || githubIntegration.connectedByUserEmail || 'Unknown user' }}</strong>
              </p>
              <p>
                Last updated:
                <strong>
                  {{ formatDateRelative(githubIntegration?.updatedAt, { includeTime: true }) }}
                </strong>
              </p>
            </div>

            <div
              v-if="githubIntegration && githubConfigReady"
              class="space-y-4 rounded-lg border border-muted-200/70 p-4"
            >
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium">
                  Publish & Import Settings
                </p>
                <UCheckbox
                  v-model="githubConfig.publishEnabled"
                  label="Enable publish PRs"
                />
              </div>

              <div class="space-y-3">
                <p class="text-sm font-medium">
                  Publish Settings
                </p>
                <div class="grid gap-3 sm:grid-cols-2">
                  <UFormField label="Repository">
                    <UInput
                      v-model="githubConfig.repoFullName"
                      placeholder="owner/repo"
                    />
                  </UFormField>
                  <UFormField label="Base branch">
                    <UInput
                      v-model="githubConfig.baseBranch"
                      placeholder="main"
                    />
                  </UFormField>
                  <UFormField label="Content path">
                    <UInput
                      v-model="githubConfig.contentPath"
                      placeholder="tenants/northcarolinalegalservices/articles"
                    />
                  </UFormField>
                  <UFormField label="JSON export path">
                    <UInput
                      v-model="githubConfig.jsonPath"
                      placeholder="tenants/northcarolinalegalservices/articles"
                    />
                  </UFormField>
                  <UFormField label="Branch prefix">
                    <UInput
                      v-model="githubConfig.branchPrefix"
                      placeholder="quillio/publish"
                    />
                  </UFormField>
                  <UFormField label="PR title (optional)">
                    <UTextarea
                      v-model="githubConfig.prTitle"
                      placeholder="Publish: Content update"
                    />
                  </UFormField>
                  <UFormField label="PR body (optional)">
                    <UTextarea
                      v-model="githubConfig.prBody"
                      placeholder="Automated publish from Quillio."
                    />
                  </UFormField>
                </div>
              </div>

              <div class="space-y-3">
                <p class="text-sm font-medium">
                  Import Settings
                </p>
                <div class="grid gap-3 sm:grid-cols-2">
                  <UFormField label="Import repository">
                    <UInput
                      v-model="githubConfig.importRepoFullName"
                      placeholder="owner/repo"
                    />
                  </UFormField>
                  <UFormField label="Import branch">
                    <UInput
                      v-model="githubConfig.importBaseBranch"
                      placeholder="main"
                    />
                  </UFormField>
                  <UFormField label="Import path">
                    <UInput
                      v-model="githubConfig.importContentPath"
                      placeholder="tenants/northcarolinalegalservices/articles"
                    />
                  </UFormField>
                  <UFormField label="Import status">
                    <USelect
                      v-model="githubConfig.importStatus"
                      :options="['draft', 'published']"
                      placeholder="Select status"
                    />
                  </UFormField>
                </div>
              </div>

              <div class="flex flex-wrap gap-3">
                <UButton
                  color="primary"
                  :disabled="!canManageIntegrations"
                  :loading="githubConfigSaving"
                  @click="saveGithubConfig"
                >
                  Save GitHub settings
                </UButton>
                <UButton
                  color="neutral"
                  variant="soft"
                  :disabled="!canManageIntegrations"
                  :loading="githubImportLoading"
                  @click="runGithubImport"
                >
                  Import markdown now
                </UButton>
              </div>
            </div>

            <div class="flex flex-wrap gap-3">
              <UButton
                color="primary"
                :disabled="!canManageIntegrations"
                :loading="connectLoading.github"
                @click="connectGithub"
              >
                {{ githubIntegration ? 'Reconnect' : 'Connect GitHub' }}
              </UButton>

              <UButton
                v-if="githubIntegration"
                color="neutral"
                variant="ghost"
                :disabled="!canManageIntegrations"
                :loading="disconnectLoading.github"
                @click="disconnectGithub"
              >
                Disconnect
              </UButton>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-3">
              <UAvatar
                icon="i-simple-icons-googledrive"
                color="primary"
                size="md"
              />
              <div>
                <p class="text-lg font-medium">
                  Google Drive & Docs
                </p>
                <p class="text-sm text-muted-500">
                  Required for importing shared Google Docs without copy/paste.
                </p>
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted-500">
                Status
              </span>
              <UBadge
                :color="googleDriveIntegrationStatus === 'connected' ? 'primary' : googleDriveIntegrationStatus === 'expired' ? 'warning' : 'neutral'"
                variant="soft"
                size="xs"
                class="capitalize"
              >
                {{ googleDriveIntegrationStatus }}
              </UBadge>
            </div>

            <div class="rounded-lg border border-dashed border-muted-200/70 p-3 text-sm text-muted-500 space-y-1">
              <p v-if="googleDriveIntegration && googleDriveConnectedByUser">
                Connected by <strong>{{ googleDriveConnectedByUser.name || googleDriveConnectedByUser.email }}</strong>
              </p>
              <p v-else-if="googleDriveIntegration">
                Connected by <strong>{{ googleDriveIntegration.connectedByUserName || googleDriveIntegration.connectedByUserEmail || 'Unknown user' }}</strong>
              </p>
              <p>
                Last updated:
                <strong>
                  {{ formatDateRelative(googleDriveIntegration?.updatedAt, { includeTime: true }) }}
                </strong>
              </p>
            </div>

            <div class="flex flex-wrap gap-3">
              <UButton
                color="primary"
                :disabled="!canManageIntegrations"
                :loading="connectLoading.google_drive"
                @click="connectGoogleDrive"
              >
                {{ googleDriveIntegration ? 'Reconnect' : 'Connect Google Drive' }}
              </UButton>

              <UButton
                v-if="googleDriveIntegration"
                color="neutral"
                variant="ghost"
                :disabled="!canManageIntegrations"
                :loading="disconnectLoading.google_drive"
                @click="disconnectGoogleDrive"
              >
                Disconnect
              </UButton>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <p class="text-lg font-medium">
              How it works
            </p>
          </template>

          <ol class="space-y-3 text-sm text-muted-500">
            <li>
              1. Click <strong>Connect</strong> on the integration you need and sign in with the account that has access.
            </li>
            <li>
              2. Approve the requested scopes so Codex can read captions, Google Docs, or GitHub repositories (read-only unless stated otherwise).
            </li>
            <li>
              3. Once connected, teammates can share YouTube links, Google Docs, or GitHub repos and Codex will ingest them automatically.
            </li>
            <li>
              4. If a token expires, reconnect to refresh the consent with the provider.
            </li>
          </ol>
        </UCard>
      </div>

      <UAlert
        v-if="error"
        icon="i-lucide-alert-triangle"
        color="error"
        variant="subtle"
        :description="error?.message || 'Unable to load current integrations.'"
      />

      <div
        v-else-if="pending"
        class="space-y-3"
      >
        <USkeleton
          v-for="index in 4"
          :key="index"
          class="h-16 rounded-lg border border-muted-200/70"
        />
      </div>
    </div>
  </UContainer>
</template>
