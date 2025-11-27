<i18n src="./menu/i18n.json"></i18n>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import SearchPalette from './components/SearchPalette.vue'
import { getUserMenus } from './menu'

const { user, signOut, organization, useActiveOrganization, session: _session } = useAuth()
const activeOrg = useActiveOrganization()
console.log('[Dashboard Layout] activeOrg initialized:', activeOrg.value?.data?.slug)
const toast = useToast()

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const isCollapsed = ref(false)
const runtimeConfig = useRuntimeConfig()

// Fetch organization data with SSR to ensure members data is available for canManageTeam
// SSR-only to prevent flicker on page load
const { data: layoutOrgData, refresh: _refreshLayoutOrg } = await useAsyncData(
  `layout-org-${route.params.slug}`,
  async () => {
    // Check if we have cached data in payload (initial SSR load)
    const nuxtApp = useNuxtApp()
    const key = `layout-org-${route.params.slug}`
    const cached = nuxtApp.payload.data[key] || nuxtApp.static.data[key]

    console.log(`[Dashboard] useAsyncData running. Client: ${import.meta.client}, Hydrating: ${nuxtApp.isHydrating}, Cached: ${!!cached}`)

    // Only use cached data if we are hydrating (initial load)
    if (import.meta.client && nuxtApp.isHydrating && cached) {
      console.log('[Dashboard] Using cached payload data during hydration')
      return cached
    }

    console.log('[Dashboard] Fetching fresh data from API...')

    // Otherwise (server side OR client navigation), fetch fresh data
    return await $fetch('/api/organization/full-data', {
      headers: useRequestHeaders(['cookie'])
    }).catch((e) => {
      console.error('[Dashboard] Failed to fetch full data:', e)
      return null
    })
  },
  {
    immediate: true,
    watch: [() => route.params.slug],
    lazy: false,
    server: true,
    getCachedData: (key) => {
      // On client, use cached data from Nuxt payload
      const data = useNuxtApp().payload.data[key] || useNuxtApp().static.data[key]
      if (data) {
        console.log('[Dashboard] getCachedData found data for:', key)
        return data
      }
      console.log('[Dashboard] getCachedData MISS for:', key)
      return undefined // Return undefined to force fetch
    }
  }
)

// Sync SSR data to activeOrg immediately
// Since activeOrg is now a Nuxt useState, this works on server and client
// and hydration handles the rest!
if (layoutOrgData.value) {
  // Flatten the structure: org data + subscriptions at top level
  const flattenedData = {
    ...layoutOrgData.value.organization,
    subscriptions: layoutOrgData.value.subscriptions
  }

  if (!activeOrg.value) {
    activeOrg.value = { data: flattenedData }
  } else {
    activeOrg.value.data = flattenedData
  }
}

// Watch for changes and sync
watch(() => layoutOrgData.value, (newOrg) => {
  if (newOrg) {
    // Safety check: Ensure the fetched org matches the current route slug
    const routeSlug = route.params.slug
    // Check if newOrg has organization property (server response) or if it's flattened (from cache?)
    const orgSlug = (newOrg as any).organization?.slug || (newOrg as any).slug

    if (routeSlug && routeSlug !== 't' && orgSlug && orgSlug !== routeSlug) {
      return
    }

    // Flatten the structure if it has nested organization property
    let flattenedData = newOrg as any
    if ((newOrg as any).organization) {
      flattenedData = {
        ...(newOrg as any).organization,
        subscriptions: (newOrg as any).subscriptions
      }
    }

    if (!activeOrg.value) {
      activeOrg.value = { data: flattenedData }
    } else {
      activeOrg.value.data = flattenedData
    }
  } else {
    // If no org data found (e.g. 403 Forbidden, 404 Not Found)
    // This handles the case where user has no access to the requested dashboard
    if (import.meta.client) {
      console.warn('[Dashboard] No organization data found or access denied. Clearing cache and redirecting.')

      // Clear cached organization list to force middleware to re-fetch
      clearNuxtData('user-organizations')

      // Redirect to root - middleware will pick up fresh org list and route to first available team
      // or onboarding if none exist
      window.location.href = '/'
    }
  }
}, { immediate: true })

const isCreateTeamModalOpen = ref(false)
const showUpgradeModal = ref(false)
const upgradeOrgId = ref<string | undefined>(undefined)
const newTeamName = ref('')
const newTeamSlug = ref('')
const isSlugManuallyEdited = ref(false)
const creatingTeam = ref(false)
const slugError = ref('')
const isCheckingSlug = ref(false)
const ownedTeamsCount = ref(0)
const _selectedInterval = ref<'month' | 'year'>('month')

