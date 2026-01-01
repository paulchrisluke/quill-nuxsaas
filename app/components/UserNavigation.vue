<script setup lang="ts">
import { NON_ORG_SLUG } from '~~/shared/constants/routing'
import { getPlanKeyFromId, PLAN_TIERS } from '~~/shared/utils/plans'

const emit = defineEmits<{
  signIn: [event: MouseEvent]
}>()
const localePath = useLocalePath()
const { t } = useI18n()
const route = useRoute()
const { isAuthenticatedUser, signOut, user, useActiveOrganization } = useAuth()
const { activeSub: activeStripeSubscription } = usePaymentStatus()
const activeOrg = useActiveOrganization()

const orgSlug = computed(() => {
  const param = route.params.slug
  const routeSlug = Array.isArray(param) ? param[0] : param
  if (routeSlug && routeSlug !== NON_ORG_SLUG)
    return routeSlug
  const fallback = activeOrg.value?.data?.slug
  return fallback && fallback !== NON_ORG_SLUG ? fallback : null
})

const menuItems = computed(() => {
  const items: any[] = []
  if (orgSlug.value) {
    items.push({
      label: t('global.nav.settings'),
      icon: 'i-lucide-settings',
      to: localePath(`/${orgSlug.value}/settings`)
    })
  }
  items.push({
    label: t('global.auth.signOut'),
    icon: 'i-lucide-log-out',
    onSelect: () => signOut()
  })
  return items
})

// Get the tier display name from the subscription plan
const tierBadgeLabel = computed(() => {
  if (!activeStripeSubscription.value?.plan)
    return 'Pro'
  const tierKey = getPlanKeyFromId(activeStripeSubscription.value.plan)
  if (tierKey === 'free')
    return 'Pro' // Fallback
  return PLAN_TIERS[tierKey]?.name || 'Pro'
})
</script>

<template>
  <template v-if="isAuthenticatedUser">
    <UDropdownMenu>
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
            :label="tierBadgeLabel"
          />
        </span>
      </UButton>
      <template #content>
        <div
          v-if="user?.email"
          class="px-2 py-1.5"
        >
          <div class="text-sm text-gray-600 dark:text-gray-400 truncate">
            {{ user.email }}
          </div>
        </div>
        <USeparator v-if="user?.email" />
        <template
          v-for="(item, index) in menuItems"
          :key="index"
        >
          <NuxtLink
            v-if="item.to"
            :to="item.to"
            class="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
          >
            <UIcon
              v-if="item.icon"
              :name="item.icon"
              class="w-4 h-4"
            />
            <span>{{ item.label }}</span>
          </NuxtLink>
          <button
            v-else
            class="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
            @click="item.onSelect ? item.onSelect() : undefined"
          >
            <UIcon
              v-if="item.icon"
              :name="item.icon"
              class="w-4 h-4"
            />
            <span>{{ item.label }}</span>
          </button>
        </template>
      </template>
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
      @click="emit('signIn', $event)"
    >
      {{ t('global.auth.signIn') }}
    </UButton>
  </template>
</template>
