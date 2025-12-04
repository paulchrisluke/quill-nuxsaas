<script setup lang="ts">
const localePath = useLocalePath()
const { t } = useI18n()
const { loggedIn, signOut, user, activeStripeSubscription, organization, session } = useAuth()

// Fetch organizations list to get active org slug
const { data: organizations } = await useLazyAsyncData('user-organizations-nav', async () => {
  if (!loggedIn.value)
    return null
  const { data } = await organization.list()
  return data
}, {
  getCachedData: () => undefined
})

// Get active organization slug from session's activeOrganizationId
// This works on all pages since better-auth maintains the active org in session
const activeOrgSlug = computed(() => {
  if (session.value?.activeOrganizationId && organizations.value) {
    const org = organizations.value.find((o: any) => o.id === session.value?.activeOrganizationId)
    if (org?.slug) {
      return org.slug
    }
  }
  return null
})

// Get settings route - only show if we have an org slug
const settingsRoute = computed(() => {
  const slug = activeOrgSlug.value
  if (!slug) {
    return null
  }
  return localePath(`/${slug}/settings`)
})

// Build dropdown items conditionally
const dropdownItems = computed(() => {
  const items: any[] = []

  if (settingsRoute.value) {
    items.push({
      label: 'Settings',
      icon: 'i-lucide-settings',
      to: settingsRoute.value
    })
  }

  items.push({
    label: t('global.auth.signOut'),
    icon: 'i-lucide-log-out',
    onSelect: () => signOut()
  })

  return items
})
</script>

<template>
  <template v-if="loggedIn">
    <UDropdownMenu
      :items="dropdownItems"
    >
      <UButton
        variant="ghost"
        color="neutral"
        class="flex items-center gap-2"
      >
        <UAvatar
          v-if="user?.image"
          :src="user?.image"
          :alt="user?.name"
          size="sm"
        />
        <span>
          {{ user?.name }}
          <UBadge
            v-if="activeStripeSubscription"
            label="Pro"
          />
        </span>
      </UButton>
    </UDropdownMenu>
    <UButton
      v-if="user?.role == 'admin'"
      variant="outline"
      color="neutral"
      class="flex items-center gap-2"
      :to="localePath('/admin')"
    >
      {{ t('global.nav.admin') }}
    </UButton>
  </template>
  <template v-else>
    <UButton
      :to="localePath('/signin')"
      variant="outline"
    >
      {{ t('global.auth.signIn') }}
    </UButton>
  </template>
</template>
