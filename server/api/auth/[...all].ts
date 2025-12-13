import { createError, sendWebResponse, toWebRequest } from 'h3'
import { getServerAuth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  try {
    const serverAuth = getServerAuth()
    const request = toWebRequest(event)
    const response = await serverAuth.handler(request)
    return sendWebResponse(event, response)
  } catch (error) {
    console.error('[Auth] Unhandled error in auth handler:', error)
    if (error instanceof Error) {
      console.error('[Auth] Error stack:', error.stack)
    }
    // Return a proper error response instead of letting it bubble up as 500
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    })
  }
})
