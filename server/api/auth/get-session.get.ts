import { getAuthSession } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  const user = session?.user ?? null

  return {
    session: session ?? null,
    user
  }
})
