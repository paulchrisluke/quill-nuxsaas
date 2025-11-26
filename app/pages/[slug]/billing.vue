<script setup lang="ts">
import { PLANS } from '~~/shared/utils/plans'

definePageMeta({
  layout: 'dashboard'
})

const { useActiveOrganization, subscription: stripeSubscription, client, refreshActiveOrg } = useAuth()
const activeOrg = useActiveOrganization()
const router = useRouter()
const toast = useToast()
const loading = ref(false)
const billingInterval = ref<'month' | 'year'>('month')
const route = useRoute()
const showDowngradeModal = ref(false)
const downgradeData = ref<{ membersToRemove: any[], nextChargeDate: string }>({ membersToRemove: [], nextChargeDate: '' })
const showUpgradeModal = ref(false)

// Show upgrade modal if showUpgrade query param is present
watchEffect(() => {
  if (route.query.showUpgrade === 'true') {
    showUpgradeModal.value = true
  }
})

// Handle Stripe success redirect - poll for updated subscription
onMounted(async () => {
  if (route.query.success === 'true') {
    loading.value = true

    // Poll for up to 10 seconds (5 attempts x 2s)
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
      // Wait 2s between checks
      await new Promise(resolve => setTimeout(resolve, 2000))

      console.log(`Checking for subscription update... (Attempt ${attempts + 1}/${maxAttempts})`)
      await refreshActiveOrg()

      // Check if we have a Pro subscription now
      const currentSubs = (activeOrg.value?.data as any)?.subscriptions || []
      const hasPro = currentSubs.some((s: any) => s.status === 'active' || s.status === 'trialing')

      if (hasPro) {
        console.log('Pro subscription found!')
        break
      }

      attempts++
    }

    loading.value = false

    // Clear the success param to clean up URL
    const newQuery = { ...route.query }
    delete newQuery.success
    router.replace({ query: newQuery })

    toast.add({
      title: 'Subscription updated',
      description: 'Your plan has been successfully updated.',
      color: 'success'
    })
  }
})

// We don't need to fetch subscriptions here because:
// 1. The layout already fetches 'get-full-organization' via SSR
// 2. That endpoint includes subscriptions
// 3. We just fixed useActiveOrganization() to use global state populated by the layout
// So we can just read the data directly!
const subscriptions = computed(() => {
  const data = activeOrg.value?.data
  // Check both direct subscriptions property (from get-full-organization response)
  // and if it's nested inside data (depending on how activeOrg is structured)
  return (data as any)?.subscriptions || []
})

// Refresh function for after mutations - re-fetches the whole org data
const refresh = async () => {
  await refreshActiveOrg()
}

const activeSub = computed(() => {
  if (!subscriptions.value)
    return null
  const subArray = Array.isArray(subscriptions.value) ? subscriptions.value : []
  return (subArray as any[]).find(
    sub => sub.status === 'active' || sub.status === 'trialing'
  )
})

// Sync billingInterval with active subscription
watch(activeSub, (sub) => {
  if (sub) {
    billingInterval.value = sub.plan?.includes('year') ? 'year' : 'month'
  }
}, { immediate: true })

const activePlan = computed(() => {
  return billingInterval.value === 'month' ? PLANS.PRO_MONTHLY : PLANS.PRO_YEARLY
})

const currentPlan = computed(() => {
  if (activeSub.value) {
    return 'pro'
  }
  return 'free'
})

const isCanceled = computed(() => {
  return activeSub.value?.cancelAtPeriodEnd
})

const trialInfo = computed(() => {
  if (!activeSub.value?.trialEnd)
    return null
  const trialEnd = new Date(activeSub.value.trialEnd)
  const now = new Date()
  const diffTime = trialEnd.getTime() - now.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return {
    daysLeft: diffDays > 0 ? diffDays : 0,
    endDate: trialEnd.toLocaleDateString()
  }
})

const nextChargeDate = computed(() => {
  if (activeSub.value?.periodEnd) {
    return new Date(activeSub.value.periodEnd).toLocaleDateString()
  }
  return null
})

