import type {
  ClientOptions,
  InferSessionFromClient
} from 'better-auth/client'
import type { RouteLocationRaw } from 'vue-router'
import { stripeClient } from '@better-auth/stripe/client'
import { adminClient, inferAdditionalFields, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'

interface AuthSessionPayload {
  session: InferSessionFromClient<ClientOptions> | null
  user: User | null
}

type ForgetPasswordHandler = (params: { email: string, redirectTo?: string }) => Promise<{ error?: { message?: string, statusText?: string } | null }>

export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server ? useRequestHeaders() : undefined
  const runtimeConfig = useRuntimeConfig()
  const payment = runtimeConfig.public.payment as 'stripe' | 'polar'
  const client = createAuthClient({
    baseURL: url.origin,
    fetchOptions: {
      headers
    },
    plugins: [
      inferAdditionalFields({
        user: {
          polarCustomerId: {
            type: 'string'
          }
        }
      }),
      adminClient(),
      organizationClient({
        ac,
        roles: {
          owner,
          admin,
          member
        }
      }),
      stripeClient({
        subscription: true
      })
    ]
  })

  const ensureForgetPasswordAvailable = () => {
    const handler = (client as { forgetPassword?: ForgetPasswordHandler }).forgetPassword
    if (!handler) {
      const message = '[useAuth] Password reset is not enabled for this deployment.'
      console.warn(message)
      throw new Error('Password reset is not enabled for this deployment.')
    }
    return handler
  }

  /**
   * Optional Better Auth password reset helper.
   * Consumers must check that `forgetPassword` is defined before calling; this wrapper throws if the handler was not configured.
   */
  const forgetPassword: ForgetPasswordHandler | undefined = client.forgetPassword
    ? async params => ensureForgetPasswordAvailable()(params)
    : undefined
  const _maybeForgetPassword = forgetPassword

  // Create global state for active organization (SSR friendly)
  const useActiveOrgState = () => useState<any>('active-org-state', () => ({ data: null }))

  const session = useState<InferSessionFromClient<ClientOptions> | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const sessionFetching = import.meta.server ? ref(false) : useState('auth:sessionFetching', () => false)

  // Subscriptions are derived from the active org state
  const subscriptions = computed(() => {
    const activeOrgState = useActiveOrgState()
    return (activeOrgState.value?.data as any)?.subscriptions || []
  })

  const fetchSession = async () => {
    if (sessionFetching.value) {
      return
    }
    sessionFetching.value = true

    // Use useFetch for better SSR support and hydration
    const { data: sessionData } = await useFetch<AuthSessionPayload>('/api/auth/get-session', {
      headers: import.meta.server ? useRequestHeaders() : undefined,
      key: 'auth-session',
      retry: 0
    })

    const data = sessionData.value
    session.value = data?.session || null

    const userDefaults = {
      image: null,
      role: null,
      banReason: null,
      banned: null,
      banExpires: null,
      stripeCustomerId: null
    }
    user.value = data?.user
      ? Object.assign({}, userDefaults, data.user)
      : null

    sessionFetching.value = false
    return data
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
  let refreshActiveOrgPromise: Promise<any> | null = null
  let lastRefreshTime = 0

  const refreshActiveOrg = async () => {
    const now = Date.now()

    // Prevent multiple simultaneous calls
    if (refreshActiveOrgPromise) {
      console.log('[refreshActiveOrg] Already refreshing, returning existing promise')
      return refreshActiveOrgPromise
    }

    // Prevent calls within 1 second of each other
    if (now - lastRefreshTime < 1000) {
      console.log('[refreshActiveOrg] Called too recently, skipping')
      return null
    }

    lastRefreshTime = now

    refreshActiveOrgPromise = (async () => {
      try {
        const orgData: any = await $fetch('/api/organization/full-data')

        // Flatten the structure to match what components expect
        // orgData comes as { organization: {...}, subscriptions: [...], user: ... }
        // We want activeOrg.value.data to be { ...organization, subscriptions: [...] }
        const flattenedData = {
          ...orgData.organization,
          subscriptions: orgData.subscriptions
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
      } finally {
        refreshActiveOrgPromise = null
      }
    })()

    return refreshActiveOrgPromise
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
    forgetPassword,
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
    payment
  }
}
