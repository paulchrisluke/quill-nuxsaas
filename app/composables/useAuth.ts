import type {
  ClientOptions,
  InferSessionFromClient
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import type { User } from '~~/shared/utils/types'
import { stripeClient } from '@better-auth/stripe/client'
import { adminClient, anonymousClient, apiKeyClient, inferAdditionalFields, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'
import { computed, ref } from 'vue'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'

export const AUTH_USER_DEFAULTS: Partial<User> = {
  image: null,
  role: null,
  banReason: null,
  banned: null,
  banExpires: null,
  stripeCustomerId: null,
  isAnonymous: false
}

export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server ? useRequestHeaders() : undefined
  const runtimeConfig = useRuntimeConfig()
  const payment = runtimeConfig.public.payment as 'stripe'
  const client = createAuthClient({
    baseURL: url.origin,
    fetchOptions: {
      headers
    },
    plugins: [
      inferAdditionalFields({
        user: {
          referralCode: {
            type: 'string',
            required: false
          }
        },
        apiKey: {
          organizationId: {
            type: 'string'
          }
        }
      }),
      adminClient(),
      anonymousClient(),
      organizationClient({
        ac,
        roles: {
          owner,
          admin,
          member
        },
        enableMetadata: true
      }),
      apiKeyClient(),
      stripeClient({
        subscription: true
      })
    ]
  })

  // Create global state for active organization (SSR friendly)
  const useActiveOrgState = () => useState<any>('active-org-state', () => ({ data: null }))

  const session = useState<InferSessionFromClient<ClientOptions> | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const sessionFetching = import.meta.server ? ref(false) : useState('auth:sessionFetching', () => false)
  type SessionWithActiveOrg = InferSessionFromClient<ClientOptions> & { activeOrganizationId?: string }
  type SessionWithImpersonation = InferSessionFromClient<ClientOptions> & { impersonatedBy?: string | null }
  const getActiveOrganizationId = () => {
    const currentSession = session.value
    if (currentSession && typeof currentSession === 'object' && 'activeOrganizationId' in currentSession) {
      return (currentSession as SessionWithActiveOrg).activeOrganizationId ?? null
    }
    return null
  }
  const getImpersonatedBy = () => {
    const currentSession = session.value
    if (currentSession && typeof currentSession === 'object' && 'impersonatedBy' in currentSession) {
      return (currentSession as SessionWithImpersonation).impersonatedBy ?? null
    }
    return null
  }
  const isImpersonating = computed(() => !!getImpersonatedBy())

  // Subscriptions are derived from the active org state
  const subscriptions = computed(() => {
    const activeOrgState = useActiveOrgState()
    return (activeOrgState.value?.data as any)?.subscriptions || []
  })

  interface AuthSessionResponse {
    session: InferSessionFromClient<ClientOptions> | null
    user: User | null
  }

  const applyAuthSession = (data: AuthSessionResponse | null | undefined) => {
    session.value = data?.session || null
    user.value = data?.user
      ? Object.assign({}, AUTH_USER_DEFAULTS, data.user)
      : null
  }

  const fetchSession = async () => {
    if (sessionFetching.value) {
      return
    }
    sessionFetching.value = true

    try {
      const data = await $fetch<AuthSessionResponse>('/api/auth/get-session', {
        headers: import.meta.server ? useRequestHeaders() : undefined,
        retry: 0
      })
      applyAuthSession(data)
      // Subscriptions are now fetched via activeOrg (SSR)
      // No need to fetch them here separately
      return data
    } finally {
      sessionFetching.value = false
    }
  }

  if (import.meta.client) {
    client.$store.listen('$sessionSignal', async (signal) => {
      if (!signal)
        return
      await fetchSession()
    })
  }

  const useActiveOrganization = () => {
    const state = useActiveOrgState()
    return state
  }

  // Centralized function to refresh organization data
  const refreshActiveOrg = async () => {
    try {
      // Add cache-busting timestamp to bypass any HTTP/CDN caching
      const orgData: any = await $fetch(`/api/organization/full-data?_t=${Date.now()}`)

      // Flatten the structure to match what components expect
      // orgData comes as { organization: {...}, subscriptions: [...], userOwnsMultipleOrgs: bool, user: ... }
      // We want activeOrg.value.data to be { ...organization, subscriptions: [...], userOwnsMultipleOrgs: bool }
      const flattenedData = {
        ...orgData.organization,
        subscriptions: orgData.subscriptions,
        userOwnsMultipleOrgs: orgData.userOwnsMultipleOrgs,
        needsUpgrade: orgData.needsUpgrade
      }

      const state = useActiveOrgState()
      if (state.value) {
        state.value.data = flattenedData
      } else {
        state.value = { data: flattenedData }
      }
      return flattenedData
    } catch (error) {
      console.error('Failed to refresh active org:', error)
      return null
    }
  }

  return {
    client,
    session,
    user,
    organization: client.organization,
    useActiveOrganization, // Use our singleton wrapper
    subscription: client.subscription,
    subscriptions,
    loggedIn: computed(() => !!session.value),
    isAnonymousUser: computed(() => Boolean(user.value?.isAnonymous)),
    isAuthenticatedUser: computed(() => !!session.value && !!user.value && !user.value.isAnonymous),
    activeStripeSubscription: computed(() => {
      const activeOrgState = useActiveOrgState()
      const subs = (activeOrgState.value?.data as any)?.subscriptions || []
      if (!Array.isArray(subs))
        return undefined

      return subs.find(
        (sub: any) => sub.status === 'active' || sub.status === 'trialing'
      )
    }),
    refreshActiveOrg,
    signIn: client.signIn,
    signUp: client.signUp,
    forgetPassword: client.forgetPassword,
    resetPassword: client.resetPassword,
    sendVerificationEmail: client.sendVerificationEmail,
    errorCodes: client.$ERROR_CODES,
    async signOut({ redirectTo }: { redirectTo?: RouteLocationRaw } = {}) {
      await client.signOut({
        fetchOptions: {
          onSuccess: async () => {
            session.value = null
            user.value = null
            if (redirectTo) {
              await reloadNuxtApp({
                path: redirectTo.toString()
              })
            }
          }
        }
      })
    },
    fetchSession,
    applyAuthSession,
    getActiveOrganizationId,
    getImpersonatedBy,
    isImpersonating,
    payment
  }
}
