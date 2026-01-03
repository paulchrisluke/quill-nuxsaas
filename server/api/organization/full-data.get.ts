import { and, asc, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { requireActiveOrganization, requireAuth } from '~~/server/utils/auth'
import { useDB } from '~~/server/utils/db'
import { computeNeedsUpgrade, computeUserOwnsMultipleOrgs } from '~~/shared/utils/organizationExtras'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { organizationId } = await requireActiveOrganization(event)
  const db = await useDB(event)

  const [organization] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1)

  if (!organization) {
    return {
      organization: null,
      subscriptions: [],
      userOwnsMultipleOrgs: false,
      needsUpgrade: false,
      user: null
    }
  }

  const members = await db
    .select()
    .from(schema.member)
    .where(eq(schema.member.organizationId, organizationId))

  const invitations = await db
    .select()
    .from(schema.invitation)
    .where(eq(schema.invitation.organizationId, organizationId))

  const subscriptions = await db
    .select()
    .from(schema.subscription)
    .where(eq(schema.subscription.referenceId, organizationId))

  const ownedMemberships = await db
    .select({
      organizationId: schema.member.organizationId,
      createdAt: schema.organization.createdAt
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(
      eq(schema.member.userId, user.id),
      eq(schema.member.role, 'owner')
    ))
    .orderBy(asc(schema.organization.createdAt))

  const ownershipInfo = {
    ownedCount: ownedMemberships.length,
    firstOwnedOrgId: ownedMemberships[0]?.organizationId ?? null
  }

  return {
    organization: {
      ...organization,
      members,
      invitations
    },
    subscriptions,
    userOwnsMultipleOrgs: computeUserOwnsMultipleOrgs(ownershipInfo),
    needsUpgrade: computeNeedsUpgrade(organizationId, subscriptions, ownershipInfo),
    user
  }
})
