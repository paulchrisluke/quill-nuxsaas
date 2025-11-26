import { and, eq } from 'drizzle-orm'
import { member as memberTable, organization as organizationTable } from '~~/server/database/schema'
import { getAuthSession } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'
import { createStripeClient } from '~~/server/utils/stripe'
import { PLANS } from '~~/shared/utils/plans'

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }

  const body = await readBody(event)
  const { organizationId, seats, newInterval } = body

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

  const stripe = createStripeClient()

  // Find subscription
  const subscriptions = await stripe.subscriptions.list({
    customer: org.stripeCustomerId,
    limit: 10,
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

  // If currently trialing, calculate locally and return immediately (No Proration/Stripe API needed)
  if (subscription.status === 'trialing') {
    const interval = newInterval || subscription.plan.interval
    const planConfig = interval === 'year' ? PLANS.PRO_YEARLY : PLANS.PRO_MONTHLY

    // Calculate total: Base Price + (Additional Seats * Seat Price)
    // Base Plan covers 1st seat. Additional seats = seats - 1.
    // Example: Base $99.99 + ((2-1) Seat * $50.00) = $149.99
    const additionalSeats = Math.max(0, seats - 1)
    const totalCents = Math.round((planConfig.priceNumber + (additionalSeats * planConfig.seatPriceNumber)) * 100)

    return {
      amountDue: totalCents,
      total: totalCents,
      subtotal: totalCents,
      currency: subscription.currency || 'usd',
      periodEnd: Math.floor(Date.now() / 1000) + (interval === 'year' ? 31536000 : 2592000),
      lines: []
    }
  }

  // Determine new price if interval changes
  let newPriceId
  if (newInterval) {
    newPriceId = newInterval === 'month'
      ? runtimeConfig.stripePriceIdProMonth
      : runtimeConfig.stripePriceIdProYear
  }

  const subscriptionItemId = subscription.items.data[0].id
  const currentItem = subscription.items.data[0]
  const priceId = newPriceId || currentItem.price.id

  // Use Stripe SDK v20 - createPreview supports flexible billing mode
  let upcomingInvoice
  try {
    upcomingInvoice = await stripe.invoices.createPreview({
      subscription: subscription.id,
      subscription_details: {
        proration_behavior: 'always_invoice',
        items: [
          {
            id: subscriptionItemId,
            quantity: seats,
            price: priceId
          }
        ]
      }
    })
    console.log('Stripe preview invoice:', upcomingInvoice.amount_due)
  } catch (e: any) {
    console.error('Stripe Invoice Preview Error:', e)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to calculate preview. ${e.message || ''}`
    })
  }

  return {
    amountDue: upcomingInvoice.amount_due,
    total: upcomingInvoice.total,
    subtotal: upcomingInvoice.subtotal,
    currency: upcomingInvoice.currency,
    periodEnd: upcomingInvoice.period_end,
    lines: upcomingInvoice.lines.data
  }
})