const fetchOwnedCount = async () => {
  try {
    const { count } = await $fetch('/api/organization/get-owned-count', { headers: useRequestHeaders(['cookie']) })
    ownedTeamsCount.value = count
  } catch (e) {
    console.error('Failed to fetch owned teams count', e)
  }
}

const handleOpenCreateModal = async () => {
  // Just open the create team modal
  isCreateTeamModalOpen.value = true
  showUpgradeModal.value = false
  upgradeOrgId.value = undefined
}

onUnmounted(() => {
  window.removeEventListener('open-create-team-modal', handleOpenCreateModal)
})

watch(isCreateTeamModalOpen, async (isOpen) => {
  if (isOpen) {
    // Reset state
    newTeamName.value = ''
    newTeamSlug.value = ''
    slugError.value = ''
    isSlugManuallyEdited.value = false

    // Fetch owned count to determine if we need to show plan selection
    await fetchOwnedCount()
  }
})

const _showBilling = computed(() => ownedTeamsCount.value > 0)

const checkSlug = useDebounceFn(async (slug: string) => {
  if (!slug || slug.length < 3) {
    return
  }
  isCheckingSlug.value = true
  try {
    const { available } = await $fetch('/api/organization/check-slug', {
      query: { slug },
      headers: useRequestHeaders(['cookie'])
    })
    if (!available) {
      slugError.value = 'Slug is already taken'
    } else {
      slugError.value = ''
    }
  } catch (e) {
    console.error(e)
  } finally {
    isCheckingSlug.value = false
  }
}, 500)

watch(newTeamName, (newName) => {
  if (!isSlugManuallyEdited.value) {
    const slug = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    newTeamSlug.value = slug
    checkSlug(slug)
  }
})

watch(newTeamSlug, (newSlug) => {
  slugError.value = ''
  if (isSlugManuallyEdited.value) {
    checkSlug(newSlug)
  }
})

// Check for active organization and redirect if needed
onMounted(async () => {
  window.addEventListener('open-create-team-modal', handleOpenCreateModal)

  // Prefetch owned count for smoother UI
  fetchOwnedCount()

  // Organization sync is now handled by app/middleware/organization.global.ts
})

// Cache for role computation logging to prevent spam
const _roleComputeCache = { lastLoggedKey: '', lastLoggedTime: 0 }

// Get current user's role in the organization
const currentUserRole = computed(() => {
  // layoutOrgData is the raw API response: { organization: {...}, subscriptions: [...] }
  // activeOrg.data is the flattened version: { ...organization, subscriptions: [...] }

  let orgData = activeOrg.value?.data

  // Fallback to layoutOrgData if activeOrg isn't set yet
  if (!orgData && layoutOrgData.value) {
    const rawData = layoutOrgData.value as any
    orgData = rawData.organization ? { ...rawData.organization, subscriptions: rawData.subscriptions } : rawData
  }

  if (!orgData?.members || !user.value?.id)
    return undefined

  const member = orgData.members.find((m: any) => m.userId === user.value?.id)
  return member?.role as 'owner' | 'admin' | 'member' | undefined
})

// Watch for role changes and log them (separate from computed to avoid side effects)
watch([currentUserRole, activeOrg], ([newRole]) => {
  const now = Date.now()
  const orgData = activeOrg.value?.data
  const cacheKey = `${!!orgData}-${!!orgData?.members}-${user.value?.id}-${orgData?.id}-${newRole}`

  // Only log if data changed and not too recently
  if (cacheKey !== _roleComputeCache.lastLoggedKey && (now - _roleComputeCache.lastLoggedTime) > 1000) {
    console.log('Computing role:', {
      hasOrgData: !!orgData,
      hasMembers: !!orgData?.members,
      userId: user.value?.id,
      members: orgData?.members
    })
    if (newRole) {
      console.log('Found member role:', newRole)
    }
    _roleComputeCache.lastLoggedKey = cacheKey
    _roleComputeCache.lastLoggedTime = now
  }
}, { immediate: true })

// Check if current user is owner or admin (kept for backward compatibility)
const _canManageTeam = computed(() => {
  const role = currentUserRole.value
  return role === 'owner' || role === 'admin'
})

// Check if current user is owner (kept for backward compatibility)
const _isOwner = computed(() => {
  return currentUserRole.value === 'owner'
})

const activeOrgSlug = computed(() => {
  // Use route slug as source of truth to prevent reverting to previous team
  const routeSlug = Array.isArray(route.params.slug) ? route.params.slug[0] : route.params.slug || ''
  if (routeSlug && routeSlug !== 't') {
    return routeSlug
  }
  // Fallback to activeOrg if no route slug
  return activeOrg.value?.data?.slug || 't'
})

