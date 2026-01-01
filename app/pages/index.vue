<script setup lang="ts">
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

definePageMeta({
  auth: false
})

const { loggedIn, fetchSession, useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const localePath = useLocalePath()

// Watch for login and org data to redirect
watch([loggedIn, activeOrg], () => {
  if (loggedIn.value && activeOrg.value?.data?.slug) {
    navigateTo(localePath(`/${activeOrg.value.data.slug}/conversations`))
  }
}, { immediate: true })

onMounted(async () => {
  if (!loggedIn.value) {
    await fetchSession()
  }

  if (loggedIn.value) {
    try {
      const { data: orgs } = await useAuth().organization.list()
      if (orgs && orgs.length > 0) {
        const target = localePath(`/${orgs[0].slug}/conversations`)
        // Use navigateTo but fallback to window.location if it fails to trigger
        await navigateTo(target)
        if (import.meta.client) {
          window.location.href = target
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
