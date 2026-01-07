import { toWebRequest } from 'h3'
import { getAuthSession, useServerAuth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const url = new URL(event.node.req.url || '', 'http://localhost')
  if (url.pathname === '/api/auth/get-session') {
    const session = await getAuthSession(event)
    return {
      session: session ?? null,
      user: session?.user ?? null
    }
  }

  const serverAuth = useServerAuth()
  return serverAuth.handler(toWebRequest(event))
})
