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
import { computeNeedsUpgrade, computeUserOwnsMultipleOrgs } from '~~/shared/utils/organizationExtras'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'

export const AUTH_USER_DEFAULTS: Partial<User> = {
  image: null,
  role: null,
  banReason: null,
  banned: null,
  banExpires: null,
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
  const activeOrgState = useState<any>('active-org-state', () => ({ data: null }))

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
      const data = await $fetch<AuthSessionResponse>('/api/session', {
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
    return activeOrgState
  }

  // Centralized function to refresh organization data
  const refreshActiveOrg = async () => {
    try {
      const { data: orgData, error } = await client.organization.getFullOrganization({})
      if (error) {
        throw error
      }
      if (!orgData) {
        return null
      }

      const resolvedOrg = (orgData as any).organization ?? orgData
      if (!resolvedOrg?.id) {
        return null
      }

      const { data: subscriptions, error: subscriptionError } = await client.subscription.list({
        query: { referenceId: resolvedOrg.id }
      })
      if (subscriptionError) {
        throw subscriptionError
      }

      let ownershipInfo: { ownedCount: number, firstOwnedOrgId: string | null } | null = null
      try {
        ownershipInfo = await $fetch('/api/organization/ownership-info', {
          credentials: 'include',
          headers
        })
      } catch (error) {
        console.error('Failed to refresh ownership info:', error)
      }

      const flattenedData = {
        ...resolvedOrg,
        members: resolvedOrg.members ?? [],
        invitations: resolvedOrg.invitations ?? [],
        subscriptions: subscriptions ?? [],
        userOwnsMultipleOrgs: computeUserOwnsMultipleOrgs(ownershipInfo),
        needsUpgrade: computeNeedsUpgrade(resolvedOrg.id, subscriptions ?? [], ownershipInfo)
      }

      console.log('[auth] Refreshed active org', {
        organizationId: resolvedOrg.id,
        hasMetadata: Boolean(resolvedOrg.metadata)
      })

      if (activeOrgState.value) {
        activeOrgState.value.data = flattenedData
      } else {
        activeOrgState.value = { data: flattenedData }
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
    forgetPassword: client.requestPasswordReset,
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
              await navigateTo(redirectTo)
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
