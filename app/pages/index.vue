<script setup lang="ts">
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

definePageMeta({
  auth: false
})

const { loggedIn, fetchSession, useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const localePath = useLocalePath()

// Navigation lock to prevent concurrent redirects
let isNavigating = false

// Shared navigation helper with error handling and fallback
async function performRedirect(targetSlug: string) {
  if (isNavigating) {
    return
  }

  isNavigating = true
  try {
    const target = localePath(`/${targetSlug}/conversations`)
    try {
      await navigateTo(target)
    } catch (navError) {
      // Fallback to hard reload only if navigateTo fails
      if (import.meta.client) {
        console.warn('navigateTo failed, falling back to hard reload:', navError)
        window.location.href = target
      }
    }
  } finally {
    isNavigating = false
  }
}

// Watch for subsequent changes to login/org state (not initial load)
watch([loggedIn, activeOrg], async () => {
  if (loggedIn.value && activeOrg.value?.data?.slug) {
    await performRedirect(activeOrg.value.data.slug)
  }
})

// Handle initial redirect on mount
onMounted(async () => {
  if (!loggedIn.value) {
    await fetchSession()
  }

  if (loggedIn.value) {
    try {
      // Prefer activeOrg if available
      if (activeOrg.value?.data?.slug) {
        await performRedirect(activeOrg.value.data.slug)
        return
      }

      // Otherwise fetch orgs and use first one
      const { data: orgs } = await useAuth().organization.list()
      if (orgs && orgs.length > 0) {
        // Use first org as fallback
        await performRedirect(orgs[0].slug)
      }
    } catch (err) {
      console.error('Redirect failed:', err)
      isNavigating = false
    }
  }
})
</script>

<template>
  <div class="w-full h-full">
    <ClientOnly>
      <KeepAlive :max="5">
        <QuillioWidget />
      </KeepAlive>
    </ClientOnly>
  </div>
</template>