// Cost breakdown
const costBreakdown = computed(() => {
  if (!activeSub.value)
    return null

  const plan = activePlan.value
  const seats = activeSub.value.seats || 1
  const additionalSeats = Math.max(0, seats - 1)

  const baseCost = plan.priceNumber
  const seatCost = additionalSeats * plan.seatPriceNumber
  const totalCost = baseCost + seatCost

  return {
    baseCost,
    seatCost,
    additionalSeats,
    totalSeats: seats,
    totalCost,
    interval: billingInterval.value
  }
})

// Modal State
const modal = reactive({
  isOpen: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  confirmColor: 'primary',
  onConfirm: async () => {}
})

function openModal(title: string, message: string, confirmLabel: string, confirmColor: string, onConfirm: () => Promise<void>) {
  modal.title = title
  modal.message = message
  modal.confirmLabel = confirmLabel
  modal.confirmColor = confirmColor
  modal.onConfirm = async () => {
    await onConfirm()
    modal.isOpen = false
  }
  modal.isOpen = true
}

async function handleUpgrade() {
  if (!activeOrg.value?.data?.id)
    return

  loading.value = true
  try {
    const planName = billingInterval.value === 'month' ? 'pro-monthly' : 'pro-yearly'

    const { error } = await stripeSubscription.upgrade({
      plan: planName,
      referenceId: activeOrg.value.data.id,
      successUrl: `${window.location.origin}/${activeOrg.value.data.slug}/billing?success=true`,
      cancelUrl: `${window.location.origin}/${activeOrg.value.data.slug}/billing?canceled=true`,
      metadata: {
        organizationId: activeOrg.value.data.id
      }
    })

    if (error) {
      throw error
    }
    // The SDK handles the redirect automatically
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to start checkout: ${e.message || 'Unknown error'}`)
    loading.value = false
  }
}

async function manageSubscription() {
  if (!activeOrg.value?.data?.id)
    return

  loading.value = true
  try {
    const { data, error } = await stripeSubscription.billingPortal({
      referenceId: activeOrg.value.data.id,
      returnUrl: window.location.href
    })

    if (error) {
      throw error
    }

    if (data?.url) {
      window.location.href = data.url
    }
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to open billing portal: ${e.message || 'Unknown error'}`)
  } finally {
    loading.value = false
  }
}

async function cancelSubscription() {
  if (!activeOrg.value?.data?.id)
    return
  if (!activeSub.value?.stripeSubscriptionId)
    return

  loading.value = true // Show loading while fetching members

  try {
    // Check for member limit (Free plan allows 1 member - the owner)
    const { data: response, error } = await client.organization.listMembers({
      query: {
        organizationId: activeOrg.value.data.id,
        limit: 100 // Fetch enough to cover reasonable teams
      }
    })

    if (error) {
      console.error('Failed to fetch members:', error)
    }

    const membersList = response?.members || []
    console.log('Cancellation Member Check:', { count: membersList.length, members: membersList })

    // Prepare downgrade data
    if (membersList.length > 1) {
      // Sort by createdAt desc (most recent first) to remove newest members
      const sortedMembers = [...membersList].sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      downgradeData.value.membersToRemove = sortedMembers.slice(0, membersList.length - 1)
    } else {
      downgradeData.value.membersToRemove = []
    }

    downgradeData.value.nextChargeDate = nextChargeDate.value || 'the end of your billing cycle'
    loading.value = false
    showDowngradeModal.value = true
  } catch (e) {
    console.error('Error preparing cancellation:', e)
    loading.value = false
  }
}

