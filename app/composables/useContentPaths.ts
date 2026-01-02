import { NON_ORG_SLUG } from '~~/shared/constants/routing'

export const useContentPaths = () => {
  const { useActiveOrganization } = useAuth()
  const activeOrg = useActiveOrganization()
  const localePath = useLocalePath()

  const resolveCreatedContentPath = (contentId: string) => {
    const slug = activeOrg.value?.data?.slug
    if (!slug || slug === NON_ORG_SLUG) {
      return null
    }
    return localePath(`/${slug}/content/${contentId}`)
  }

  return {
    resolveCreatedContentPath
  }
}
