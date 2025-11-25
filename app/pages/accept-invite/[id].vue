<script setup lang="ts">
const route = useRoute()
const localePath = useLocalePath()
const { organization, loggedIn, fetchSession, session } = useAuth()
const toast = useToast()
const loading = ref(true)
const error = ref('')

const invitationId = route.params.id as string

onMounted(async () => {
  // Ensure session is up to date before checking login status
  if (!session.value) {
    await fetchSession()
  }

  if (!loggedIn.value) {
    if (import.meta.client && invitationId) {
      localStorage.setItem('pending_invite', invitationId)
    }
    return navigateTo(localePath(`/signup?redirect=${route.fullPath}`))
  }

  if (!invitationId) {
    error.value = 'Invalid invitation link'
    loading.value = false
    return
  }

  try {
    const { data: result, error: apiError } = await organization.acceptInvitation({
      invitationId
    })
    if (apiError)
      throw apiError

    // Fetch the organization details to get the slug
    await fetchSession()
    const { data: orgs } = await organization.list()

    // Find the organization we just joined (should be the active one or match the invitation)
    const joinedOrg = orgs?.find((o: any) => o.id === result?.organizationId) || orgs?.[0]

    if (joinedOrg) {
      toast.add({ title: 'Invitation accepted', color: 'success' })
      // Redirect to the specific organization's dashboard
      window.location.href = `/${joinedOrg.slug}/dashboard`
    } else {
      throw new Error('Could not find organization')
    }
  } catch (e: any) {
    error.value = e.message || 'Failed to accept invitation'
  } finally {
    loading.value = false
  }
})

definePageMeta({
  layout: false,
  auth: false
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
    <UCard class="w-full max-w-md">
      <div class="text-center">
        <h1 class="text-xl font-semibold mb-4">
          Accepting Invitation
        </h1>

        <div
          v-if="loading"
          class="flex justify-center my-8"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="h-8 w-8 animate-spin text-primary"
          />
        </div>

        <div
          v-else-if="error"
          class="text-red-500 mb-4"
        >
          <UIcon
            name="i-lucide-alert-circle"
            class="h-12 w-12 mx-auto mb-2"
          />
          <p>{{ error }}</p>
          <UButton
            to="/"
            class="mt-4"
            variant="outline"
          >
            Go Home
          </UButton>
        </div>

        <div v-else>
          <UIcon
            name="i-lucide-check-circle"
            class="h-12 w-12 mx-auto mb-2 text-green-500"
          />
          <p>Redirecting to dashboard...</p>
        </div>
      </div>
    </UCard>
  </div>
</template>