async function confirmDowngrade() {
  if (!activeOrg.value?.data?.id || !activeSub.value?.stripeSubscriptionId)
    return

  loading.value = true
  showDowngradeModal.value = false

  try {
    // Use custom API endpoint for cancellation to handle organization-based billing correctly
    await $fetch('/api/stripe/cancel', {
      method: 'POST',
      body: {
        subscriptionId: activeSub.value.stripeSubscriptionId,
        referenceId: activeOrg.value.data.id
      }
    })

    // Refresh subscription data to update UI
    await refresh()
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to cancel subscription: ${e.message || 'Unknown error'}`)
  } finally {
    loading.value = false
  }
}

async function resumeSubscription() {
  if (!activeOrg.value?.data?.id)
    return
  if (!activeSub.value?.stripeSubscriptionId)
    return

  const date = nextChargeDate.value || 'the next billing cycle'

  openModal(
    'Resume Subscription',
    `Are you sure you want to resume your subscription? Your plan will renew at no cost to you until the next billing cycle which is ${date}.`,
    'Yes, Resume',
    'primary',
    async () => {
      loading.value = true
      try {
        await $fetch('/api/stripe/resume', {
          method: 'POST',
          body: {
            subscriptionId: activeSub.value!.stripeSubscriptionId,
            referenceId: activeOrg.value!.data!.id
          }
        })

        // Refresh subscription data to update UI
        await refresh()
      } catch (e: any) {
        console.error(e)
        // eslint-disable-next-line no-alert
        alert(`Failed to resume subscription: ${e.message || 'Unknown error'}`)
      } finally {
        loading.value = false
      }
    }
  )
}

const planPreview = ref<any>(null)
const showPlanChangeModal = ref(false)
const newIntervalSelection = ref<'month' | 'year'>('month')

const seatChangePreview = ref<any>(null)
const showSeatChangeModal = ref(false)
const targetSeats = ref(1)

async function initiateSeatChange() {
  if (!activeOrg.value?.data?.id || !activeSub.value)
    return

  const currentSeats = activeSub.value.seats || 1

  // Determine member count to enforce limit
  // We need to fetch members if not available, or rely on client.organization.listMembers if activeOrg.members is missing
  // usage of activeOrg.value.data.members from members.vue suggests it might be populated if hydrated, but here maybe not.
  // Safe to fetch or assume user knows? Better to fetch/check.

  // For now, assume activeOrg.value.data.members might be undefined in billing.vue context if not fetched.
  // Let's quick fetch count to be safe or use existing if available.
  let memberCount = 0
  if (activeOrg.value.data.members) {
    memberCount = activeOrg.value.data.members.length
  } else {
    // Optimistic or fallback?
    // Let's fetch to be safe
    const { data } = await client.organization.listMembers({
      query: { organizationId: activeOrg.value.data.id, limit: 1 }
    })
    if (data?.total)
      memberCount = data.total // listMembers usually returns total
    // Or we can rely on existing 'cancelSubscription' logic which fetches members.
  }

  if (targetSeats.value < memberCount) {
    // eslint-disable-next-line no-alert
    alert(`You cannot reduce seats below your current member count (${memberCount}). Please remove members first.`)
    return
  }

  if (targetSeats.value === currentSeats)
    return

  loading.value = true
  seatChangePreview.value = null

  try {
    const preview = await $fetch('/api/stripe/preview-seat-change', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        seats: targetSeats.value
      }
    })
    seatChangePreview.value = preview
    showSeatChangeModal.value = true
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to load preview: ${e.data?.message || e.message}`)
  } finally {
    loading.value = false
  }
}

async function confirmSeatChange() {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true
  try {
    // End trial if user is on trial and adding seats to 2 or more
    const isTrialing = activeSub.value?.status === 'trialing'
    const shouldEndTrial = isTrialing && targetSeats.value >= 2

    await $fetch('/api/stripe/update-seats', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        seats: targetSeats.value,
        endTrial: shouldEndTrial
      }
    })
    showSeatChangeModal.value = false
    await refresh()
    // Reset target seats to new value
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to update seats: ${e.data?.message || e.message}`)
  } finally {
    loading.value = false
  }
}

// Initialize targetSeats when sub loads
watch(activeSub, (sub) => {
  if (sub)
    targetSeats.value = sub.seats || 1
}, { immediate: true })

async function initiatePlanChange() {
  if (!activeOrg.value?.data?.id || !activeSub.value)
    return

  const isYearly = activeSub.value.plan?.includes('year')
  newIntervalSelection.value = isYearly ? 'month' : 'year'

  // Fetch preview
  loading.value = true
  planPreview.value = null

  try {
    const currentSeats = activeSub.value.seats || 1

    const preview = await $fetch('/api/stripe/preview-seat-change', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        seats: currentSeats, // Keep same seats
        newInterval: newIntervalSelection.value
      }
    })

    planPreview.value = preview
    showPlanChangeModal.value = true
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to load plan preview: ${e.data?.message || e.message}`)
  } finally {
    loading.value = false
  }
}

