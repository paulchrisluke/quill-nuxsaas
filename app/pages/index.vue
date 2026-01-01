<script setup lang="ts">
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

definePageMeta({
  auth: false
})

const { loggedIn, fetchSession, useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const localePath = useLocalePath()

// Watch for subsequent changes to login/org state (not initial load)
watch([loggedIn, activeOrg], () => {
  if (loggedIn.value && activeOrg.value?.data?.slug) {
    navigateTo(localePath(`/${activeOrg.value.data.slug}/conversations`))
  }
})

// Handle initial redirect on mount
onMounted(async () => {
  if (!loggedIn.value) {
    await fetchSession()
  }

  if (loggedIn.value) {
    try {
      const { data: orgs } = await useAuth().organization.list()
      if (orgs && orgs.length > 0) {
        const target = localePath(`/${orgs[0].slug}/conversations`)
        try {
          await navigateTo(target)
        } catch (navError) {
          // Fallback to hard reload only if navigateTo fails
          if (import.meta.client) {
            console.warn('navigateTo failed, falling back to hard reload:', navError)
            window.location.href = target
          }
        }
      }
    } catch (err) {
      console.error('Redirect failed:', err)
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
