import { requireAuth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const path = event.path

  // Allow OpenAPI documentation endpoints without auth
  if (path?.startsWith('/api-reference') || path?.startsWith('/docs') || path?.startsWith('/_nitro/openapi')) {
    return
  }

  if (path?.startsWith('/api/admin')) {
    const user = await requireAuth(event)
    if (user.role !== 'admin') {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: 'Admin access required.'
      })
    }
  }
})
