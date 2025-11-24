import { and, eq } from 'drizzle-orm'
import { member } from '~~/server/database/schema'
import * as schema from '~~/server/database/schema'
import { requireAuth, useServerAuth } from '~~/server/utils/auth'
import { getDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const query = getQuery(event)
  const organizationId = query.organizationId as string
  const provider = query.provider as string

  if (!organizationId || !provider) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Organization ID and Provider are required'
    })
  }

  const db = getDB()

  // Check if user is admin/owner of this org
  const membership = await db.select().from(member).where(and(
    eq(member.userId, user.id),
    eq(member.organizationId, organizationId)
  )).limit(1)

  if (membership.length === 0 || (membership[0].role !== 'owner' && membership[0].role !== 'admin')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You do not have permission to manage integrations for this organization'
    })
  }

  const auth = useServerAuth()

  // Helper function to check if account has YouTube scopes
  function hasYouTubeScopes(scope: string | null | undefined): boolean {
    return !!scope && (
      scope.includes('https://www.googleapis.com/auth/youtube') ||
      scope.includes('https://www.googleapis.com/auth/youtube.force-ssl')
    )
  }

  // For YouTube integrations, accounts are stored as 'google' provider with YouTube scopes
  if (provider === 'youtube') {
    // Find Google accounts with YouTube scopes for the current user
    const accounts = await db.select().from(schema.account).where(and(
      eq(schema.account.userId, user.id),
      eq(schema.account.providerId, 'google')
    ))

    // Find the account with YouTube scopes
    const youtubeAccount = accounts.find(acc => hasYouTubeScopes(acc.scope))

    if (!youtubeAccount) {
      throw createError({
        statusCode: 404,
        statusMessage: 'YouTube integration not found'
      })
    }

    // Try to unlink using Better Auth's API
    // If that fails, manually delete from database as fallback
    try {
      // If there's only one Google account, unlink by providerId
      // Otherwise, try to unlink by accountId (provider's account ID)
      if (accounts.length === 1) {
        await auth.api.unlinkAccount({
          body: {
            providerId: 'google'
          },
          headers: event.headers
        })
      } else {
        // Multiple Google accounts - try unlinking by the provider's accountId
        try {
          await auth.api.unlinkAccount({
            body: {
              providerId: 'google',
              accountId: youtubeAccount.accountId
            },
            headers: event.headers
          })
        } catch (error: any) {
          // If Better Auth can't find it by accountId, manually delete by database id
          if (error?.message?.includes('Account not found') || error?.message?.includes('not found')) {
            await db.delete(schema.account).where(eq(schema.account.id, youtubeAccount.id))
          } else {
            throw error
          }
        }
      }
    } catch (error: any) {
      // Fallback: manually delete the account if Better Auth API fails
      if (error?.message?.includes('Account not found') || error?.message?.includes('not found')) {
        await db.delete(schema.account).where(eq(schema.account.id, youtubeAccount.id))
      } else {
        throw error
      }
    }
    return { success: true }
  } else {
    // For other providers, use the provider directly
    const accounts = await db.select().from(schema.account).where(and(
      eq(schema.account.userId, user.id),
      eq(schema.account.providerId, provider)
    )).limit(1)

    if (accounts.length > 0) {
      await auth.api.unlinkAccount({
        body: {
          providerId: provider,
          accountId: accounts[0].id
        },
        headers: event.headers
      })
      return { success: true }
    } else {
      throw createError({
        statusCode: 404,
        statusMessage: `Integration not found for provider: ${provider}`
      })
    }
  }

  return { success: true }
})
