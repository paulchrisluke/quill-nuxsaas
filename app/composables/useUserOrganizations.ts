export const useUserOrganizations = () => {
  const { organization } = useAuth()

  return useAsyncData('user-organizations', async () => {
    const { data, error } = await organization.list()
    if (error) {
      console.error('[useUserOrganizations] Failed to load organizations', error)
      return []
    }
    return data
  })
}
