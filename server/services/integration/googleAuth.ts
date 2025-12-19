import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

const TOKEN_REFRESH_BUFFER_MS = 60_000

export async function refreshGoogleAccessToken(
  db: NodePgDatabase<typeof schema>,
  account: typeof schema.account.$inferSelect
) {
  if (!account.refreshToken) {
    throw new Error('Google account is missing a refresh token.')
  }

  const { googleClientId, googleClientSecret } = runtimeConfig

  if (!googleClientId || !googleClientSecret) {
    throw new Error('Google OAuth client configuration is missing. Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.')
  }

  const params = new URLSearchParams({
    client_id: googleClientId,
    client_secret: googleClientSecret,
    refresh_token: account.refreshToken,
    grant_type: 'refresh_token'
  })

  const response = await $fetch<{
    access_token: string
    expires_in: number
    refresh_token?: string
  }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: params.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })

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
