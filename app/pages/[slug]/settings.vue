<script setup lang="ts">
import { useClipboard } from '@vueuse/core'

definePageMeta({
  layout: 'dashboard'
})

const { organization, useActiveOrganization, fetchSession, user, client } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { copy } = useClipboard()

// API Keys State
const apiKeys = ref<any[]>([])
const apiKeysLoading = ref(false)
const isCreateKeyModalOpen = ref(false)
const newKeyName = ref('')
const newKeyExpiresIn = ref<number | undefined>(undefined) // Default never? or 30 days?
const createdKey = ref<string | null>(null)
const createKeyLoading = ref(false)

async function fetchApiKeys() {
  if (!activeOrg.value?.data?.id)
    return
  apiKeysLoading.value = true
  try {
    const { data } = await client.apiKey.list()
    if (data) {
      // Filter for this org using metadata
      apiKeys.value = data.filter((k: any) => {
        const meta = k.metadata ? (typeof k.metadata === 'string' ? JSON.parse(k.metadata) : k.metadata) : {}
        return meta.organizationId === activeOrg.value?.data?.id
      })
    }
  } catch (e) {
    console.error(e)
  } finally {
    apiKeysLoading.value = false
  }
}

async function createApiKey() {
  if (!activeOrg.value?.data?.id || !newKeyName.value)
    return
  createKeyLoading.value = true
  try {
    const { data, error } = await client.apiKey.create({
      name: newKeyName.value,
      expiresIn: newKeyExpiresIn.value,
      metadata: {
        organizationId: activeOrg.value.data.id
      }
    })
    if (error)
      throw error

    if (data) {
      createdKey.value = data.key
      toast.add({ title: 'API Key created', color: 'success' })
      await fetchApiKeys()
    }
  } catch (e: any) {
    toast.add({ title: 'Error creating API Key', description: e.message, color: 'error' })
  } finally {
    createKeyLoading.value = false
  }
}

async function deleteApiKey(id: string) {
  // eslint-disable-next-line no-alert
  const confirmed = window.confirm('Are you sure you want to delete this API Key?')
  if (!confirmed)
    return

  try {
    await client.apiKey.delete({
      keyId: id
    })
    toast.add({ title: 'API Key deleted', color: 'success' })
    await fetchApiKeys()
  } catch (e: any) {
    toast.add({ title: 'Error deleting API Key', description: e.message, color: 'error' })
  }
}

const copyKey = (key: string) => {
  copy(key)
  toast.add({ title: 'Copied to clipboard' })
}

// Computed permissions
const currentUserRole = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return null
  const member = activeOrg.value.data.members.find(m => m.userId === user.value!.id)
  return member?.role
})

const canUpdateSettings = computed(() => {
  return currentUserRole.value === 'owner' || currentUserRole.value === 'admin'
})

// Fetch keys on mount if allowed
onMounted(() => {
  if (canUpdateSettings.value) {
    fetchApiKeys()
  }
})

const canDeleteTeam = computed(() => {
  return currentUserRole.value === 'owner'
})

// Leave team logic
const leaveLoading = ref(false)
const canLeaveTeam = computed(() => {
  // Owners cannot leave (must delete or transfer), others can
  return currentUserRole.value !== 'owner'
})

async function leaveTeam() {
  if (!activeOrg.value?.data?.id)
    return

  // eslint-disable-next-line no-alert
  const confirmed = window.confirm(`Are you sure you want to leave "${activeOrg.value.data.name}"?`)
  if (!confirmed)
    return

  leaveLoading.value = true
  try {
    const { error } = await organization.leave({
      organizationId: activeOrg.value.data.id
    })
    if (error)
      throw error

    toast.add({ title: 'Left team successfully', color: 'success' })

    // Refresh and redirect
    const { data: orgs } = await organization.list()
    if (orgs && orgs.length > 0) {
      await organization.setActive({ organizationId: orgs[0].id })
      await fetchSession()
      window.location.href = `/${orgs[0].slug}/dashboard`
    } else {
      window.location.href = '/onboarding'
    }
  } catch (e: any) {
    toast.add({ title: 'Error leaving team', description: e.message, color: 'error' })
  } finally {
    leaveLoading.value = false
  }
}

// Organization data is already available via useActiveOrganization()
// No need to fetch it again on page load

const loading = ref(false)
const teamName = ref('')
const teamSlug = ref('')