defineShortcuts({
  'g-1': () => router.push(localePath(`/${activeOrgSlug.value}/dashboard`))
})
const pathNameItemMap: StringDict<NavigationMenuItem> = {}
const pathNameParentMap: StringDict<NavigationMenuItem | undefined> = {}

// Pass user role to menu instead of boolean flags
const menus = computed(() => getUserMenus(t, localePath, runtimeConfig.public.appRepo, activeOrgSlug.value, currentUserRole.value))

const menuIterator = (menus: NavigationMenuItem[], parent?: NavigationMenuItem) => {
  for (const menu of menus) {
    const to = `${menu.to}`
    pathNameItemMap[to] = menu!
    pathNameParentMap[to] = parent
    if (menu.to == route.path) {
      if (pathNameParentMap[to]) {
        pathNameParentMap[to].defaultOpen = true
      }
    }
    if (menu.children) {
      menuIterator(menu.children, menu)
    }
  }
}

watchEffect(() => {
  const currentMenus = menus.value
  // Re-run menu iterator when menus change
  for (const group of currentMenus) {
    menuIterator(group)
  }
})

const clickSignOut = () => {
  signOut({ redirectTo: localePath('/signin') })
}

async function createTeam() {
  if (!newTeamName.value.trim() || !newTeamSlug.value.trim())
    return

  // Check if user owns 1+ teams
  await fetchOwnedCount()

  if (ownedTeamsCount.value >= 1) {
    creatingTeam.value = true
    try {
      const { data: newTeam, error: createError } = await organization.create({
        name: newTeamName.value,
        slug: newTeamSlug.value
      })

      if (createError || !newTeam) {
        throw createError || new Error('Failed to create team')
      }

      await organization.setActive({ organizationId: newTeam.id })

      localStorage.setItem(`org_${newTeam.id}_needsUpgrade`, 'true')

      toast.add({
        title: 'Team created successfully',
        description: 'Upgrade to Pro to unlock all features',
        color: 'success'
      })

      upgradeOrgId.value = newTeam.id
      showUpgradeModal.value = true
      isCreateTeamModalOpen.value = false
    } catch (e: any) {
      toast.add({
        title: 'Failed to create team',
        description: e.message,
        color: 'error'
      })
    } finally {
      creatingTeam.value = false
    }
    return
  }

  // First team - create it for free
  creatingTeam.value = true
  try {
    const { data, error } = await organization.create({
      name: newTeamName.value,
      slug: newTeamSlug.value
    })

    if (error)
      throw error

    if (data) {
      await organization.setActive({ organizationId: data.id })
      toast.add({ title: 'Team created successfully', color: 'success' })
      newTeamName.value = ''
      newTeamSlug.value = ''
      isSlugManuallyEdited.value = false
      isCreateTeamModalOpen.value = false
      showUpgradeModal.value = false
      upgradeOrgId.value = undefined
      // Navigate to new team dashboard
      window.location.href = `/${data.slug}/dashboard`
    }
  } catch (e: any) {
    toast.add({
      title: 'Error creating team',
      description: e.message,
      color: 'error'
    })
  } finally {
    creatingTeam.value = false
  }
}
</script>

