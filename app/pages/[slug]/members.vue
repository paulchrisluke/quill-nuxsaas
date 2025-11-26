<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { PLANS } from '~~/shared/utils/plans'

definePageMeta({
  layout: 'dashboard'
})

const { organization, useActiveOrganization, session, user, fetchSession, activeStripeSubscription, refreshActiveOrg, client } = useAuth()
const activeOrg = useActiveOrganization()
const toast = useToast()
const { copy } = useClipboard()

const inviteEmail = ref('')
const inviteRole = ref('member')
const loading = ref(false)
const route = useRoute()

// Get subscription data from activeOrg (already fetched by layout via full-data endpoint)
const subscriptionData = computed(() => {
  // Check if activeOrg has subscription data
  const subs = (activeOrg.value?.data as any)?.subscriptions

  console.log('[Members] Checking subscriptions:', subs)

  if (!subs || !Array.isArray(subs))
    return null
  return subs.find((s: any) => s.status === 'active' || s.status === 'trialing')
})

// Organization data is already available via useActiveOrganization()
// No need to fetch it again on page load

// Check if current user is admin or owner
const currentUserRole = computed(() => {
  if (!activeOrg.value?.data?.members || !user.value?.id)
    return null
  const member = activeOrg.value.data.members.find(m => m.userId === user.value.id)
  return member?.role || null
})

const canManageMembers = computed(() => {
  return currentUserRole.value === 'admin' || currentUserRole.value === 'owner'
})

// Check subscription status - use data from activeOrg
const isPro = computed(() => {
  const result = subscriptionData.value !== null && subscriptionData.value !== undefined
  console.log('isPro:', result, 'subscriptionData:', subscriptionData.value)
  return result
})

// Check if we need to set an active org on mount
onMounted(async () => {
  // Only set first org if there's truly no active org in the session
  if (!session.value?.activeOrganizationId) {
    const { data } = await organization.list()
    if (data && data.length > 0) {
      await organization.setActive({ organizationId: data[0].id })
      await useAuth().fetchSession()
    } else {
      // Redirect to onboarding if no teams exist
      navigateTo('/onboarding')
    }
  }

  // Check if returning from successful upgrade with pending invite
  // Just preserve the email and role in the input fields
  if (route.query.success === 'true' && route.query.pendingInviteEmail) {
    inviteEmail.value = route.query.pendingInviteEmail as string
    inviteRole.value = (route.query.pendingInviteRole as string) || 'member'

    // Clean up URL params
    navigateTo(route.path, { replace: true })
  }
})

const roles = [
  { label: 'Member', value: 'member' },
  { label: 'Admin', value: 'admin' },
  { label: 'Owner', value: 'owner' }
]

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function getInviteLink(invitationId: string) {
  return import.meta.client
    ? `${window.location.origin}/accept-invite/${invitationId}`
    : ''
}

async function copyLink(invitationId: string) {
  const link = getInviteLink(invitationId)
  if (link) {
    await copy(link)
    toast.add({ title: 'Link copied to clipboard', color: 'green' })
  }
}

async function refreshPage() {
  loading.value = true
  try {
    await fetchSession()
    await refreshActiveOrg()

    toast.add({ title: 'Data refreshed', color: 'success' })
  } catch {
    toast.add({ title: 'Error refreshing data', color: 'error' })
  } finally {
    loading.value = false
  }
}