// Initialize fields immediately from preloaded data or activeOrg
if (activeOrg.value?.data) {
  teamName.value = activeOrg.value.data.name
  teamSlug.value = activeOrg.value.data.slug
}

// Watch for changes
watch(() => activeOrg.value?.data, (newData) => {
  if (newData) {
    // Only update if values match the PREVIOUS org (meaning we switched)
    // Or if we're initializing. We don't want to overwrite user typing.
    // Simplest strategy: If ID changes, update.
    if (newData.name !== teamName.value && newData.id !== activeOrg.value?.data?.id) {
      // This logic is tricky. Let's stick to the previous safe watcher.
    }
  }
}, { deep: true })

// Better watcher: Watch ID changes to handle switching
watch(() => activeOrg.value?.data?.id, (newId) => {
  if (newId && activeOrg.value?.data) {
    teamName.value = activeOrg.value.data.name
    teamSlug.value = activeOrg.value.data.slug
  }
}, { immediate: true })

async function updateTeam() {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true

  try {
    const { error } = await organization.update({
      organizationId: activeOrg.value.data.id,
      data: {
        name: teamName.value,
        slug: teamSlug.value
      }
    })

    if (error)
      throw error

    toast.add({ title: 'Team updated successfully', color: 'success' })
    // Refresh data
    await useAuth().fetchSession()

    // If slug changed, we must redirect to new URL
    // Otherwise reload is fine, but redirection is safer
    window.location.href = `/${teamSlug.value}/settings`
  } catch (e: any) {
    toast.add({
      title: 'Error updating team',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

const copied = ref(false)

const copyId = () => {
  if (activeOrg.value?.data?.id) {
    copy(activeOrg.value.data.id)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
    toast.add({ title: 'Copied to clipboard' })
  }
}

const deleteLoading = ref(false)

async function deleteTeam() {
  if (!activeOrg.value?.data?.id)
    return

  const name = activeOrg.value.data.name
  // TODO: Replace with proper modal confirmation
  // eslint-disable-next-line no-alert
  const confirmed = confirm(
    `Are you sure you want to delete "${name}"? This action cannot be undone and will remove all members and data.`
  )

  if (!confirmed)
    return

  deleteLoading.value = true

  try {
    const { error } = await organization.delete({
      organizationId: activeOrg.value.data.id
    })

    if (error)
      throw error

    toast.add({ title: 'Team deleted successfully', color: 'success' })

    // Fetch remaining teams to determine where to redirect
    const { data: orgs } = await organization.list()

    if (orgs && orgs.length > 0) {
      // Switch to first available team
      await organization.setActive({ organizationId: orgs[0].id })
      await fetchSession()
      window.location.href = `/${orgs[0].slug}/dashboard`
    } else {
      // No teams left
      window.location.href = '/onboarding'
    }
  } catch (e: any) {
    toast.add({
      title: 'Error deleting team',
      description: e.message,
      color: 'error'
    })
  } finally {
    deleteLoading.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <h1 class="text-3xl font-semibold mb-8">
      Organization settings
    </h1>

    <div
      v-if="canUpdateSettings"
      class="border border-gray-200 dark:border-gray-800 rounded-lg p-6 bg-white dark:bg-gray-900 mb-8"
    >
      <h2 class="text-xl font-semibold mb-4">
        General information
      </h2>
      <p class="text-sm text-gray-500 mb-6">
        For billing purposes you can use the organization ID below.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <UFormField label="Organization name">
          <UInput v-model="teamName" />
        </UFormField>

        <UFormField label="Organization ID">
          <div class="flex gap-2">
            <UInput
              :model-value="activeOrg?.data?.id"
              readonly
              class="flex-1 font-mono text-sm bg-gray-50 dark:bg-gray-800"
            />
            <UButton
              :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              color="gray"
              variant="ghost"
              @click="copyId"
            />
          </div>
        </UFormField>
      </div>

      <UButton
        label="Save"
        color="black"
        :loading="loading"
        @click="updateTeam"
      />
    </div>

    <!-- API Keys Section -->
    <div
      v-if="canUpdateSettings"
      class="border border-gray-200 dark:border-gray-800 rounded-lg p-6 bg-white dark:bg-gray-900 mb-8"
    >
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">
          API Keys
        </h2>
        <UButton
          label="Create New Key"
          icon="i-lucide-plus"
          size="sm"
          @click="isCreateKeyModalOpen = true"
        />
      </div>
      <p class="text-sm text-gray-500 mb-6">
        Manage API keys for accessing the organization programmatically.
      </p>

      <div
        v-if="apiKeysLoading"
        class="py-4 text-center"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin"
        />
      </div>
      <div
        v-else-if="!apiKeys || apiKeys.length === 0"
        class="text-sm text-gray-500"
      >
        No API keys found.
      </div>
      <div
        v-else
        class="space-y-4"
      >
        <div
          v-for="key in apiKeys"
          :key="key.id"
          class="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-800 rounded-lg"
        >
          <div>
            <div class="font-medium">
              {{ key.name }}
            </div>
            <div class="text-xs text-gray-500 font-mono">
              {{ key.start }}... <span v-if="key.prefix">({{ key.prefix }})</span>
            </div>
            <div class="text-xs text-gray-400 mt-1">
              Created: {{ new Date(key.createdAt).toLocaleDateString() }}
              <span> • Last used: {{ key.lastRequest ? new Date(key.lastRequest).toLocaleDateString() : 'Never' }}</span>
              <span v-if="key.expiresAt"> • Expires: {{ new Date(key.expiresAt).toLocaleDateString() }}</span>
            </div>
          </div>
          <UButton
            color="red"
            variant="ghost"
            icon="i-lucide-trash-2"
            size="xs"
            @click="deleteApiKey(key.id)"
          />
        </div>
      </div>
    </div>

    <UModal
      v-model:open="isCreateKeyModalOpen"
      title="Create API Key"
    >
      <template #body>
        <div class="space-y-4">
          <div
            v-if="createdKey"
            class="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800"
          >
            <p class="text-sm text-green-800 dark:text-green-200 font-medium mb-2">
              API Key Created! Copy it now, you won't see it again.
            </p>
            <div class="flex gap-2">
              <UInput
                :model-value="createdKey"
                readonly
                class="flex-1 font-mono"
              />
              <UButton
                icon="i-lucide-copy"
                color="gray"
                @click="copyKey(createdKey)"
              />
            </div>
            <UButton
              class="mt-4"
              block
              @click="isCreateKeyModalOpen = false; createdKey = null; newKeyName = ''"
            >
              Done
            </UButton>
          </div>
          <div
            v-else
            class="space-y-4"
          >
            <UFormField label="Key Name">
              <UInput
                v-model="newKeyName"
                placeholder="e.g. CI/CD Pipeline"
              />
            </UFormField>
            <UFormField label="Expiration (Seconds)">
              <UInput
                v-model="newKeyExpiresIn"
                type="number"
                placeholder="Leave empty for never"
              />
              <p class="text-xs text-gray-500 mt-1">
                Default is never if empty.
              </p>
            </UFormField>
            <div class="flex justify-end gap-2 pt-4">
              <UButton
                label="Cancel"
                color="gray"
                variant="ghost"
                @click="isCreateKeyModalOpen = false"
              />
              <UButton
                label="Create"
                :loading="createKeyLoading"
                @click="createApiKey"
              />
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <div
      v-if="canLeaveTeam"
      class="border border-red-200 dark:border-red-900/50 rounded-lg p-6 bg-red-50/50 dark:bg-red-900/10 mb-8"
    >
      <h2 class="text-xl font-semibold mb-4 text-red-600 dark:text-red-400">
        Leave organization
      </h2>
      <p class="text-sm text-gray-500 mb-6">
        Revoke your access to this organization. You will need to be re-invited to join again.
      </p>

      <UButton
        color="red"
        variant="outline"
        icon="i-lucide-log-out"
        :loading="leaveLoading"
        class="cursor-pointer"
        @click="leaveTeam"
      >
        Leave Team
      </UButton>
    </div>

    <div
      v-if="canDeleteTeam"
      class="border border-red-200 dark:border-red-900/50 rounded-lg p-6 bg-red-50/50 dark:bg-red-900/10"
    >
      <h2 class="text-xl font-semibold mb-4 text-red-600 dark:text-red-400">
        Delete organization
      </h2>
      <p class="text-sm text-gray-500 mb-6">
        Once you delete a team, there is no going back. Please be certain.
      </p>

      <UButton
        color="red"
        variant="outline"
        icon="i-lucide-trash-2"
        :loading="deleteLoading"
        class="cursor-pointer"
        @click="deleteTeam"
      >
        Delete Team
      </UButton>
    </div>
  </div>
</template>
