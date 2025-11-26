/**
 * Unified API endpoint that returns ALL data needed for organization pages
 * This reduces multiple API calls to a single request
 */

export default defineEventHandler(async (event) => {
  try {
    // Get the base URL for internal API calls
    const baseUrl = getRequestURL(event).origin
    const cookieHeader = getHeader(event, 'cookie') || ''

    // Fetch organization and subscriptions in parallel
    // These endpoints handle their own auth checks
    const [orgData, subscriptions] = await Promise.all([
      // Get full organization data (Better Auth endpoint)
      $fetch(`${baseUrl}/api/auth/organization/get-full-organization`, {
        headers: { cookie: cookieHeader }
      }).catch((err) => {
        console.error('Failed to fetch organization:', err)
        throw err
      }),
      // Get subscriptions (Better Auth endpoint)
      $fetch(`${baseUrl}/api/auth/subscription/list`, {
        query: {
          referenceId: event.context.session?.activeOrganizationId || ''
        },
        headers: { cookie: cookieHeader }
      }).catch((err) => {
        console.error('Failed to fetch subscriptions:', err)
        return []
      })
    ])

    if (!orgData) {
      throw createError({
        statusCode: 404,
        message: 'Organization not found'
      })
    }

    return {
      organization: orgData,
      subscriptions: Array.isArray(subscriptions) ? subscriptions : []
    }
  } catch (error: any) {
    console.error('Error fetching page data:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || 'Failed to fetch page data'
    })
  }
})
