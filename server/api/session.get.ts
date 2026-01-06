import { getAuthSession } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  return {
    session: session ?? null,
    user: session?.user ?? null
  }
})
