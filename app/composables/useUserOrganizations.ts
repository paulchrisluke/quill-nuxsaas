interface UserOrganization {
  id: string
  slug: string
  [key: string]: any
}

const USER_ORGANIZATIONS_KEY = 'user-organizations'

export function useUserOrganizations(options?: { lazy?: boolean }) {
  const { organization, user } = useAuth()

  const userId = computed(() => user.value?.id || 'anon')
  const cacheKey = computed(() => `${USER_ORGANIZATIONS_KEY}:${userId.value}`)

  const fetchOrganizations = async () => {
    try {
      const { data } = await organization.list()
      if (!Array.isArray(data)) {
        console.warn('[useUserOrganizations] Unexpected response shape', data)
        throw new Error('Organization list response is not an array')
      }
      const sanitized = data.filter((org: any): org is UserOrganization => typeof org?.id === 'string' && typeof org?.slug === 'string')
      if (sanitized.length !== data.length) {
        console.warn('[useUserOrganizations] Filtered organizations due to missing id/slug', { total: data.length, sanitized: sanitized.length })
      }
      return sanitized
    } catch (error) {
      console.error('[useUserOrganizations] Failed to fetch organizations', error)
      if (error instanceof Error)
        throw error
      throw new Error('Failed to fetch organizations')
    }
  }

  return useAsyncData<UserOrganization[]>(() => cacheKey.value, fetchOrganizations, {
    lazy: options?.lazy
  })
}
