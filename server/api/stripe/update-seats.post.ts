import { and, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }

  const body = await readBody(event)
  const { organizationId, seats, endTrial, newInterval } = body

  console.log('[update-seats] Request:', { organizationId, seats, endTrial, newInterval })

  if (!organizationId || !seats) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields'
    })
  }

  const db = await useDB()

  // Verify ownership
  const member = await db.query.member.findFirst({
    where: and(
      eq(memberTable.organizationId, organizationId),
      eq(memberTable.userId, session.user.id)
    )
  })

  if (!member || member.role !== 'owner') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden'
    })
  }

  const org = await db.query.organization.findFirst({
    where: eq(organizationTable.id, organizationId)
  })

  if (!org || !org.stripeCustomerId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Organization or Stripe Customer not found'
    })
  }

  const stripe = new Stripe(runtimeConfig.stripeSecretKey!)

  // Find active or trialing subscription
  const subscriptions = await stripe.subscriptions.list({
    customer: org.stripeCustomerId,
    limit: 10, // Fetch a few to be safe
    status: 'all'
  })

  const subscription = subscriptions.data.find(sub =>
    sub.status === 'active' || sub.status === 'trialing'
  )

  if (!subscription) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No active subscription found'
    })
  }

  // Determine new price ID if interval changes
  let newPriceId
  if (newInterval) {
    newPriceId = newInterval === 'month'
      ? runtimeConfig.stripePriceIdProMonth
      : runtimeConfig.stripePriceIdProYear
  }

  const subscriptionItemId = subscription.items.data[0].id

  // Update subscription params
  const updateParams: any = {
    items: [{
      id: subscriptionItemId,
      quantity: seats,
      ...(newPriceId ? { price: newPriceId } : {})
    }],
    proration_behavior: 'always_invoice'
  }

  if (endTrial) {
    updateParams.trial_end = 'now'
  }

  const updatedSubscription = await stripe.subscriptions.update(subscription.id, updateParams)

  console.log('[update-seats] Stripe Updated:', {
    id: updatedSubscription.id,
    status: updatedSubscription.status,
    cancel_at_period_end: updatedSubscription.cancel_at_period_end
  })

  // Update local database immediately
  const updateData: any = {
    seats: updatedSubscription.items.data[0].quantity
  }

  if (endTrial || updatedSubscription.status === 'active') {
    console.log('[update-seats] Forcing Active Status in DB')
    updateData.status = 'active'

    // If trial was ended, capture the actual trial_end timestamp from Stripe
    if (endTrial && updatedSubscription.trial_end) {
      updateData.trialEnd = new Date(updatedSubscription.trial_end * 1000)
      console.log('[update-seats] Trial ended at:', updateData.trialEnd)
    }

    // Also update any other stale trialing subscriptions for this org to avoid UI confusion
    // (In case of duplicate DB records)
    const bulkUpdateData: any = { status: 'active' }
    if (endTrial && updatedSubscription.trial_end) {
      bulkUpdateData.trialEnd = new Date(updatedSubscription.trial_end * 1000)
    }

    await db.update(subscriptionTable)
      .set(bulkUpdateData)
      .where(and(
        eq(subscriptionTable.referenceId, organizationId),
        eq(subscriptionTable.status, 'trialing')
      ))
  }

  console.log('[update-seats] DB Update Data:', updateData)

  await db.update(subscriptionTable)
    .set(updateData)
    .where(eq(subscriptionTable.stripeSubscriptionId, subscription.id))

  return { success: true, seats: updatedSubscription.items.data[0].quantity }
})
