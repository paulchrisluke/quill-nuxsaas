import { getAuthSession } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  const safeSession = session
    ? {
        activeOrganizationId: (session as any).activeOrganizationId ?? null,
        impersonatedBy: (session as any).impersonatedBy ?? null
      }
    : null
  return {
    session: safeSession,
    user: session?.user ?? null
  }
})