async function confirmPlanChange() {
  if (!activeOrg.value?.data?.id)
    return

  loading.value = true
  try {
    const res = await $fetch('/api/stripe/change-plan', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value.data.id,
        newInterval: newIntervalSelection.value
      }
    })

    if (res.success) {
      showPlanChangeModal.value = false
      // alert(res.message)
      await refresh()
    }
  } catch (e: any) {
    console.error(e)
    // eslint-disable-next-line no-alert
    alert(`Failed to change plan: ${e.data?.message || e.message}`)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-8 max-w-5xl">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">
        Billing
      </h1>
      <div class="flex gap-2">
        <UButton
          v-if="currentPlan !== 'free'"
          label="Manage Billing"
          color="gray"
          variant="ghost"
          icon="i-lucide-credit-card"
          :loading="loading"
          class="cursor-pointer"
          @click="manageSubscription"
        />
        <UButton
          v-if="currentPlan !== 'free' && !isCanceled"
          label="Downgrade to Free"
          color="red"
          variant="ghost"
          :loading="loading"
          class="cursor-pointer"
          @click="cancelSubscription"
        />
        <UButton
          v-if="currentPlan !== 'free' && isCanceled"
          label="Resume Subscription"
          color="primary"
          variant="solid"
          :loading="loading"
          class="cursor-pointer"
          @click="resumeSubscription"
        />
      </div>
    </div>

    <!-- Current Plan Section -->
    <UCard>
      <div class="flex flex-col md:flex-row gap-6 justify-between">
        <div>
          <div class="flex items-center gap-3 mb-2">
            <h2 class="text-xl font-bold">
              {{ currentPlan === 'pro' ? 'Pro Plan' : 'Free Plan' }}
            </h2>
            <UBadge
              :color="currentPlan === 'pro' ? 'primary' : 'gray'"
              variant="solid"
            >
              Current plan
            </UBadge>
            <UBadge
              v-if="isCanceled"
              color="orange"
              variant="subtle"
            >
              Cancels on {{ nextChargeDate }}
            </UBadge>
            <UBadge
              v-if="activeSub?.status === 'trialing' && trialInfo"
              color="success"
              variant="subtle"
            >
              Trial Active: {{ trialInfo.daysLeft }} days left
            </UBadge>
          </div>

          <!-- Cost Breakdown -->
          <div
            v-if="costBreakdown"
            class="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg"
          >
            <h3 class="text-sm font-semibold mb-3">
              Current Cost Breakdown
            </h3>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Base Pro Plan (includes 1 seat)</span>
                <span class="font-medium">${{ costBreakdown.baseCost.toFixed(2) }}</span>
              </div>
              <div
                v-if="costBreakdown.additionalSeats > 0"
                class="flex justify-between"
              >
                <span class="text-muted-foreground">Additional Seats ({{ costBreakdown.additionalSeats }} × ${{ activePlan.seatPriceNumber.toFixed(2) }})</span>
                <span class="font-medium">${{ costBreakdown.seatCost.toFixed(2) }}</span>
              </div>
              <div class="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                <span class="font-semibold">Total per {{ costBreakdown.interval }}</span>
                <span class="font-bold text-lg">${{ costBreakdown.totalCost.toFixed(2) }}</span>
              </div>
              <div class="text-xs text-muted-foreground pt-1">
                Total seats: {{ costBreakdown.totalSeats }}
              </div>
            </div>
          </div>
          <div
            v-if="currentPlan === 'free'"
            class="text-4xl font-bold mb-1"
          >
            $0 <span class="text-base font-normal text-muted-foreground">/ month</span>
          </div>

          <div
            v-if="activeSub?.status === 'trialing' && trialInfo"
            class="text-sm text-muted-foreground mt-1"
          >
            Free trial ends on {{ trialInfo.endDate }}. You will be charged {{ activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.price : PLANS.PRO_MONTHLY.price }} on that date.
          </div>
          <div
            v-else-if="currentPlan === 'pro' && nextChargeDate && !isCanceled"
            class="text-sm text-muted-foreground mt-1"
          >
            Next charge on {{ nextChargeDate }}
          </div>

          <!-- Plan Switch Button (Only show for monthly -> yearly upgrade) -->
          <div
            v-if="currentPlan === 'pro' && !isCanceled && activeSub?.status !== 'trialing' && !activeSub?.plan?.includes('year')"
            class="mt-4"
          >
            <UButton
              variant="outline"
              size="sm"
              :loading="loading"
              @click="initiatePlanChange"
            >
              Switch to Yearly
            </UButton>
          </div>

          <!-- Seat Management -->
          <div
            v-if="currentPlan === 'pro' && !isCanceled"
            class="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800"
          >
            <h3 class="text-sm font-semibold mb-2">
              Manage Seats
            </h3>
            <div class="flex items-center gap-3">
              <div class="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg">
                <button
                  class="px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                  :disabled="targetSeats <= 1"
                  @click="targetSeats--"
                >
                  -
                </button>
                <div class="px-3 py-1 font-medium min-w-[3rem] text-center">
                  {{ targetSeats }}
                </div>
                <button
                  class="px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                  @click="targetSeats++"
                >
                  +
                </button>
              </div>
              <UButton
                size="sm"
                variant="solid"
                color="white"
                :disabled="targetSeats === (activeSub?.seats || 1)"
                :loading="loading"
                @click="initiateSeatChange"
              >
                Update
              </UButton>
            </div>
            <p class="text-xs text-muted-foreground mt-2">
              Current seats: {{ activeSub?.seats || 1 }}. Reducing seats below current member count requires removing members first.
            </p>
          </div>
        </div>

        <div class="flex-1">
          <h3 class="font-medium mb-3">
            What's included:
          </h3>
          <div class="grid grid-cols-1 gap-y-2">
            <div class="flex items-start gap-2 text-sm text-muted-foreground">
              <UIcon
                name="i-lucide-check"
                class="w-4 h-4 text-green-500 mt-0.5 shrink-0"
              />
              <span>WordPress Plugin Access</span>
            </div>
            <div class="flex items-start gap-2 text-sm text-muted-foreground">
              <UIcon
                name="i-lucide-check"
                class="w-4 h-4 text-green-500 mt-0.5 shrink-0"
              />
              <span>Basic Analytics (Total Searches)</span>
            </div>
            <div class="flex items-start gap-2 text-sm text-muted-foreground">
              <UIcon
                name="i-lucide-check"
                class="w-4 h-4 text-green-500 mt-0.5 shrink-0"
              />
              <span>Email Lead Notifications</span>
            </div>
            <div class="flex items-start gap-2 text-sm text-muted-foreground">
              <UIcon
                name="i-lucide-check"
                class="w-4 h-4 text-green-500 mt-0.5 shrink-0"
              />
              <span>Up to 3 Team Members</span>
            </div>
          </div>
        </div>
      </div>
    </UCard>

    <div
      v-if="currentPlan === 'free'"
      class="flex items-center gap-4"
    >
      <div class="h-8 w-[1px] bg-gray-200 dark:bg-gray-700" />
      <span class="text-sm font-medium text-muted-foreground">Upgrade plan</span>
    </div>

    <!-- Upgrade Section (Only show if free) -->
    <div
      v-if="currentPlan === 'free'"
      class="space-y-6"
    >
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">
            Upgrade plan
          </h2>
          <p class="text-sm text-muted-foreground mt-1">
            Unlock the full power of the Roofing CRM. Manage leads, run estimates, and grow your business.
          </p>
        </div>
        <div class="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          <button
            class="px-3 py-1 text-sm font-medium rounded-md transition-all"
            :class="billingInterval === 'month' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-muted-foreground'"
            @click="billingInterval = 'month'"
          >
            Monthly
          </button>
          <button
            class="px-3 py-1 text-sm font-medium rounded-md transition-all"
            :class="billingInterval === 'year' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-muted-foreground'"
            @click="billingInterval = 'year'"
          >
            Yearly
          </button>
        </div>
      </div>

      <!-- Pro Plan Card -->
      <UCard class="border-primary ring-1 ring-primary/50">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div class="flex flex-col justify-between">
            <div>
              <h3 class="text-xl font-bold mb-2">
                Pro Plan
              </h3>
              <div class="text-3xl font-bold mb-2">
                {{ activePlan.price }} <span class="text-base font-normal text-muted-foreground">/ {{ activePlan.interval }}</span>
              </div>
              <p class="text-sm text-muted-foreground mb-6">
                {{ activePlan.description }}
              </p>
            </div>
            <UButton
              block
              label="Upgrade to Pro"
              color="primary"
              :loading="loading"
              class="cursor-pointer mt-auto"
              @click="handleUpgrade"
            />
          </div>

          <div class="md:col-span-2 border-t md:border-t-0 md:border-l border-gray-100 dark:border-gray-800 pt-6 md:pt-0 md:pl-8">
            <h4 class="font-medium mb-4">
              Everything in Free, plus:
            </h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              <div
                v-for="(feature, i) in activePlan.features"
                :key="i"
                class="flex items-center gap-2 text-sm"
              >
                <UIcon
                  name="i-lucide-check-circle"
                  class="w-5 h-5 text-primary shrink-0"
                />
                <span>{{ feature }}</span>
              </div>
            </div>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Confirmation Modal -->
    <UModal
      v-model:open="modal.isOpen"
      :title="modal.title"
      :description="modal.message"
    >
      <template #footer>
        <UButton
          label="Cancel"
          color="gray"
          variant="ghost"
          @click="modal.isOpen = false"
        />
        <UButton
          :label="modal.confirmLabel"
          :color="modal.confirmColor"
          variant="solid"
          @click="modal.onConfirm"
        />
      </template>
    </UModal>

    <!-- Plan Change Modal -->
    <UModal
      v-model:open="showPlanChangeModal"
      :title="`Switch to ${newIntervalSelection === 'month' ? 'Monthly' : 'Yearly'} Plan`"
      :description="newIntervalSelection === 'month'
        ? `You are switching to Monthly billing. This change will take effect at the end of your current billing cycle.`
        : `You are switching to Yearly billing. You will be charged a prorated amount immediately.`"
    >
      <template #body>
        <div
          v-if="planPreview"
          class="space-y-4 text-sm"
        >
          <!-- Comparison View -->
          <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-center bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <div>
              <div class="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">
                Current
              </div>
              <div class="font-semibold text-lg">
                {{ (activeSub?.seats || 1) }} Seats
              </div>
              <div class="text-muted-foreground">
                ${{ (
                  (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber)
                  + (Math.max(0, (activeSub?.seats || 1) - 1) * (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber))
                ).toFixed(2) }}/{{ activeSub?.plan?.includes('year') ? 'yr' : 'mo' }}
              </div>
            </div>

            <UIcon
              name="i-lucide-arrow-right"
              class="w-6 h-6 text-gray-400"
            />

            <div>
              <div class="text-xs text-primary uppercase font-bold tracking-wider mb-1">
                New
              </div>
              <div class="font-semibold text-lg text-primary">
                {{ (activeSub?.seats || 1) }} Seats
              </div>
              <div class="text-primary font-medium">
                ${{ (
                  (newIntervalSelection === 'year' ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber)
                  + ((activeSub?.seats || 1) - 1) * (newIntervalSelection === 'year' ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber)
                ).toFixed(2) }}/{{ newIntervalSelection === 'year' ? 'yr' : 'mo' }}
              </div>
            </div>
          </div>

          <!-- Breakdown Details -->
          <div class="text-xs text-muted-foreground space-y-1 px-1">
            <div class="flex justify-between">
              <span>Base Plan (1st Seat):</span>
              <span>${{ (newIntervalSelection === 'year' ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber).toFixed(2) }}</span>
            </div>
            <div
              v-if="(activeSub?.seats || 1) > 1"
              class="flex justify-between"
            >
              <span>Additional Seats ({{ (activeSub?.seats || 1) - 1 }} x ${{ (newIntervalSelection === 'year' ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber).toFixed(2) }}):</span>
              <span>${{ (((activeSub?.seats || 1) - 1) * (newIntervalSelection === 'year' ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber)).toFixed(2) }}</span>
            </div>
          </div>

          <div
            v-if="newIntervalSelection === 'year'"
            class="flex justify-between pt-3 border-t border-gray-200 dark:border-gray-700 items-center"
          >
            <div>
              <div class="text-muted-foreground">
                {{ activeSub?.status === 'trialing' ? 'Amount due now (End Trial):' : 'Prorated amount due now:' }}
              </div>
              <div
                v-if="planPreview.periodEnd"
                class="text-xs text-muted-foreground/70"
              >
                New rate starts on {{ new Date(planPreview.periodEnd * 1000).toLocaleDateString() }}
              </div>
            </div>
            <span class="font-bold text-primary">${{ (planPreview.amountDue / 100).toFixed(2) }}</span>
          </div>
          <div
            v-else
            class="pt-3 border-t border-gray-200 dark:border-gray-700 text-center text-muted-foreground"
          >
            No payment due today. Change scheduled for {{ new Date(planPreview.periodEnd * 1000).toLocaleDateString() }}.
          </div>
        </div>
        <div
          v-else
          class="py-4 flex justify-center"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin w-6 h-6 text-primary"
          />
        </div>
      </template>

      <template #footer>
        <UButton
          label="Cancel"
          color="gray"
          variant="ghost"
          @click="showPlanChangeModal = false"
        />
        <UButton
          :label="`Confirm Switch to ${newIntervalSelection === 'month' ? 'Monthly' : 'Yearly'}`"
          color="primary"
          :loading="loading"
          @click="confirmPlanChange"
        />
      </template>
    </UModal>

    <!-- Seat Change Modal -->
    <UModal
      v-model:open="showSeatChangeModal"
      title="Update Seat Count"
    >
      <template #body>
        <div
          v-if="seatChangePreview"
          class="space-y-4 text-sm"
        >
          <p class="text-muted-foreground">
            {{ targetSeats > (activeSub?.seats || 1)
              ? `You are adding ${targetSeats - (activeSub?.seats || 1)} seat(s).`
              : `You are removing ${(activeSub?.seats || 1) - targetSeats} seat(s).`
            }}

            <span v-if="targetSeats < (activeSub?.seats || 1)">
              Your new rate will be <strong>${{ (
                (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber)
                + ((targetSeats - 1) * (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber))
              ).toFixed(2) }}/{{ activeSub?.plan?.includes('year') ? 'yr' : 'mo' }}</strong> starting on {{ new Date(seatChangePreview.periodEnd * 1000).toLocaleDateString() }}.
            </span>
          </p>

          <!-- Comparison View -->
          <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-center bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <!-- ... existing grid content ... -->
            <div>
              <div class="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">
                Current
              </div>
              <div class="font-semibold text-lg">
                {{ (activeSub?.seats || 1) }} Seats
              </div>
              <div class="text-muted-foreground">
                ${{ (
                  (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber)
                  + (Math.max(0, (activeSub?.seats || 1) - 1) * (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber))
                ).toFixed(2) }}/{{ activeSub?.plan?.includes('year') ? 'yr' : 'mo' }}
              </div>
            </div>

            <UIcon
              name="i-lucide-arrow-right"
              class="w-6 h-6 text-gray-400"
            />

            <div>
              <div class="text-xs text-primary uppercase font-bold tracking-wider mb-1">
                New
              </div>
              <div class="font-semibold text-lg text-primary">
                {{ targetSeats }} Seats
              </div>
              <div class="text-primary font-medium">
                ${{ (
                  (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber)
                  + ((targetSeats - 1) * (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber))
                ).toFixed(2) }}/{{ activeSub?.plan?.includes('year') ? 'yr' : 'mo' }}
              </div>
            </div>
          </div>

          <!-- Breakdown Details -->
          <div class="text-xs text-muted-foreground space-y-1 px-1">
            <div class="flex justify-between">
              <span>Base Plan (1st Seat):</span>
              <span>${{ (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber).toFixed(2) }}</span>
            </div>
            <div
              v-if="targetSeats > 1"
              class="flex justify-between"
            >
              <span>Additional Seats ({{ targetSeats - 1 }} x ${{ (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber).toFixed(2) }}):</span>
              <span>${{ ((targetSeats - 1) * (activeSub?.plan?.includes('year') ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber)).toFixed(2) }}</span>
            </div>
          </div>

          <!-- Only show due now/credit if non-zero -->
          <div
            v-if="seatChangePreview.amountDue !== 0"
            class="flex justify-between pt-3 border-t border-gray-200 dark:border-gray-700 items-center"
          >
            <div>
              <div class="text-muted-foreground">
                {{ activeSub?.status === 'trialing' ? 'Amount due now (End Trial):' : (seatChangePreview.amountDue > 0 ? 'Prorated amount due now:' : 'Credit applied to balance:') }}
              </div>
              <div
                v-if="seatChangePreview.periodEnd && seatChangePreview.amountDue > 0"
                class="text-xs text-muted-foreground/70"
              >
                New rate starts on {{ new Date(seatChangePreview.periodEnd * 1000).toLocaleDateString() }}
              </div>
            </div>
            <span
              class="font-bold"
              :class="seatChangePreview.amountDue > 0 ? 'text-primary' : 'text-green-600'"
            >
              {{ seatChangePreview.amountDue > 0 ? '' : '-' }}${{ (Math.abs(seatChangePreview.amountDue) / 100).toFixed(2) }}
            </span>
          </div>
        </div>
        <div
          v-else
          class="py-4 flex justify-center"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin w-6 h-6 text-primary"
          />
        </div>
      </template>

      <template #footer>
        <UButton
          label="Cancel"
          color="gray"
          variant="ghost"
          @click="showSeatChangeModal = false"
        />
        <UButton
          :label="targetSeats > (activeSub?.seats || 1) ? 'Confirm & Pay' : 'Confirm Reduction'"
          color="primary"
          :loading="loading"
          @click="confirmSeatChange"
        />
      </template>
    </UModal>

    <!-- Downgrade Confirmation Modal -->
    <UModal
      v-model:open="showDowngradeModal"
      title="Downgrade to Free Plan"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm">
            Your subscription will be canceled.
          </p>

          <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div class="flex items-center gap-2 text-sm">
              <UIcon
                name="i-lucide-calendar"
                class="w-4 h-4 text-blue-600 dark:text-blue-400"
              />
              <span class="font-medium">Active Until:</span>
              <span>{{ downgradeData.nextChargeDate }}</span>
            </div>
          </div>

          <div
            v-if="downgradeData.membersToRemove.length > 0"
            class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-3"
          >
            <div class="flex items-start gap-2">
              <UIcon
                name="i-lucide-alert-triangle"
                class="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
              />
              <div class="space-y-2 flex-1">
                <p class="font-semibold text-sm text-amber-900 dark:text-amber-100">
                  IMPORTANT
                </p>
                <p class="text-sm text-amber-800 dark:text-amber-200">
                  The Free plan only allows 1 member (you).
                </p>
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
                {{ downgradeData.membersToRemove.length }} member{{ downgradeData.membersToRemove.length > 1 ? 's' : '' }} will be removed when your plan downgrades:
              </p>
              <ul class="space-y-1.5 pl-1">
                <li
                  v-for="member in downgradeData.membersToRemove"
                  :key="member.id"
                  class="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
                >
                  <UIcon
                    name="i-lucide-user-minus"
                    class="w-4 h-4 shrink-0"
                  />
                  <span class="font-mono">{{ member.user.email }}</span>
                </li>
              </ul>
            </div>

            <p class="text-xs text-amber-700 dark:text-amber-300 pt-2 border-t border-amber-200 dark:border-amber-700">
              {{ downgradeData.membersToRemove.length > 1 ? 'These users' : 'This user' }} will lose access to this organization on {{ downgradeData.nextChargeDate }}.
            </p>
          </div>

          <div
            v-else
            class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3"
          >
            <div class="flex items-center gap-2 text-sm text-green-800 dark:text-green-200">
              <UIcon
                name="i-lucide-check-circle"
                class="w-4 h-4 text-green-600 dark:text-green-400"
              />
              <span>No members will be removed. Your team has 1 member, which fits within the Free plan limit.</span>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="showDowngradeModal = false"
        />
        <UButton
          label="Yes, Downgrade"
          color="red"
          :loading="loading"
          @click="confirmDowngrade"
        />
      </template>
    </UModal>

    <!-- Upgrade Modal for new teams -->
    <UpgradeModal
      v-model:open="showUpgradeModal"
      :organization-id="activeOrg?.data?.id"
      :team-name="activeOrg?.data?.name"
      :team-slug="activeOrg?.data?.slug"
    />
  </div>
</template>
