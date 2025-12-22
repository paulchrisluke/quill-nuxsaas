export const useUserOrganizations = () => {
  const { organization } = useAuth()

  return useAsyncData('user-organizations', async () => {
    const { data, error } = await organization.list()
    if (error) {
      throw error
    }
    return data
  })
}