<template>
  <div>
    <aside
      class="fixed top-0 left-0 transition-all duration-300 hidden sm:block"
      :class="[isCollapsed ? 'w-15' : 'w-64']"
    >
      <div class="h-screen flex flex-col px-3 py-4 bg-neutral-100 dark:bg-neutral-800">
        <a
          v-if="!isCollapsed"
          class="flex items-center ps-2.5"
        >
          <Logo class="h-6 w-6" />
          <span
            class="self-center ml-2 text-xl font-semibold whitespace-nowrap dark:text-white"
          >
            {{ t('global.appName') }}
          </span>
        </a>
        <Logo
          v-if="isCollapsed"
          class="h-6 w-6 ml-1"
        />
        <div
          class="flex flex-col gap-2 mb-2 mt-3"
          :class="{ 'pl-2 pr-2': !isCollapsed }"
        >
          <OrganizationSwitcher v-if="!isCollapsed" />
          <SearchPalette
            :collapsed="isCollapsed"
            :t="t"
          />
        </div>
        <UNavigationMenu
          :items="menus"
          :collapsed="isCollapsed"
          orientation="vertical"
          class="data-[orientation=vertical]:w-full flex-1 overflow-y-auto"
        />
        <div class="flex flex-col pl-2 pr-2">
          <USeparator class="mb-2" />
          <!-- Team Settings (Owner only) or Create Team -->
          <template v-if="!isCollapsed" />
          <UTooltip
            :ui="{ content: 'w-54 flex flex-col h-auto p-0 gap-0' }"
            :delay-duration="100"
            :disable-closing-trigger="true"
          >
            <template #content>
              <UButton
                icon="i-lucide-log-out"
                size="sm"
                color="neutral"
                variant="link"
                class="w-full p-[10px]"
                @click="clickSignOut"
              >
                {{ t('global.auth.signOut') }}
              </UButton>
            </template>
            <div
              class="w-full flex items-center justify-between mt-2 pt-2 pb-2"
              :class="{ 'pl-2 pr-2': !isCollapsed }"
            >
              <div class="flex items-center">
                <UAvatar
                  :src="user?.image || undefined"
                  size="xs"
                  class="border border-neutral-300 dark:border-neutral-700"
                />
                <span
                  v-if="!isCollapsed"
                  class="text-xs ml-2"
                >
                  {{ user?.name }}
                </span>
              </div>
              <UIcon
                v-if="!isCollapsed"
                name="i-lucide-ellipsis-vertical"
              />
            </div>
          </UTooltip>
        </div>
      </div>
    </aside>
    <div
      class="p-2 h-screen bg-white dark:bg-neutral-900 transition-all duration-300 overflow-hidden flex flex-col"
      :class="[isCollapsed ? 'sm:ml-15' : 'sm:ml-64']"
    >
      <FlexThreeColumn class="mb-2 flex-none">
        <template #left>
          <UDrawer
            class="sm:hidden"
            direction="left"
            as="aside"
            :handle="false"
          >
            <UButton
              icon="i-lucide-menu"
              class="w-8 h-8"
              color="neutral"
              variant="ghost"
            />
            <template #content>
              <div class="w-[60vw] p-4">
                <div class="mb-4">
                  <OrganizationSwitcher />
                </div>
                <UNavigationMenu
                  orientation="vertical"
                  :items="menus"
                  class="data-[orientation=vertical]:w-full"
                />
              </div>
            </template>
          </UDrawer>
          <UButton
            :icon="isCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
            class="w-8 h-8 hidden sm:block"
            color="neutral"
            variant="ghost"
            @click="isCollapsed = !isCollapsed"
          />
          <title>{{ pathNameItemMap[$route.path]?.label }}</title>
          <h1>{{ pathNameItemMap[$route.path]?.label }} </h1>
          <slot name="navLeft" />
        </template>
        <template #middle>
          <slot name="navMiddle" />
        </template>
        <template #right>
          <slot name="navRight" />
          <LocaleToggler />
          <ClientOnly>
            <ColorModeToggler />
          </ClientOnly>
        </template>
      </FlexThreeColumn>
      <div class="p-2 border-2 border-neutral-200 border-dashed rounded-lg dark:border-neutral-700 flex-1 overflow-auto">
        <slot />
      </div>
    </div>

    <!-- Create Team Modal -->
    <UModal
      v-model:open="isCreateTeamModalOpen"
      title="Create New Team"
      description="Create a new team to collaborate with others."
    >
      <template #body>
        <div class="space-y-4">
          <UFormField
            label="Team Name"
            required
          >
            <UInput
              v-model="newTeamName"
              placeholder="Acme Inc"
              icon="i-lucide-building-2"
            />
          </UFormField>
          <UFormField
            label="Team URL (Slug)"
            required
            :error="slugError || undefined"
          >
            <UInput
              v-model="newTeamSlug"
              placeholder="acme-inc"
              icon="i-lucide-link"
              :loading="isCheckingSlug"
              @input="isSlugManuallyEdited = true"
              @keyup.enter="createTeam"
            />
            <p class="text-xs text-muted-foreground mt-1">
              Unique identifier for your team URL.
            </p>
          </UFormField>

          <!-- Info message for 2nd+ teams -->
          <div
            v-if="ownedTeamsCount >= 1"
            class="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg"
          >
            <p class="text-sm text-blue-800 dark:text-blue-200">
              Creating a second organization requires a Pro plan. You'll be redirected to select your plan after creating the team.
            </p>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="isCreateTeamModalOpen = false"
        />
        <UButton
          :loading="creatingTeam"
          :disabled="!newTeamName.trim() || !newTeamSlug.trim()"
          label="Create Team"
          icon="i-lucide-plus-circle"
          @click="createTeam"
        />
      </template>
    </UModal>

    <!-- Upgrade Modal for Creating Second Org -->
    <UpgradeModal
      v-model:open="showUpgradeModal"
      reason="create-org"
      :organization-id="upgradeOrgId"
      :team-name="newTeamName"
      :team-slug="newTeamSlug"
    />
  </div>
</template>
