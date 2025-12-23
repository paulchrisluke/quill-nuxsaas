<script setup lang="ts">
/**
 * Organization Settings Page
 * Uses extracted components for maintainability:
 * - SettingsGeneralSection: Name, slug, timezone
 * - SettingsApiKeysSection: API key management
 * - SettingsDangerZone: Leave/delete organization
 *
 * Note: Trusted Devices (sessions) moved to Profile page as it's user-specific
 */
import { canUpdateOrgSettings } from '~~/shared/utils/permissions'

definePageMeta({
  layout: 'dashboard'
})

const { useActiveOrganization, user } = useAuth()
const activeOrg = useActiveOrganization()

// Computed permissions
const currentUserRole = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return null
  const member = activeOrg.value.data.members.find((m: any) => m.userId === user.value!.id)
  return member?.role
})

const canUpdateSettings = computed(() => {
  return canUpdateOrgSettings(currentUserRole.value as any)
})
</script>

<template>
  <div class="max-w-4xl mx-auto py-4 px-4">
    <!-- Profile Settings Banner -->
    <NuxtLink
      :to="`/${$route.params.slug}/profile`"
      class="flex items-center justify-between px-3 py-2.5 mb-4 bg-primary-50 dark:bg-primary-950/30 border border-primary-200 dark:border-primary-800/50 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors group"
    >
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-user-cog"
          class="w-4 h-4 text-primary-600 dark:text-primary-400"
        />
        <span class="text-sm text-primary-800 dark:text-primary-200">
          Looking for your personal settings? Update your profile, email, and password
        </span>
      </div>
      <UIcon
        name="i-lucide-arrow-right"
        class="w-5 h-5 text-primary-500 group-hover:translate-x-1 transition-transform"
      />
    </NuxtLink>

    <h1 class="text-3xl font-semibold mb-8">
      Organization settings
    </h1>

    <!-- General Settings -->
    <div class="mb-8">
      <SettingsGeneralSection :can-edit="canUpdateSettings" />
    </div>

    <!-- API Keys -->
    <div class="mb-8">
      <SettingsApiKeysSection :can-manage="canUpdateSettings" />
    </div>

    <!-- Danger Zone -->
    <SettingsDangerZone />
  </div>
</template>
