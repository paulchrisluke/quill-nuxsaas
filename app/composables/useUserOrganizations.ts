import type { UseAsyncDataOptions } from '#app'

type OrganizationList = any[]

export const useUserOrganizationsCache = () =>
  useState<OrganizationList | null>('user-organizations-cache', () => null)

/**
 * Shared org list with SSR enabled and client-side caching.
 * Use the default cache for shared UI (switcher, onboarding).
 * If you need fresh data, pass options that disable caching and avoid mixing options for the same key.
 */
export const useUserOrganizations = (
  options: UseAsyncDataOptions<OrganizationList, OrganizationList> = {}
) => {
  const { organization } = useAuth()
  const cache = useUserOrganizationsCache()

  const defaultOptions: UseAsyncDataOptions<OrganizationList, OrganizationList> = {
    server: true,
    lazy: true,
    getCachedData: () => cache.value
  }

  const mergedOptions: UseAsyncDataOptions<OrganizationList, OrganizationList> = {
    ...defaultOptions,
    ...options,
    getCachedData: options.getCachedData ?? defaultOptions.getCachedData
  }

  return useAsyncData('user-organizations', async () => {
    const { data, error } = await organization.list()
    if (error) {
      throw error
    }
    cache.value = data ?? []
    return data ?? []
  }, mergedOptions)
}
