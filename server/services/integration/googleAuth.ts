import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

const TOKEN_REFRESH_BUFFER_MS = 60_000

interface RefreshTokenOptions {
  timeout?: number
  maxRetries?: number
}

/**
 * Determines if an error should be retried based on network errors or 5xx responses
 * Timeout errors are excluded from retry logic as retrying with the same timeout will likely fail again
 */
function shouldRetry(error: unknown): boolean {
  // Don't retry timeout errors - they will likely timeout again with the same duration
  if (error instanceof Error) {
    // Check for AbortError (timeout) - DOMException with name 'AbortError' or Error with name 'AbortError'
    if (
      (error.name === 'AbortError')
      || (error instanceof DOMException && error.name === 'AbortError')
    ) {
      return false
    }

    // Retry network errors (connection issues, DNS failures, etc.)
    // Check for common network error indicators
    const errorMessage = error.message.toLowerCase()
    if (
      errorMessage.includes('network')
      || errorMessage.includes('fetch')
      || errorMessage.includes('connection')
      || errorMessage.includes('econnrefused')
      || errorMessage.includes('enotfound')
      || errorMessage.includes('etimedout')
    ) {
      return true
    }
  }

  // Check for 5xx status codes in FetchError
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: number }).status
    if (status && status >= 500 && status < 600) {
      return true
    }
  }

  // Check for 5xx status codes in response
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { status?: number } }).response
    if (response?.status && response.status >= 500 && response.status < 600) {
      return true
    }
  }

  return false
}

/**
 * Calculates exponential backoff delay in milliseconds
 */
function getBackoffDelay(attempt: number, baseDelayMs: number = 1000): number {
  return Math.min(baseDelayMs * (2 ** attempt), 30000) // Cap at 30 seconds
}

export async function refreshGoogleAccessToken(
  db: NodePgDatabase<typeof schema>,
  account: typeof schema.account.$inferSelect,
  options: RefreshTokenOptions = {}
) {
  if (!account.refreshToken) {
    throw new Error('Google account is missing a refresh token.')
  }

  const { googleClientId, googleClientSecret, googleOAuthTokenTimeout, googleOAuthTokenMaxRetries } = runtimeConfig

  if (!googleClientId || !googleClientSecret) {
    throw new Error('Google OAuth client configuration is missing. Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.')
  }

  const timeout = options.timeout ?? googleOAuthTokenTimeout ?? 30000
  const maxRetries = options.maxRetries ?? googleOAuthTokenMaxRetries ?? 3

  const params = new URLSearchParams({
    client_id: googleClientId,
    client_secret: googleClientSecret,
    refresh_token: account.refreshToken,
    grant_type: 'refresh_token'
  })

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Make the request with timeout using AbortSignal.timeout
      const response = await $fetch<{
        access_token: string
        expires_in: number
        refresh_token?: string
      }>('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: params.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        signal: AbortSignal.timeout(timeout)
      })

      // Validate and coerce expires_in to a positive number
      // Parse as number, if NaN or <= 0 replace with default 3600
      let expiresInSeconds = Number(response.expires_in)
      if (Number.isNaN(expiresInSeconds) || expiresInSeconds <= 0) {
        if (response.expires_in !== undefined) {
          console.warn('[Google Auth] Invalid expires_in value received:', response.expires_in, '- using default 3600 seconds')
        }
        expiresInSeconds = 3600
      }

      // Update database with new token
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)

      const [updated] = await db
        .update(schema.account)
        .set({
          accessToken: response.access_token,
          refreshToken: response.refresh_token || account.refreshToken,
          accessTokenExpiresAt: expiresAt,
          updatedAt: new Date()
        })
        .where(eq(schema.account.id, account.id))
        .returning()

      return updated
    } catch (error) {
      lastError = error

      // Check if we should retry
      if (attempt < maxRetries && shouldRetry(error)) {
        const backoffDelay = getBackoffDelay(attempt)
        await new Promise(resolve => setTimeout(resolve, backoffDelay))
        continue
      }

      // Don't retry - either max retries reached or non-retryable error
      throw error
    }
  }

  // If we get here, all retries failed
  throw lastError || new Error('Failed to refresh Google access token after all retry attempts')
}

export async function ensureGoogleAccessToken(
  db: NodePgDatabase<typeof schema>,
  account: typeof schema.account.$inferSelect
) {
  if (
    account.accessToken &&
    account.accessTokenExpiresAt &&
    new Date(account.accessTokenExpiresAt).getTime() > Date.now() + TOKEN_REFRESH_BUFFER_MS
  ) {
    return account.accessToken
  }

  const refreshed = await refreshGoogleAccessToken(db, account)

  if (!refreshed || !refreshed.accessToken) {
    throw new Error('Failed to refresh Google access token: response did not include access_token.')
  }

  return refreshed.accessToken
}
