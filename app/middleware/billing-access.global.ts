export default defineNuxtRouteMiddleware(async (to, from) => {
  // 1. Never run on server
  if (import.meta.server)
    return

  console.log('[Billing Guard] to:', to.path, 'from:', from.path)

  // 2. Get organization from route slug
  const { loggedIn, organization } = useAuth()
  if (!loggedIn.value)
    return

  const routeSlug = to.params.slug as string || from.params.slug as string
  if (!routeSlug)
    return

  console.log('[Billing Guard] routeSlug:', routeSlug)

  // Use cached org list to avoid fetching on every navigation
  const { data: orgs } = await useAsyncData('user-organizations', async () => {
    const { data } = await organization.list()
    return data
  })

  if (!orgs.value || orgs.value.length === 0)
    return

  const targetOrg = orgs.value.find((o: any) => o.slug === routeSlug)
  if (!targetOrg)
    return

  const orgId = targetOrg.id
  console.log('[Billing Guard] orgId:', orgId)

  // 3. Store upgrade flag when entering billing page
  if (
    to.path.includes('/billing') &&
    to.query?.showUpgrade === 'true'
  ) {
    localStorage.setItem(`org_${orgId}_needsUpgrade`, 'true')
    console.log('[Billing Guard] Stored needsUpgrade flag for org:', orgId)
    return
  }

  // 4. Check if this org needs upgrade
  const needsUpgrade = localStorage.getItem(`org_${orgId}_needsUpgrade`) === 'true'
  console.log('[Billing Guard] needsUpgrade:', needsUpgrade)

  if (!needsUpgrade)
    return

  // 5. Check if route is unrestricted (billing, dashboard, home)
  const { isUnrestrictedRoute } = await import('~~/shared/utils/permissions')
  const isAllowed = isUnrestrictedRoute(to.path)
  console.log('[Billing Guard] isAllowed:', isAllowed, 'path:', to.path)

  if (isAllowed) {
    // Route is allowed even without upgrade
    return
  }

  // 6. Check subscription status
  let subs = []

  // Optimization: Check if activeOrg state already has the data for this org
  const { useActiveOrganization } = useAuth()
  const activeOrg = useActiveOrganization()

  if (activeOrg.value?.data?.id === orgId && Array.isArray((activeOrg.value.data as any).subscriptions)) {
    console.log('[Billing Guard] Using cached activeOrg subscriptions')
    subs = (activeOrg.value.data as any).subscriptions
  } else {
    try {
      subs = await $fetch('/api/auth/subscription/list', {
        query: { referenceId: orgId }
      })
    } catch (e) {
      console.error('Subscription check failed:', e)
    }
  }

  console.log('[Billing Guard] subs:', subs)

  const hasActiveSub = Array.isArray(subs) &&
    subs.some(
      (s: any) =>
        s.status === 'active' ||
        s.status === 'trialing'
    )

  console.log('[Billing Guard] hasActiveSub:', hasActiveSub)

  if (!hasActiveSub) {
    // No Pro subscription - redirect to billing page
    console.log('[Billing Guard] REDIRECTING TO BILLING!')
    return navigateTo(`/${routeSlug}/billing?showUpgrade=true`)
  }

  // 7. If they upgraded, clear the flag
  console.log('[Billing Guard] Has subscription, clearing flag')
  localStorage.removeItem(`org_${orgId}_needsUpgrade`)
})