// ─────────────────────────────────────────────
// Member Management
// ─────────────────────────────────────────────
async function updateMemberRole(memberId: string, newRole: string) {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true

  try {
    const { error } = await organization.updateMemberRole({
      organizationId: activeOrg.value.data.id,
      memberId,
      role: newRole as 'admin' | 'member' | 'owner'
    })

    if (error)
      throw error

    toast.add({ title: 'Role updated successfully', color: 'success' })
    await fetchSession()
    await refreshActiveOrg()
  } catch (e: any) {
    toast.add({
      title: 'Error updating role',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function removeMember(memberId: string) {
  if (!activeOrg.value?.data?.id)
    return

  // Confirm before removing
  // TODO: Replace with proper modal confirmation
  // eslint-disable-next-line no-alert
  if (!confirm('Are you sure you want to remove this member from the team?')) {
    return
  }

  loading.value = true

  try {
    const { error } = await organization.removeMember({
      organizationId: activeOrg.value.data.id,
      memberIdOrEmail: memberId
    })

    if (error)
      throw error

    toast.add({ title: 'Member removed successfully', color: 'success' })
    await fetchSession()
    await refreshActiveOrg()
  } catch (e: any) {
    toast.add({
      title: 'Error removing member',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

const showUpgradeModal = ref(false)
const selectedUpgradeInterval = ref<'month' | 'year'>('month')

async function handleUpgrade() {
  if (!activeOrg.value?.data?.id)
    return
  loading.value = true
  try {
    // Calculate intended quantity based on current state + potential invite
    const currentMembers = activeOrg.value.data.members.length || 1
    const pendingInvites = activeOrg.value.data.invitations.filter(i => i.status === 'pending').length
    const inviteCount = inviteEmail.value ? 1 : 0
    const quantity = currentMembers + pendingInvites + inviteCount

    const { error } = await client.subscription.upgrade({
      plan: selectedUpgradeInterval.value === 'month' ? 'pro-monthly' : 'pro-yearly',
      referenceId: activeOrg.value.data.id,
      metadata: {
        quantity: quantity > 0 ? quantity : 1
      },
      successUrl: `${window.location.origin}/${activeOrg.value.data.slug}/members?success=true${inviteEmail.value ? `&pendingInviteEmail=${encodeURIComponent(inviteEmail.value)}&pendingInviteRole=${inviteRole.value}` : ''}`,
      cancelUrl: `${window.location.origin}/${activeOrg.value.data.slug}/members?canceled=true`
    })

    if (error)
      throw error
  } catch (e: any) {
    console.error(e)
    toast.add({
      title: 'Failed to start checkout',
      description: e.data?.message || e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

// ─────────────────────────────────────────────
// Invite Member
// ─────────────────────────────────────────────
// ...
const addSeatPreview = ref<any>(null)
const seatInterval = ref<'month' | 'year'>('month')
const showAddSeatModal = ref(false)
const isEndingTrial = ref(false)
const errorMessage = ref('')

async function inviteMember() {
  try {
    if (!inviteEmail.value || !activeOrg.value?.data?.id)
      return

    // Check subscription status
    const isPro = !!activeStripeSubscription.value
    const isTrialing = activeStripeSubscription.value?.status === 'trialing'

    console.log('InviteMember: Checking status', { isPro, isTrialing })

    if (isTrialing) {
      console.log('InviteMember: In Trial, opening Add Seat Modal')
      // Trigger the seat upgrade flow to convert trial
      await openAddSeatModal()
      return
    }

    const currentMemberCount = activeOrg.value.data.members.length
    const pendingInvitesCount = activeOrg.value.data.invitations.filter(i => i.status === 'pending').length
    const totalCount = currentMemberCount + pendingInvitesCount

    if (!isPro && totalCount >= 1) {
      showUpgradeModal.value = true
      return
    }

    // If Pro, check purchased seats
    // totalCount is current usage, we're about to add 1 more, so check if totalCount + 1 > purchasedSeats
    if (isPro) {
      const purchasedSeats = Number(activeStripeSubscription.value?.seats) || 1
      console.log('InviteMember: Seat Check', { currentMembers: currentMemberCount, pendingInvites: pendingInvitesCount, totalCount, purchasedSeats })
      // Check if adding this invite would exceed purchased seats
      if (totalCount + 1 > purchasedSeats) {
        console.log('InviteMember: Would exceed limit, opening Add Seat Modal')
        await openAddSeatModal()
        return
      }
    }

    console.log('InviteMember: Proceeding to invite')
    loading.value = true

    const { error } = await organization.inviteMember({
      email: inviteEmail.value,
      role: inviteRole.value,
      organizationId: activeOrg.value.data.id
    })

    if (error)
      throw error

    toast.add({ title: 'Invitation sent', color: 'success' })
    inviteEmail.value = ''
    await fetchSession()
    await refreshActiveOrg()
  } catch (e: any) {
    console.error('InviteMember Error:', e)
    toast.add({
      title: 'Error inviting member',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function openAddSeatModal() {
  if (!activeStripeSubscription.value)
    return

  // Capture trial status at modal open time
  isEndingTrial.value = activeStripeSubscription.value.status === 'trialing'

  // Set default interval
  seatInterval.value = (activeStripeSubscription.value.plan === 'pro-yearly' || activeStripeSubscription.value.plan?.includes('year')) ? 'year' : 'month'

  showAddSeatModal.value = true
  await fetchSeatPreview()
}

async function fetchSeatPreview() {
  console.log('fetchSeatPreview: Starting...')
  loading.value = true
  errorMessage.value = ''
  addSeatPreview.value = null

  try {
    const currentSeats = activeStripeSubscription.value?.seats || 1

    console.log('fetchSeatPreview: Calling API', { currentSeats, isEndingTrial: isEndingTrial.value })

    const preview = await $fetch('/api/stripe/preview-seat-change', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value!.data!.id,
        seats: currentSeats + 1,
        newInterval: isEndingTrial.value ? seatInterval.value : undefined
      }
    })
    console.log('fetchSeatPreview: Success', preview)
    addSeatPreview.value = preview
  } catch (e: any) {
    console.error('fetchSeatPreview: Error', e)
    errorMessage.value = e.data?.message || e.message || 'Failed to load preview.'
    toast.add({
      title: 'Error loading preview',
      description: errorMessage.value,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

watch(seatInterval, () => {
  if (isEndingTrial.value) {
    fetchSeatPreview()
  }
})

async function confirmAddSeat() {
  if (!activeStripeSubscription.value)
    return

  loading.value = true
  try {
    const currentSeats = activeStripeSubscription.value.seats || 1
    const newSeats = currentSeats + 1

    console.log('[confirmAddSeat] Ending trial?', isEndingTrial.value)

    await $fetch('/api/stripe/update-seats', {
      method: 'POST',
      body: {
        organizationId: activeOrg.value!.data!.id,
        seats: newSeats,
        endTrial: isEndingTrial.value, // Use stored trial status
        newInterval: isEndingTrial.value ? seatInterval.value : undefined
      }
    })

    toast.add({
      title: 'Seat added successfully',
      description: `You now have ${newSeats} seats.`,
      color: 'success'
    })

    showAddSeatModal.value = false
    await fetchSession()
    await refreshPage()
  } catch (e: any) {
    console.error(e)
    toast.add({
      title: 'Failed to add seat',
      description: e.data?.message || e.message || 'Unknown error',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function revokeInvitation(invitationId: string) {
  if (!activeOrg.value?.data?.id)
    return
  // TODO: Replace with proper modal confirmation
  // eslint-disable-next-line no-alert
  if (!confirm('Are you sure you want to revoke this invitation?'))
    return

  loading.value = true
  try {
    const { error } = await organization.cancelInvitation({
      invitationId
    })

    if (error)
      throw error

    toast.add({ title: 'Invitation revoked', color: 'success' })
    await fetchSession()
    await refreshActiveOrg()
  } catch (e: any) {
    toast.add({
      title: 'Error revoking invitation',
      description: e.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Members UI -->
    <div
      v-if="activeOrg.data"
      class="flex flex-col gap-6"
    >
      <UCard>
        <template #header>
          <div class="flex justify-between items-center">
            <h3 class="text-lg font-semibold">
              {{ activeOrg.data.name }} Members
            </h3>
            <UBadge color="gray">
              {{ activeOrg.data.members.length }} members
            </UBadge>
          </div>
        </template>

        <!-- Invite Form (Only for admins and owners) -->
        <div
          v-if="canManageMembers"
          class="border-b border-neutral-200 dark:border-neutral-700 pb-6 mb-6"
        >
          <div
            v-if="isPro"
            class="flex gap-2 items-end"
          >
            <UFormField
              label="Email Address"
              class="flex-1"
            >
              <UInput
                v-model="inviteEmail"
                placeholder="colleague@example.com"
                icon="i-lucide-mail"
              />
            </UFormField>
            <UFormField
              label="Role"
              class="w-40"
            >
              <UDropdownMenu
                :items="roles.map(r => ({
                  label: r.label,
                  type: 'checkbox',
                  checked: inviteRole === r.value,
                  onUpdateChecked: () => { inviteRole = r.value }
                }))"
                arrow
              >
                <UButton
                  :label="roles.find(r => r.value === inviteRole)?.label || 'Select role'"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-chevron-down"
                  trailing
                  block
                  class="cursor-pointer"
                />
              </UDropdownMenu>
            </UFormField>
            <UButton
              :loading="loading"
              icon="i-lucide-send"
              class="cursor-pointer"
              @click="inviteMember"
            >
              Invite
            </UButton>
          </div>

          <div
            v-else
            class="flex justify-between items-center"
          >
            <p class="text-sm text-muted-foreground">
              Upgrade to Pro to invite team members.
            </p>
            <UButton
              label="Upgrade to add members"
              color="primary"
              icon="i-lucide-lock"
              class="cursor-pointer"
              @click="showUpgradeModal = true"
            />
          </div>
        </div>

        <!-- Members List -->
        <div class="space-y-3">
          <div
            v-for="member in activeOrg.data.members"
            :key="member.id"
            class="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
          >
            <div class="flex items-center gap-3">
              <UAvatar
                :src="member.user.image"
                :alt="member.user.name"
                size="sm"
              />
              <div>
                <div class="font-medium">
                  {{ member.user.name }}
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ member.user.email }}
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <!-- Role Badge (always show for non-owners when can't manage, or for owners) -->
              <UBadge
                v-if="!canManageMembers || member.role === 'owner'"
                :color="member.role === 'owner' ? 'primary' : 'gray'"
              >
                {{ member.role }}
              </UBadge>

              <!-- Role Dropdown (Only for admins/owners managing non-owners) -->
              <UDropdownMenu
                v-else
                :items="roles.filter(r => r.value !== 'owner').map(r => ({
                  label: r.label,
                  type: 'checkbox',
                  checked: member.role === r.value,
                  onUpdateChecked: () => updateMemberRole(member.id, r.value)
                }))"
                arrow
              >
                <UButton
                  :label="member.role"
                  variant="outline"
                  size="xs"
                  icon="i-lucide-chevron-down"
                  trailing
                  class="cursor-pointer"
                />
              </UDropdownMenu>

              <!-- Actions (Only for admins/owners managing non-owners) -->
              <UDropdownMenu
                v-if="canManageMembers && member.role !== 'owner'"
                :items="[[{
                  label: 'Remove from team',
                  icon: 'i-lucide-user-minus',
                  class: 'text-red-600 cursor-pointer',
                  onSelect: () => removeMember(member.id)
                }]]"
              >
                <UButton
                  icon="i-lucide-more-horizontal"
                  variant="ghost"
                  size="xs"
                  color="gray"
                  class="cursor-pointer"
                />
              </UDropdownMenu>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Invitations List -->
      <UCard v-if="activeOrg.data.invitations.some(i => i.status === 'pending')">
        <template #header>
          <h3 class="text-lg font-semibold">
            Pending Invitations
          </h3>
        </template>
        <div class="space-y-4">
          <div
            v-for="invitation in activeOrg.data.invitations.filter(i => i.status === 'pending')"
            :key="invitation.id"
            class="flex items-center justify-between"
          >
            <div class="flex items-center gap-3">
              <div class="bg-primary/10 p-2 rounded-full">
                <UIcon
                  name="i-lucide-mail"
                  class="w-4 h-4 text-primary"
                />
              </div>
              <div>
                <div class="font-medium">
                  {{ invitation.email }}
                </div>
                <div class="text-xs text-muted-foreground">
                  Role: {{ invitation.role }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                icon="i-lucide-copy"
                color="gray"
                variant="ghost"
                size="xs"
                class="cursor-pointer"
                @click="copyLink(invitation.id)"
              >
                Copy Link
              </UButton>
              <UButton
                v-if="canManageMembers"
                icon="i-lucide-x"
                color="red"
                variant="ghost"
                size="xs"
                class="cursor-pointer"
                @click="revokeInvitation(invitation.id)"
              >
                Revoke
              </UButton>
              <UBadge color="orange">
                {{ invitation.status }}
              </UBadge>
            </div>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Upgrade Modal -->
    <UpgradeModal
      v-model:open="showUpgradeModal"
      reason="invite"
      :organization-id="activeOrg?.data?.id"
      @upgraded="handleUpgrade"
    />

    <!-- Add Seat Modal -->
    <UModal
      v-model:open="showAddSeatModal"
      title="Add a Seat"
      :description="activeStripeSubscription?.status === 'trialing'
        ? 'You are currently in a trial. Adding a member will end your trial and start your subscription.'
        : 'You have used all your available seats. Add another seat to invite more members.'"
    >
      <template #body>
        <div
          v-if="activeStripeSubscription?.status === 'trialing'"
          class="mb-4"
        >
          <label class="block text-sm font-medium mb-3">Select billing cycle for your new plan</label>
          <div class="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 mb-4">
            <button
              class="flex-1 px-3 py-1 text-sm font-medium rounded-md transition-all"
              :class="seatInterval === 'month' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-muted-foreground'"
              @click="seatInterval = 'month'"
            >
              Monthly
            </button>
            <button
              class="flex-1 px-3 py-1 text-sm font-medium rounded-md transition-all"
              :class="seatInterval === 'year' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-muted-foreground'"
              @click="seatInterval = 'year'"
            >
              Yearly
            </button>
          </div>
        </div>

        <div
          v-if="addSeatPreview"
          class="space-y-4 text-sm"
        >
          <!-- Comparison View -->
          <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-center bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <div>
              <div class="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">
                Current
              </div>
              <div class="font-semibold text-lg">
                {{ (activeStripeSubscription?.seats || 1) }} Seats
              </div>
              <div class="text-muted-foreground">
                ${{ (
                  (activeStripeSubscription?.plan?.includes('year') || seatInterval === 'year' ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber)
                  + (Math.max(0, (activeStripeSubscription?.seats || 1) - 1) * (activeStripeSubscription?.plan?.includes('year') || seatInterval === 'year' ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber))
                ).toFixed(2) }}/{{ seatInterval === 'year' ? 'yr' : 'mo' }}
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
                {{ (activeStripeSubscription?.seats || 1) + 1 }} Seats
              </div>
              <div class="text-primary font-medium">
                ${{ (
                  (activeStripeSubscription?.plan?.includes('year') || seatInterval === 'year' ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber)
                  + ((activeStripeSubscription?.seats || 1) * (activeStripeSubscription?.plan?.includes('year') || seatInterval === 'year' ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber))
                ).toFixed(2) }}/{{ seatInterval === 'year' ? 'yr' : 'mo' }}
              </div>
            </div>
          </div>

          <!-- Breakdown Details -->
          <div class="text-xs text-muted-foreground space-y-1 px-1">
            <div class="flex justify-between">
              <span>Base Plan (Includes 1 Seat):</span>
              <span>${{ (activeStripeSubscription?.plan?.includes('year') || seatInterval === 'year' ? PLANS.PRO_YEARLY.priceNumber : PLANS.PRO_MONTHLY.priceNumber).toFixed(2) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Additional Seats ({{ (activeStripeSubscription?.seats || 1) }} x ${{ (activeStripeSubscription?.plan?.includes('year') || seatInterval === 'year' ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber).toFixed(2) }}):</span>
              <span>${{ ((activeStripeSubscription?.seats || 1) * (activeStripeSubscription?.plan?.includes('year') || seatInterval === 'year' ? PLANS.PRO_YEARLY.seatPriceNumber : PLANS.PRO_MONTHLY.seatPriceNumber)).toFixed(2) }}</span>
            </div>
          </div>

          <div
            v-if="activeStripeSubscription?.status !== 'trialing'"
            class="flex justify-between pt-2 items-center"
          >
            <div>
              <div class="text-muted-foreground">
                Prorated amount due now:
              </div>
              <div
                v-if="addSeatPreview.periodEnd"
                class="text-xs text-muted-foreground/70"
              >
                New rate starts on {{ new Date(addSeatPreview.periodEnd * 1000).toLocaleDateString() }}
              </div>
            </div>
            <span class="font-bold text-primary">${{ (addSeatPreview.amountDue / 100).toFixed(2) }}</span>
          </div>
          <div
            v-else
            class="flex justify-between pt-2"
          >
            <span class="text-muted-foreground">Amount due now (End Trial):</span>
            <span class="font-bold text-primary">${{ (addSeatPreview.amountDue / 100).toFixed(2) }}</span>
          </div>
        </div>

        <div
          v-else-if="errorMessage"
          class="py-4 flex flex-col items-center gap-2 text-center"
        >
          <UIcon
            name="i-lucide-alert-circle"
            class="w-8 h-8 text-red-500"
          />
          <p class="text-sm text-red-600">
            {{ errorMessage }}
          </p>
          <UButton
            label="Retry"
            size="sm"
            variant="outline"
            @click="fetchSeatPreview"
          />
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
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="showAddSeatModal = false"
        />
        <UButton
          :loading="loading"
          :label="activeStripeSubscription?.status === 'trialing' ? 'End Trial & Pay' : 'Add Seat & Pay'"
          color="primary"
          @click="confirmAddSeat"
        />
      </template>
    </UModal>
  </div>
</template>
