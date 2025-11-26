import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable, subscription as subscriptionTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { createStripeClient } from '~~/server/utils/stripe'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }

  const body = await readBody(event)
  const { organizationId, newInterval } = body

  if (!organizationId || !newInterval) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields'
    })
  }

  const normalizedInterval = String(newInterval)
  if (!['month', 'year'].includes(normalizedInterval)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid newInterval; must be "month" or "year"'
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

  const stripe = createStripeClient()

  const subscriptions = await stripe.subscriptions.list({
    customer: org.stripeCustomerId,
    status: 'all',
    limit: 100
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

  const currentPriceId = subscription.items.data[0].price.id
  const monthlyPriceId = runtimeConfig.stripePriceIdProMonth
  const yearlyPriceId = runtimeConfig.stripePriceIdProYear

  const newPriceId = normalizedInterval === 'month' ? monthlyPriceId : yearlyPriceId

  if (currentPriceId === newPriceId) {
    return { success: true, message: 'Already on this plan' }
  }

  // Only allow upgrades (monthly to yearly)
  if (normalizedInterval === 'month') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Downgrading from yearly to monthly is not supported'
    })
  }

  const quantity = subscription.items.data[0].quantity

  // Upgrade (M -> Y): Immediate with Proration
  const updateParams: Stripe.SubscriptionUpdateParams = {
    items: [{
      id: subscription.items.data[0].id,
      price: newPriceId,
      quantity
    }],
    proration_behavior: 'always_invoice'
  }

  if (subscription.status === 'trialing') {
    updateParams.trial_end = 'now'
  }

  let updatedSub: Stripe.Subscription
  try {
    updatedSub = await stripe.subscriptions.update(subscription.id, updateParams)
  } catch (err: any) {
    console.error('[change-plan] Stripe update failed', err)
    throw createError({
      statusCode: err?.statusCode || 400,
      statusMessage: err?.message || 'Unable to update subscription'
    })
  }

  // Update local database immediately
  const updateData: any = {
    plan: 'pro-yearly'
  }

  if (subscription.status === 'trialing' || updatedSub.status === 'active') {
    updateData.status = 'active'

    // If trial was ended (status changed from trialing to active), capture the trial_end timestamp
    if (subscription.status === 'trialing' && updatedSub.status === 'active' && updatedSub.trial_end) {
      updateData.trialEnd = new Date(updatedSub.trial_end * 1000)
      console.log('[change-plan] Trial ended at:', updateData.trialEnd)
    }
  }

  await db.update(subscriptionTable)
    .set(updateData)
    .where(eq(subscriptionTable.stripeSubscriptionId, subscription.id))

  return { success: true, message: 'Upgraded to yearly plan' }
})
