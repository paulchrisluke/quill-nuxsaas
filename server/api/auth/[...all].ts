import { createError } from 'h3'
import { getServerAuth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  try {
    const serverAuth = getServerAuth()

    // Use toWebRequest and sendWebResponse which should work in both environments
    // These are standard H3 utilities that Nitro supports
    const { toWebRequest, sendWebResponse } = await import('h3')
    const request = toWebRequest(event)
    const response = await serverAuth.handler(request)
    return sendWebResponse(event, response)
  } catch (error) {
    console.error('[Auth] Unhandled error in auth handler:', error)
    if (error instanceof Error) {
      console.error('[Auth] Error stack:', error.stack)
      console.error('[Auth] Error name:', error.name)
      console.error('[Auth] Error message:', error.message)
    }
    // Return a proper error response instead of letting it bubble up as 500
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    })
  }
})
