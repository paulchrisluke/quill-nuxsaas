# Subscription Expiration & Member Management

## Overview
This document explains how to handle subscription expiration and automatically remove members when an organization's Pro plan expires.

## How It Works

### 1. Subscription Lifecycle
Better Auth Stripe plugin provides webhook handlers that automatically trigger when subscription status changes:

- `onSubscriptionComplete` - When subscription is created
- `onSubscriptionUpdate` - When subscription is updated
- `onSubscriptionCancel` - When subscription is canceled
- `onSubscriptionDeleted` - When subscription is deleted/expired

### 2. Member Removal Logic
When a subscription expires or is canceled:
1. Keep the **owner** (always)
2. Remove all **admins** and **members**
3. Organization reverts to Free plan (1 member limit)

## Implementation

### Step 1: Add Lifecycle Hooks to Better Auth Config

In `/server/utils/auth.ts`, add subscription hooks to your Stripe plugin configuration:

```typescript
import { removeExcessMembersOnExpiration } from './subscription-handlers'

stripe({
  // ... existing config
  subscription: {
    // ... existing subscription config
    
    // Handle subscription cancellation
    onSubscriptionCancel: async ({ subscription, stripeSubscription }) => {
      console.log(`Subscription canceled for org: ${subscription.referenceId}`)
      
      // Remove excess members when subscription is canceled
      await removeExcessMembersOnExpiration(subscription.referenceId)
    },
    
    // Handle subscription deletion/expiration
    onSubscriptionDeleted: async ({ subscription, stripeSubscription }) => {
      console.log(`Subscription deleted for org: ${subscription.referenceId}`)
      
      // Remove excess members when subscription expires
      await removeExcessMembersOnExpiration(subscription.referenceId)
    },
    
    // Handle trial expiration without conversion
    onTrialExpired: async (subscription, ctx) => {
      console.log(`Trial expired for org: ${subscription.referenceId}`)
      
      // Remove excess members when trial expires
      await removeExcessMembersOnExpiration(subscription.referenceId)
    }
  }
})
```

### Step 2: Use Helper Functions

The helper functions in `/server/utils/subscription-handlers.ts` provide:

#### Check if subscription is expired:
```typescript
import { isSubscriptionExpired } from '~/server/utils/subscription-handlers'

const expired = isSubscriptionExpired(subscription)
```

#### Get days until expiration:
```typescript
import { getDaysUntilExpiration } from '~/server/utils/subscription-handlers'

const daysLeft = getDaysUntilExpiration(subscription)
// Show warning if < 7 days
if (daysLeft < 7 && daysLeft > 0) {
  showExpirationWarning()
}
```

#### Manually remove excess members:
```typescript
import { removeExcessMembersOnExpiration } from '~/server/utils/subscription-handlers'

const result = await removeExcessMembersOnExpiration(organizationId)
console.log(`Removed ${result.removedCount} members`)
```

## Frontend Integration

### Show Expiration Warning

In your billing page or dashboard, show a warning when subscription is expiring soon:

```vue
<script setup>
const { data: subscriptions } = await client.subscription.list({
  query: { referenceId: orgId }
})

const activeSub = subscriptions?.find(s => s.status === 'active' || s.status === 'trialing')

const daysUntilExpiration = computed(() => {
  if (!activeSub?.periodEnd) return null
  const now = new Date()
  const periodEnd = new Date(activeSub.periodEnd)
  const diffTime = periodEnd.getTime() - now.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
})

const showExpirationWarning = computed(() => {
  return daysUntilExpiration.value !== null && 
         daysUntilExpiration.value < 7 && 
         daysUntilExpiration.value > 0
})
</script>

<template>
  <div v-if="showExpirationWarning" class="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
    <p class="text-sm text-amber-800 dark:text-amber-200">
      ⚠️ Your subscription expires in {{ daysUntilExpiration }} days. 
      All members except the owner will be removed when it expires.
    </p>
  </div>
</template>
```

## Testing

### Test Subscription Expiration Locally

1. Use Stripe CLI to trigger webhook events:
```bash
stripe trigger customer.subscription.deleted
```

2. Or use Stripe test mode to create a subscription with a short trial period

3. Check that members are removed when subscription expires

## Email Notifications (TODO)

Add email notifications in `/server/utils/subscription-handlers.ts`:

```typescript
// In removeExcessMembersOnExpiration function
for (const member of membersToRemove) {
  await sendEmail({
    to: member.user.email,
    subject: 'Removed from Organization',
    body: `You have been removed from ${organizationName} because the Pro subscription expired.`
  })
}
```

## Cron Job (Optional)

For extra safety, create a cron job to check for expired subscriptions daily:

```typescript
// /server/api/cron/check-expired-subscriptions.ts
export default defineEventHandler(async (event) => {
  // Verify cron secret
  const secret = getHeader(event, 'x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const db = getDB()
  
  // Find all subscriptions that expired
  const expiredSubs = await db.subscription.findMany({
    where: {
      periodEnd: { lt: new Date() },
      status: { notIn: ['active', 'trialing'] }
    }
  })

  for (const sub of expiredSubs) {
    await removeExcessMembersOnExpiration(sub.referenceId)
  }

  return { processed: expiredSubs.length }
})
```

## Summary

✅ **Automatic**: Webhooks handle expiration automatically
✅ **Safe**: Owner is never removed
✅ **Clean**: Reverts to Free plan (1 member)
✅ **Logged**: All actions are logged for debugging
✅ **Extensible**: Easy to add email notifications

The system automatically handles subscription lifecycle and keeps your organizations in sync with their subscription status!
