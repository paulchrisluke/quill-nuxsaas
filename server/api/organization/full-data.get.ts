/**
 * Server-side only endpoint that fetches ALL organization data
 * Queries database directly - NO HTTP calls, NO Better Auth API calls
 */

import { eq } from 'drizzle-orm'
import { organization as organizationTable, subscription as subscriptionTable } from '../../database/schema'
import { getAuthSession } from '../../utils/auth'
import { useDB } from '../../utils/db'

export default defineEventHandler(async (event) => {
  try {
    const db = await useDB()

    // Use Better Auth's official session retrieval
    // This handles cookie parsing, signature verification, and caching automatically
    const session = await getAuthSession(event)

    if (!session || !session.user) {
      throw createError({
        statusCode: 401,
        message: 'Invalid session'
      })
    }

    console.log('Session found:', { userId: session.user.id, activeOrgId: session.session.activeOrganizationId })

    const activeOrgId = session.session.activeOrganizationId

    if (!activeOrgId) {
      console.error('No activeOrganizationId in session:', session)
      throw createError({
        statusCode: 400,
        message: 'No active organization'
      })
    }

    // Fetch organization with all relations in a single database query
    const org = await db.query.organization.findFirst({
      where: eq(organizationTable.id, activeOrgId),
      with: {
        members: {
          with: {
            user: true
          }
        },
        invitations: true
      }
    })

    if (!org) {
      throw createError({
        statusCode: 404,
        message: 'Organization not found'
      })
    }

    // Verify that the current user is a member of this organization
    const isMember = org.members.some((m: any) => m.userId === session.user.id)
    if (!isMember) {
      console.warn(`User ${session.user.id} attempted to access org ${activeOrgId} without membership`)
      throw createError({
        statusCode: 403,
        message: 'You are not a member of this organization'
      })
    }

    // Fetch subscriptions for this organization
    const subscriptions = await db.query.subscription.findMany({
      where: eq(subscriptionTable.referenceId, activeOrgId)
    })

    console.log('[API] Full Data - Org:', activeOrgId, 'Subs found:', subscriptions.length)

    return {
      organization: org,
      subscriptions: subscriptions || [],
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name
      }
    }
  } catch (error: any) {
    console.error('Error fetching full organization data:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || 'Failed to fetch organization data'
    })
  }
})
