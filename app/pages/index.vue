<script setup lang="ts">
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

definePageMeta({
  auth: false
})

const { loggedIn, fetchSession, useActiveOrganization, isAuthenticatedUser } = useAuth()
const activeOrg = useActiveOrganization()
const localePath = useLocalePath()

// Navigation lock to prevent concurrent redirects
let isNavigating = false

// Track whether redirect has been handled to prevent race between watcher and onMounted
let hasRedirected = false

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

// Watch for changes to login/org state (including initial load)
watch([isAuthenticatedUser, activeOrg], async () => {
  if (hasRedirected)
    return
  if (isAuthenticatedUser.value && activeOrg.value?.data?.slug) {
    hasRedirected = true
    await performRedirect(activeOrg.value.data.slug)
  }
}, { immediate: true })

// Handle initial redirect on mount
onMounted(async () => {
  if (!loggedIn.value) {
    await fetchSession()
  }

  // Only handle fallback if watcher didn't handle it
  if (isAuthenticatedUser.value && !hasRedirected) {
    try {
      // Otherwise fetch orgs and use first one
      const { data: orgs } = await useAuth().organization.list()
      if (orgs && orgs.length > 0) {
        hasRedirected = true
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
