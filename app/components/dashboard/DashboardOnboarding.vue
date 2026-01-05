<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import { getSiteConfigFromMetadata } from '~~/shared/utils/siteConfig'

const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const route = useRoute()
const localePath = useLocalePath()

const organizationId = computed(() => activeOrg.value?.data?.id || 'unknown')
const orgSlug = computed(() => {
  const param = route.params.slug
  const routeSlug = Array.isArray(param) ? param[0] : param
  return routeSlug || activeOrg.value?.data?.slug || ''
})

const { data: integrationsResponse, refresh: refreshIntegrations } = useFetch('/api/organization/integrations', {
  key: () => `dashboard-onboarding-integrations-${organizationId.value}`,
  watch: [organizationId],
  default: () => ({ data: [] }),
  immediate: false
})

onMounted(() => {
  if (organizationId.value) {
    refreshIntegrations()
  }
})

const siteConfig = computed(() => getSiteConfigFromMetadata(activeOrg.value?.data?.metadata))

const siteSettingsComplete = computed(() => {
  const config = siteConfig.value
  return Boolean(
    config.publisher?.name
    || config.publisher?.url
    || config.author?.name
    || config.blog?.name
    || config.blog?.url
    || (config.categories && config.categories.length > 0)
  )
})

const hasIntegration = (type: string) => {
  const list = integrationsResponse.value?.data || []
  return list.some((item: any) => (item.type === type || item.provider === type) && item.isActive)
}

const items = computed(() => [
  {
    key: 'site-settings',
    title: 'Complete site settings',
    description: 'Set your publisher, author, and blog defaults.',
    complete: siteSettingsComplete.value,
    to: orgSlug.value ? localePath(`/${orgSlug.value}/content/site-config`) : null
  },
  {
    key: 'youtube',
    title: 'Connect YouTube',
    description: 'Pull in videos and transcripts automatically.',
    complete: hasIntegration('youtube'),
    to: orgSlug.value ? localePath(`/${orgSlug.value}/integrations`) : null
  },
  {
    key: 'github',
    title: 'Connect GitHub',
    description: 'Publish drafts and open PRs from the workspace.',
    complete: hasIntegration('github'),
    to: orgSlug.value ? localePath(`/${orgSlug.value}/integrations`) : null
  }
])

const allComplete = computed(() => items.value.every(item => item.complete))
const dismissedKey = computed(() => `dashboard-onboarding-dismissed:${organizationId.value}`)
const dismissed = useStorage(dismissedKey, false)

watch(allComplete, (value) => {
  if (value) {
    dismissed.value = true
  }
})
</script>

<template>
  <UCard
    v-if="!dismissed && !allComplete"
    class="w-full"
  >
    <template #header>
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-1">
          <p class="text-sm font-semibold">
            Getting started
          </p>
          <p class="text-xs text-muted-500">
            Finish these steps to unlock the full workspace.
          </p>
        </div>
        <UButton
          icon="i-lucide-x"
          size="xs"
          variant="ghost"
          color="neutral"
          aria-label="Dismiss onboarding"
          @click="dismissed = true"
        />
      </div>
    </template>

    <div class="space-y-3">
      <div
        v-for="item in items"
        :key="item.key"
        class="flex items-start gap-3 rounded-lg border border-neutral-200/60 dark:border-neutral-800/60 p-3"
      >
        <UIcon
          :name="item.complete ? 'i-lucide-check-circle-2' : 'i-lucide-circle'"
          class="h-5 w-5 flex-shrink-0"
          :class="item.complete ? 'text-emerald-500' : 'text-muted-400'"
        />
        <div class="min-w-0 flex-1">
          <p
            class="text-sm font-medium"
            :class="item.complete ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'"
          >
            {{ item.title }}
          </p>
          <p
            class="text-xs"
            :class="item.complete ? 'text-muted-400' : 'text-muted-500'"
          >
            {{ item.description }}
          </p>
        </div>
        <UButton
          v-if="!item.complete && item.to"
          :to="item.to"
          size="xs"
          variant="ghost"
          color="neutral"
        >
          Open
        </UButton>
      </div>
    </div>
  </UCard>
</template>
