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
 */
function shouldRetry(error: unknown): boolean {
  // Network errors (fetch aborted, connection issues, etc.)
  if (error instanceof Error) {
    // AbortController errors
    if (error.name === 'AbortError' || error.message.includes('aborted')) {
      return true
    }
    // Network errors
    if (error.message.includes('network') || error.message.includes('fetch')) {
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

      // Update database with new token
      const expiresAt = new Date(Date.now() + (response.expires_in || 3600) * 1000)

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
