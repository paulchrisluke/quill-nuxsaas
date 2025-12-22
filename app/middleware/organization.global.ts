export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, organization, fetchSession, refreshActiveOrg, getActiveOrganizationId } = useAuth()

  if (!loggedIn.value)
    return

  const routeSlug = to.params.slug as string
  const isOrgRoute = typeof to.name === 'string' && to.name.startsWith('slug-')
  if (!routeSlug || routeSlug === 't' || !isOrgRoute)
    return

  // Check if we need to switch organization
  const activeOrgId = getActiveOrganizationId()

  // Cache org list for the duration of the session to avoid refetching on every navigation
  const { data: orgs } = await useUserOrganizations()

  if (!orgs.value || orgs.value.length === 0)
    return

  const targetOrg = orgs.value.find((o: any) => o.slug === routeSlug)

  if (targetOrg) {
    if (targetOrg.id !== activeOrgId) {
      // Organization mismatch, set active organization
      await organization.setActive({ organizationId: targetOrg.id })
      await fetchSession()

      await refreshActiveOrg()
    }
  } else {
    // Invalid slug, redirect to first available org or handle error
    // We can redirect to the first org's dashboard if the user has access to any orgs
    const firstOrg = orgs.value?.[0]
    if (firstOrg) {
      // Prevent infinite redirect if we are already redirected
      const localePath = useLocalePath()
      const targetPath = localePath(`/${firstOrg.slug}/conversations`)
      if (to.path !== targetPath) {
        return navigateTo(targetPath)
      }
    }
  }
})
