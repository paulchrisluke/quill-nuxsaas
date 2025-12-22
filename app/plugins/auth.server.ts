import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { getAuthSession, getSessionOrganizationId } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineNuxtPlugin({
  name: 'better-auth-fetch-plugin',
  enforce: 'pre',
  async setup(nuxtApp) {
    // Flag if request is cached
    nuxtApp.payload.isCached = Boolean(useRequestEvent()?.context.cache)
    if (nuxtApp.payload.serverRendered && !nuxtApp.payload.prerenderedAt && !nuxtApp.payload.isCached) {
      const event = useRequestEvent()
      const route = useRoute()
      const { loggedIn, session, fetchSession } = useAuth()

      // Fetch session first to check if user is logged in
      // Get session directly from server first to ensure state is set before layout renders
      const authSession = await getAuthSession(event)
      const { session: sessionState, user: userState } = useAuth()

      if (authSession) {
        // Set session state directly to ensure layout sees it immediately
        sessionState.value = (authSession as any)?.session || (authSession as any)?.data?.session || null
        if ((authSession as any)?.user) {
          userState.value = (authSession as any).user
        }
      }

      // Then call fetchSession to ensure useFetch cache is populated
      await fetchSession()

      // If logged in and we have a route slug, set active organization on server side
      if (loggedIn.value && import.meta.server && event) {
        const routeSlug = route.params.slug as string
        if (routeSlug && routeSlug !== 't') {
          try {
            // Get current session from server
            const authSession = await getAuthSession(event)
            const activeOrgId = getSessionOrganizationId(authSession)
            const userId = (authSession as any)?.user?.id

            if (userId) {
              // Query database directly to find organization matching the slug
              const db = getDB()
              const [targetOrg] = await db
                .select({
                  id: schema.organization.id,
                  slug: schema.organization.slug
                })
                .from(schema.organization)
                .innerJoin(schema.member, eq(schema.member.organizationId, schema.organization.id))
                .where(
                  and(
                    eq(schema.organization.slug, routeSlug),
                    eq(schema.member.userId, userId)
                  )
                )
                .limit(1)

              // If we found a matching org and it's not already active, set it
              if (targetOrg && targetOrg.id !== activeOrgId) {
                console.log('[auth.server] Setting active organization:', { routeSlug, targetOrgId: targetOrg.id, currentActiveOrgId: activeOrgId })

                // Set active organization via internal API call
                const headers = useRequestHeaders()
                const baseURL = useRequestURL().origin

                await $fetch('/api/auth/organization/set-active', {
                  method: 'POST',
                  baseURL,
                  headers: {
                    ...headers,
                    cookie: headers.cookie || ''
                  },
                  body: {
                    organizationId: targetOrg.id
                  }
                })

                // Refresh session to get updated activeOrganizationId
                // Get fresh session from server and update client state
                const updatedSession = await getAuthSession(event)
                const updatedActiveOrgId = getSessionOrganizationId(updatedSession)

                // Update session state directly to ensure layout sees the updated state
                if (updatedSession) {
                  session.value = (updatedSession as any)?.session || (updatedSession as any)?.data?.session || null
                  if ((updatedSession as any)?.user) {
                    const { user } = useAuth()
                    user.value = (updatedSession as any).user
                  }
                }

                console.log('[auth.server] Active organization updated:', { updatedActiveOrgId, expected: targetOrg.id })
              } else {
                console.log('[auth.server] Active organization already set:', { routeSlug, activeOrgId, targetOrgId: targetOrg?.id })
              }
            }
          } catch (error) {
            // Silently fail - client middleware will handle it
            console.error('[auth.server] Failed to set active organization:', error)
          }
        }
      }
    }
  }
})
