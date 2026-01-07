import { getAuthSession } from '~~/server/utils/auth'

type ExtendedSession = Awaited<ReturnType<typeof getAuthSession>> & {
  activeOrganizationId?: string | null
  impersonatedBy?: string | null
}

const getCustomSessionProps = (session: ExtendedSession | null) => ({
  activeOrganizationId: session?.activeOrganizationId ?? null,
  impersonatedBy: session?.impersonatedBy ?? null
})

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  const typedSession = session as ExtendedSession | null
  const safeSession = getCustomSessionProps(typedSession)
  return {
    session: safeSession,
    user: session?.user ?? null
  }
})
