import { getAuthSession, useServerAuth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const path = event.path || event.node.req.url?.split('?')[0] || ''
  if (path.includes('get-session')) {
    const session = await getAuthSession(event)
    return {
      session: session ?? null,
      user: session?.user ?? null
    }
  }

  const serverAuth = useServerAuth()
  return serverAuth.handler(toWebRequest(event))
})
