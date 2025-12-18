<script setup lang="ts">
import { NON_ORG_SLUG } from '~~/shared/constants/routing'
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

definePageMeta({
  auth: false
})

const localePath = useLocalePath()
const { loggedIn, fetchSession, useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()

const sessionReady = ref(false)
const hasNavigated = ref(false)

onMounted(async () => {
  try {
    await fetchSession()
  } catch {
    // Ignore - page can still render for anonymous users
  } finally {
    sessionReady.value = true
  }
})

// Watch for when session becomes ready, user logs in, and org data loads, then navigate once
watch([sessionReady, loggedIn, activeOrg], () => {
  if (sessionReady.value && loggedIn.value && !hasNavigated.value) {
    // Wait for organization data to be available before navigating
    if (!activeOrg.value?.data) {
      return
    }
    hasNavigated.value = true
    const slug = activeOrg.value.data.slug
    const target = slug && slug !== NON_ORG_SLUG ? `/${slug}/conversations` : `/${NON_ORG_SLUG}/conversations`
    navigateTo(localePath(target))
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
