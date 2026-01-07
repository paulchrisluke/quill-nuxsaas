export default defineNuxtPlugin(() => {
  const route = useRoute()
  const localePath = useLocalePath()
  const { loggedIn, user, organization, refreshActiveOrg, getActiveOrganizationId, useActiveOrganization } = useAuth()
  const activeOrg = useActiveOrganization()
  const { data: orgs, refresh: refreshOrgs } = useUserOrganizations()
  const syncing = ref(false)

  const normalizeSlug = (value: string | string[] | undefined) => {
    if (Array.isArray(value))
      return value[0]
    return value
  }

  const isOrgRoute = computed(() => typeof route.name === 'string' && route.name.startsWith('slug-'))

  const syncActiveOrganization = async () => {
    if (!loggedIn.value || user.value?.isAnonymous)
      return

    const routeSlug = normalizeSlug(route.params.slug)
    if (!routeSlug || routeSlug === 't' || !isOrgRoute.value)
      return

    const activeOrgId = getActiveOrganizationId()
    const activeOrgSlug = activeOrg.value?.data?.slug
    if (activeOrgId && activeOrgSlug && activeOrgSlug === routeSlug)
      return

    if (syncing.value)
      return

    syncing.value = true
    try {
      if (!orgs.value || orgs.value.length === 0) {
        await refreshOrgs()
      }

      const list = orgs.value ?? []
      if (!list.length)
        return

      const targetOrg = list.find((org: any) => org.slug === routeSlug)
      if (!targetOrg) {
        const fallback = list[0]
        if (fallback) {
          await navigateTo(localePath(`/${fallback.slug}/conversations`))
        }
        return
      }

      if (targetOrg.id !== activeOrgId) {
        await organization.setActive({ organizationId: targetOrg.id })
        await refreshActiveOrg()
        return
      }

      if (!activeOrg.value?.data?.id) {
        await refreshActiveOrg()
      }
    } finally {
      syncing.value = false
    }
  }

  watch([() => route.fullPath, loggedIn, () => user.value?.isAnonymous], () => {
    syncActiveOrganization().catch((error) => {
      console.error('Failed to sync active organization', error)
    })
  }, { immediate: true })
})
