import { createError, getMethod, getRequestHeaders, getRequestURL, readRawBody } from 'h3'
import { getServerAuth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  try {
    const serverAuth = getServerAuth()

    // Construct Request from H3 event (works in both Node.js and Cloudflare Workers)
    const url = getRequestURL(event)
    const method = getMethod(event) || 'GET'
    const headers = new Headers(getRequestHeaders(event) as Record<string, string>)
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(event, false)

    const request = new Request(url, {
      method,
      headers,
      body: body ? (typeof body === 'string' ? body : new Uint8Array(body)) : undefined
    })

    // Better Auth handler returns a Response - Nitro supports returning Response objects directly
    // Add timeout for Cloudflare Workers (30s max execution time)
    const timeoutMs = 25000 // 25 seconds to leave buffer
    const handlerPromise = serverAuth.handler(request)

    const timeoutPromise = new Promise<Response>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Auth handler timeout after ${timeoutMs}ms for ${method} ${url.pathname}`))
      }, timeoutMs)
    })

    const response = await Promise.race([handlerPromise, timeoutPromise])
    return response
  } catch (error) {
    console.error('[Auth] Unhandled error in auth handler:', error)
    if (error instanceof Error) {
      console.error('[Auth] Error stack:', error.stack)
      console.error('[Auth] Error name:', error.name)
      console.error('[Auth] Error message:', error.message)
    }
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    })
  }
})
