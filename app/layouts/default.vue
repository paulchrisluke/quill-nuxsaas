<script lang="ts" setup>
import Logo from '~/components/Logo.vue'
import OnboardingModal from '~/components/OnboardingModal.vue'
import OrganizationSwitcher from '~/components/OrganizationSwitcher.vue'
import UserNavigation from '~/components/UserNavigation.vue'

const { needsOnboarding, showOnboarding } = useOnboarding()
const { t } = useI18n()
const localePath = useLocalePath()
const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const { data: userOrganizations } = useUserOrganizations({ lazy: true })

const hasOrganizations = computed(() => (userOrganizations.value?.length ?? 0) > 0)

const primaryOrgSlug = computed(() => {
  if (activeOrg.value?.data?.slug)
    return activeOrg.value.data.slug
  return userOrganizations.value?.[0]?.slug || null
})

const navItems = computed(() => {
  const items: Array<{ label: string, icon: string, to: string }> = []
  const slug = primaryOrgSlug.value

  // Only show Home if user doesn't have an organization
  if (!slug) {
    items.push({ label: 'Home', icon: 'i-lucide-home', to: localePath('/') })
  }

  // Organization-specific navigation
  if (slug) {
    items.push(
      { label: 'Members', icon: 'i-lucide-users', to: localePath(`/${slug}/members`) },
      { label: 'Billing', icon: 'i-lucide-credit-card', to: localePath(`/${slug}/billing`) },
      { label: 'Integrations', icon: 'i-lucide-plug', to: localePath(`/${slug}/integrations`) },
      { label: 'Settings', icon: 'i-lucide-settings', to: localePath(`/${slug}/settings`) }
    )
  }

  return items
})

watch(() => needsOnboarding.value, (needs) => {
  if (needs)
    showOnboarding()
}, { immediate: true })

const i18nHead = useLocaleHead()
useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))
</script>

<template>
  <div class="min-h-screen flex flex-col bg-background text-foreground">
    <header class="border-b border-neutral-200/70 dark:border-neutral-800/60 bg-background/90 backdrop-blur-sm">
      <div class="px-4 py-3 flex items-center justify-between gap-3 max-w-3xl mx-auto w-full">
        <div class="flex items-center gap-3">
          <USlideover
            side="left"
          >
            <UButton
              variant="ghost"
              color="neutral"
              icon="i-lucide-menu"
              aria-label="Open navigation"
            />
            <template #content>
              <div class="p-5 space-y-6">
                <div class="flex items-center gap-3">
                  <Logo class="w-8 h-8" />
                  <div>
                    <p class="font-semibold">
                      {{ t('global.appName') }}
                    </p>
                    <p class="text-sm text-muted-foreground">
                      Plan, write, and ship.
                    </p>
                  </div>
                </div>

                <OrganizationSwitcher v-if="hasOrganizations" />

                <nav class="space-y-2">
                  <UButton
                    v-for="item in navItems"
                    :key="item.to"
                    class="w-full justify-start"
                    color="neutral"
                    variant="ghost"
                    :to="item.to"
                  >
                    <UIcon
                      v-if="item.icon"
                      :name="item.icon"
                      class="w-4 h-4 mr-2"
                    />
                    {{ item.label }}
                  </UButton>
                </nav>
              </div>
            </template>
          </USlideover>
          <NuxtLink
            :to="localePath('/')"
            class="flex items-center gap-2 font-semibold text-lg"
          >
            <Logo class="w-6 h-6" />
            <span>{{ t('global.appName') }}</span>
          </NuxtLink>
        </div>
        <div class="flex items-center gap-2">
          <UserNavigation />
        </div>
      </div>
    </header>

    <main class="flex-1 w-full">
      <div class="max-w-3xl mx-auto w-full px-4">
        <slot />
      </div>
    </main>
    <OnboardingModal />
  </div>
</template>
