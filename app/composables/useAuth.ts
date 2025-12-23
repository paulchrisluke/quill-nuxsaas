import { createAuthClient } from 'better-auth/vue'

export function useAuth() {
  let url: URL
  let headers: HeadersInit | undefined

  try {
    url = useRequestURL()
    headers = import.meta.server ? useRequestHeaders() : undefined
  } catch {
    // Fallback for Cloudflare Workers or when request context is not available
    if (import.meta.server) {
      const config = useRuntimeConfig()
      url = new URL(config.public.baseURL || 'http://localhost:3000')
    } else {
      url = new URL(window.location.origin)
    }
    headers = undefined
  }

  const client = createAuthClient({
    baseURL: url.origin,
    fetchOptions: {
      headers
    }
  })

  const session = useState<any>('auth:session', () => null)
  const user = useState<any>('auth:user', () => null)

  const fetchSession = async () => {
    try {
      const { data, error } = await client.getSession()
      if (error) {
        session.value = null
        user.value = null
        return
      }
      session.value = data?.session ?? null
      user.value = data?.user ?? null
    } catch {
      // Silently fail - user is not authenticated
      session.value = null
      user.value = null
    }
  }

  if (import.meta.server) {
    // Don't block page rendering - fetch session asynchronously
    fetchSession().catch(() => {
      // Ignore errors during SSR
    })
  } else {
    onMounted(() => {
      fetchSession()
    })
  }

  return {
    session: readonly(session),
    user: readonly(user),
    client,
    signIn: client.signIn,
    signOut: client.signOut
  }
}
