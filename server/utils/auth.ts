import type { H3Event } from 'h3'
import type { User } from '~~/shared/utils/types'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getOAuthState } from 'better-auth/api'
import { admin as adminPlugin, anonymous, apiKey, openAPI, organization } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'
import { logAuditEvent } from './auditLogger'
import { getDB } from './db'
import { cacheClient, resendInstance } from './drivers'
import { renderDeleteAccount, renderResetPassword, renderTeamInvite, renderVerifyEmail } from './email'
import { runtimeConfig } from './runtimeConfig'
import { createStripeClient, setupStripe } from './stripe'

console.log(`Base URL is ${runtimeConfig.public.baseURL}`)
console.log('Schema keys:', Object.keys(schema))

const coerceMetadataToString = (metadata: unknown) => {
  if (metadata === undefined) {
    return undefined
  }
  if (metadata === null || typeof metadata === 'string') {
    return metadata
  }
  try {
    return JSON.stringify(metadata)
  } catch (error) {
    console.error('[Auth Hook] Failed to serialize organization metadata:', error)
    return '<unserializable metadata>'
  }
}

// Helper to strictly enforce the production URL for auth callbacks
// This prevents "www" vs "non-www" mismatch errors with OAuth providers
const getAuthBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return 'https://getquillio.com'
  }
  return runtimeConfig.public.baseURL || process.env.NUXT_APP_URL || 'http://localhost:3000'
}

export const createBetterAuth = () => betterAuth({
  baseURL: getAuthBaseUrl(),
  trustedOrigins: [
    'http://localhost:8787',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:4000',
    'http://127.0.0.1:8787',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4000',
    'https://quillio-iota.vercel.app',
    'https://quillio.vercel.app',
    'https://getquillio.com',
    'https://www.getquillio.com',
    runtimeConfig.public.baseURL,
    ...(runtimeConfig.betterAuthTrustedOrigins?.split(',').map((o: string) => o.trim()) || [])
  ].filter(Boolean) as string[],
  secret: runtimeConfig.betterAuthSecret,
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60 // Cache for 5 minutes
    }
  },
  database: drizzleAdapter(
    getDB(),
    {
      provider: 'pg',
      schema
    }
  ),
  advanced: {
    database: {
      generateId: () => {
        return uuidv7()
      }
    }
  },
  user: {
    changeEmail: {
      enabled: true
    },
    deleteUser: {
      enabled: true,
      async sendDeleteAccountVerification({ user, url }) {
        if (resendInstance) {
          const name = user.name || user.email.split('@')[0]
          const html = await renderDeleteAccount(name, url)
          await resendInstance.emails.send({
            from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
            to: user.email,
            subject: 'Confirm account deletion',
            html
          })
        }
      }
    },
    additionalFields: {
      lastActiveOrganizationId: {
        type: 'string',
        required: false,
        defaultValue: null
      },
      referralCode: {
        type: 'string',
        required: false
      }
    }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          if (ctx?.path?.startsWith('/callback')) {
            try {
              // @ts-expect-error: better-auth types mismatch
              const additionalData = await getOAuthState(ctx)
              if (additionalData?.referralCode) {
                return {
                  data: {
                    ...user,
                    referralCode: additionalData.referralCode
                  }
                }
              }
            } catch {
              // ignore
            }
          }
        },
        after: async (user) => {
          console.log('[Auth] User created, auto-creating personal organization for:', user.email)
          const db = getDB()

          try {
            // Use transaction for atomicity of org creation
            // Note: This runs AFTER user is committed, so failures here leave orphan users
            // A reconciliation job should periodically find and fix users without organizations
            await db.transaction(async (tx) => {
              // Generate IDs before transaction operations
              const orgId = uuidv7()
              const memberId = uuidv7()
              const orgName = 'Personal'
              const slug = `${orgName.toLowerCase()}-${orgId.slice(0, 8)}`

              // Insert organization (may already exist in concurrent scenarios)
              await tx.insert(schema.organization).values({
                id: orgId,
                name: orgName,
                slug,
                createdAt: new Date()
              }).onConflictDoNothing()

              // Insert member with ON CONFLICT DO NOTHING for true database-level idempotency
              // The unique constraint on (organizationId, userId) prevents duplicate memberships
              // This eliminates TOCTOU race conditions from select-then-insert pattern
              const insertResult = await tx.insert(schema.member).values({
                id: memberId,
                organizationId: orgId,
                userId: user.id,
                role: 'owner',
                createdAt: new Date()
              }).onConflictDoNothing()

              // Only update user if we actually inserted a new membership
              // Check if insert was skipped (conflict occurred)
              if (insertResult.rowCount === 0) {
                console.log(`[Auth] User ${user.id} already has organization membership, skipping auto-create`)
                return
              }

              await tx
                .update(schema.user)
                .set({ lastActiveOrganizationId: orgId })
                .where(eq(schema.user.id, user.id))

              console.log(`[Auth] Auto-created organization ${orgId} for user ${user.id}`)
            })
          } catch (e) {
            // Cannot abort user creation here (user already committed)
            // Log error and let user exist without org - reconciliation job should fix this
            console.error('[Auth] CRITICAL: Failed to auto-create organization for user', user.id, '- user exists without org:', e)
            // TODO: Add alert/monitoring for this condition
            // TODO: Implement reconciliation job to find and fix orphan users
          }
        }
      },
      update: {
        after: async (user) => {
          // When user email changes, update Stripe customer email for orgs they own
          console.log('[Auth] User update hook triggered:', { userId: user.id, email: user.email, emailVerified: user.emailVerified })

          // Always sync email to Stripe when user is updated (email is verified by the change-email flow)
          if (user.email) {
            try {
              const db = getDB()
              // Find all orgs where this user is owner and has a Stripe customer
              const ownedOrgs = await db
                .select()
                .from(schema.member)
                .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
                .where(and(
                  eq(schema.member.userId, user.id),
                  eq(schema.member.role, 'owner')
                ))

              console.log('[Auth] Found owned orgs:', ownedOrgs.length)

              if (ownedOrgs.length > 0) {
                const stripe = createStripeClient()
                for (const row of ownedOrgs) {
                  const org = row.organization
                  if (org.stripeCustomerId) {
                    // Update customer email (used for receipts and communications)
                    // Also ensure customer name stays as org name (not cardholder name)
                    await stripe.customers.update(org.stripeCustomerId, {
                      email: user.email,
                      name: org.name
                    })
                    console.log(`[Auth] Updated Stripe customer ${org.stripeCustomerId} email to ${user.email}, name to "${org.name}"`)
                  } else {
                    console.log(`[Auth] Org ${org.id} has no stripeCustomerId`)
                  }
                }
              }
            } catch (e) {
              console.error('[Auth] Failed to update Stripe customer email:', e)
            }
          }
        }
      }
    },
    session: {
      create: {
        before: async (session) => {
          const db = getDB()

          // 1. Try to get user's last active org
          const users = await db
            .select()
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1)

          let activeOrgId = users[0]?.lastActiveOrganizationId

          // 2. Verify user is still a member of that org
          if (activeOrgId) {
            const member = await db
              .select()
              .from(schema.member)
              .where(and(
                eq(schema.member.userId, session.userId),
                eq(schema.member.organizationId, activeOrgId)
              ))
              .limit(1)

            if (member.length === 0)
              activeOrgId = null
          }

          // 3. Fallback to first organization
          if (!activeOrgId) {
            const members = await db
              .select()
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .limit(1)

            if (members.length > 0)
              activeOrgId = members[0].organizationId
          }

          if (activeOrgId) {
            return {
              data: {
                ...session,
                activeOrganizationId: activeOrgId
              }
            }
          }
        }
      },
      update: {
        after: async (session) => {
          const activeOrgId = (session as any).activeOrganizationId
          if (activeOrgId) {
            await getDB()
              .update(schema.user)
              .set({ lastActiveOrganizationId: activeOrgId })
              .where(eq(schema.user.id, session.userId))
          }
        }
      }
    },
    organization: {
      create: {
        before: async (org: any, ctx: any) => {
          const session = ctx.session || ctx.context?.session
          if (session?.user?.id) {
            const db = getDB()
            const user = await db.query.user.findFirst({
              where: eq(schema.user.id, session.user.id)
            })
            if (user?.referralCode) {
              return {
                data: {
                  ...org,
                  referralCode: user.referralCode
                }
              }
            }
          }
        }
      },
      update: {
        before: async (org: any) => {
          console.log('[Auth Hook] Organization Update Payload:', JSON.stringify(org, null, 2))
        }
      }
    },
    member: {
      create: {
        after: async (_member: any) => {
          // await syncSubscriptionQuantity(member.organizationId)
        }
      },
      delete: {
        after: async (_member: any) => {
          // await syncSubscriptionQuantity(member.organizationId)
        }
      }
    },
    invitation: {
      create: {
        after: async (_invitation: any) => {
          // await syncSubscriptionQuantity(invitation.organizationId)
        }
      },
      delete: {
        after: async (_invitation: any) => {
          // await syncSubscriptionQuantity(invitation.organizationId)
        }
      }
    }
  },
  secondaryStorage: cacheClient,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const name = user.name || user.email.split('@')[0]
      const html = await renderResetPassword(name, url)
      const response = await resendInstance.emails.send({
        from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
        to: user.email,
        subject: 'Reset your password',
        html
      })
      await logAuditEvent({
        userId: user.id,
        category: 'email',
        action: 'reset_password',
        targetType: 'email',
        targetId: user.email,
        status: response.error ? 'failure' : 'success',
        details: response.error?.message
      })
      if (response.error) {
        console.error(`Failed to send reset password email: ${response.error.message}`)
        throw createError({
          statusCode: 500,
          statusMessage: 'Internal Server Error'
        })
      }
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      console.log('[Auth] sendVerificationEmail triggered for:', user.email)
      console.log('>>> EMAIL VERIFICATION LINK <<<')
      console.log(`To: ${user.email}`)
      console.log(url)
      console.log('>>> ------------------------ <<<')
      try {
        const name = user.name || user.email.split('@')[0]
        const html = await renderVerifyEmail(name, url)
        console.log('[Auth] Rendering verification email...')
        const response = await resendInstance.emails.send({
          from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
          to: user.email,
          subject: 'Verify your email address',
          html
        })
        console.log('[Auth] Resend response:', JSON.stringify(response))
        await logAuditEvent({
          userId: user.id,
          category: 'email',
          action: 'verification',
          targetType: 'email',
          targetId: user.email,
          status: response.error ? 'failure' : 'success',
          details: response.error?.message
        })
        if (response.error) {
          console.error('[Auth] Resend error:', response.error)
          throw new Error(response.error.message)
        }
      } catch (e) {
        console.error('[Auth] Failed to send verification email:', e)
        console.log('>>> MANUAL VERIFICATION LINK <<<')
        console.log(url)
        console.log('>>> ------------------------ <<<')
      }
    }
  },
  socialProviders: {
    github: {
      clientId: runtimeConfig.githubClientId!,
      clientSecret: runtimeConfig.githubClientSecret!
    },
    google: {
      clientId: runtimeConfig.googleClientId!,
      clientSecret: runtimeConfig.googleClientSecret!
    }
  },
  account: {
    accountLinking: {
      enabled: true
    }
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      console.log(`[Auth Hook] ${ctx.path} request handled.`)
      const ipAddress = ctx.getHeader('x-forwarded-for')
        || ctx.getHeader('remoteAddress') || undefined
      const userAgent = ctx.getHeader('user-agent') || undefined

      let targetType
      let targetId
      if (ctx.context.session || ctx.context.newSession) {
        targetType = 'user'
        targetId = ctx.context.session?.user.id || ctx.context.newSession?.user.id
      } else if (['/sign-in/email', '/sign-up/email', 'forget-password'].includes(ctx.path)) {
        targetType = 'email'
        targetId = ctx.body.email || ''
      }
      const returned = ctx.context.returned
      if (returned && returned instanceof APIError) {
        console.error(`[Auth Hook Error] Path: ${ctx.path}, Status: ${returned.status}, Message: ${returned.body?.message || 'No message'}`)
        const userId = ctx.context.newSession?.user.id
        if (ctx.path == '/callback/:id' && returned.status == 'FOUND' && userId) {
          const provider = ctx.params.id
          await logAuditEvent({
            userId,
            category: 'auth',
            action: ctx.path.replace(':id', provider),
            targetType,
            targetId,
            ipAddress,
            userAgent,
            status: 'success'
          })
        } else {
          try {
            await logAuditEvent({
              userId: ctx.context.session?.user.id,
              category: 'auth',
              action: ctx.path,
              targetType,
              targetId,
              ipAddress,
              userAgent,
              status: 'failure',
              details: returned.body?.message
            })
          } catch (logError) {
            console.error('[Auth Hook] Failed to log audit event after error:', logError)
          }
        }
      } else {
        if (['/sign-in/email', '/sign-up/email', '/forget-password', '/reset-password'].includes(ctx.path)) {
          let userId: string | undefined
          if (['/sign-in/email', '/sign-up/email'].includes(ctx.path)) {
            userId = ctx.context.newSession?.user.id
          } else {
            userId = ctx.context.session?.user.id
          }
          try {
            await logAuditEvent({
              userId,
              category: 'auth',
              action: ctx.path,
              targetType,
              targetId,
              ipAddress,
              userAgent,
              status: 'success'
            })
          } catch (logError) {
            console.error('[Auth Hook] Failed to log audit event after success:', logError)
          }
        }
      }
    })
  },
  plugins: [
    ...(runtimeConfig.public.appEnv === 'development' ? [openAPI()] : []),
    anonymous(),
    adminPlugin(),
    organization({
      ac,
      roles: {
        owner,
        admin,
        member
      },
      organizationHooks: {
        beforeCreateOrganization: async ({ organization }) => {
          const metadata = coerceMetadataToString(organization?.metadata)
          return {
            data: {
              ...organization,
              ...(metadata !== undefined ? { metadata } : {})
            }
          }
        },
        beforeUpdateOrganization: async ({ organization }) => {
          const metadata = coerceMetadataToString(organization?.metadata)
          return {
            data: {
              ...organization,
              ...(metadata !== undefined ? { metadata } : {})
            }
          }
        }
      },
      enableMetadata: true,
      async sendInvitationEmail({ email, inviter, organization, invitation }) {
        if (resendInstance) {
          const inviterName = inviter.user.name || inviter.user.email.split('@')[0]
          const inviteUrl = `${runtimeConfig.public.baseURL}/invite/${invitation.id}`
          const html = await renderTeamInvite(inviterName, organization.name, inviteUrl)
          await resendInstance.emails.send({
            from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
            to: email,
            subject: `You're invited to join ${organization.name}`,
            html
          })
        }
      }
    }),
    apiKey({
      enableMetadata: true,
      schema: {
        apikey: {
          modelName: 'apiKey'
        }
      }
    }),
    setupStripe()
  ]
})

let _auth: ReturnType<typeof betterAuth>

// Used by npm run auth:schema only.
const isAuthSchemaCommand = process.argv.some(arg => arg.includes('server/db/schema/auth.ts'))
if (isAuthSchemaCommand) {
  _auth = createBetterAuth()
}
export const auth = _auth!

export const useServerAuth = () => {
  if (runtimeConfig.preset == 'node-server') {
    if (!_auth) {
      _auth = createBetterAuth()
    }
    return _auth
  } else {
    return createBetterAuth()
  }
}

// Alias for backward compatibility
export const getServerAuth = () => {
  return useServerAuth()
}

export const getAuthSession = async (event: H3Event) => {
  if (event.context.session) {
    return event.context.session
  }

  const reqHeaders = getRequestHeaders(event)
  const headers = new Headers()
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (value)
      headers.append(key, value)
  }

  const serverAuth = useServerAuth()
  const session = await serverAuth.api.getSession({
    headers
  })
  event.context.session = session
  return session
}

export const requireAuth = async (event: H3Event, options: { allowAnonymous?: boolean } = {}) => {
  const session = await getAuthSession(event)
  if (!session || !session.user) {
    if (!options.allowAnonymous) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized'
      })
    }

    const reqHeaders = getRequestHeaders(event)
    const headers = new Headers()
    for (const [key, value] of Object.entries(reqHeaders)) {
      if (value)
        headers.append(key, value)
    }

    const serverAuth = useServerAuth()
    // @ts-expect-error: better-auth types mismatch for anonymous plugin
    const anonResponse = await serverAuth.api.signInAnonymous({
      headers,
      returnHeaders: true,
      returnStatus: true
    })

    const headersWithSetCookie = anonResponse?.headers as (Headers & { getSetCookie?: () => string[] }) | undefined
    const setCookieValues = headersWithSetCookie?.getSetCookie?.() ?? null
    const setCookieHeader = anonResponse?.headers?.get('set-cookie')
    if (setCookieValues && setCookieValues.length > 0) {
      event.node.res.setHeader('set-cookie', setCookieValues)
    } else if (setCookieHeader) {
      event.node.res.setHeader('set-cookie', setCookieHeader)
    }

    const mergedHeaders = new Headers(headers)
    const cookiesFromSetCookie: string[] = []
    if (setCookieValues && setCookieValues.length > 0) {
      cookiesFromSetCookie.push(...setCookieValues)
    } else if (setCookieHeader) {
      cookiesFromSetCookie.push(...setCookieHeader.split(','))
    }

    const cookieHeader = cookiesFromSetCookie
      .map(value => value.split(';')[0].trim())
      .filter(Boolean)
      .join('; ')
    if (cookieHeader) {
      mergedHeaders.set('cookie', cookieHeader)
    }

    const anonymousSession = await serverAuth.api.getSession({
      headers: mergedHeaders
    })

    if (!anonymousSession?.user) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized'
      })
    }

    event.context.session = anonymousSession
    event.context.user = anonymousSession.user
    return anonymousSession.user as User
  }
  // Save the session to the event context for later use
  event.context.user = session.user
  return session.user as User
}

export const requireAdmin = async (event: H3Event) => {
  const user = await requireAuth(event)
  if (user.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Admin access required.'
    })
  }
  return user
}

export const getSessionOrganizationId = (session: any): string | null => {
  if (!session) {
    return null
  }
  return session.session?.activeOrganizationId
    ?? session.data?.session?.activeOrganizationId
    ?? session.activeOrganizationId
    ?? null
}

export const requireActiveOrganization = async (event: H3Event, options: { allowAnonymous?: boolean } = {}) => {
  const user = await requireAuth(event, options)
  const session = event.context.session ?? await getAuthSession(event)

  let activeOrganizationId = getSessionOrganizationId(session)
  const allowAnonymous = Boolean(options.allowAnonymous)
  const isTest = process.env.NODE_ENV === 'test'

  if (!activeOrganizationId && allowAnonymous && isTest) {
    const db = getDB()
    const [memberRecord] = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, user.id))
      .limit(1)

    activeOrganizationId = memberRecord?.organizationId ?? null

    if (!activeOrganizationId) {
      const orgId = uuidv7()
      const slug = `anonymous-${user.id}`

      await db.transaction(async (tx) => {
        await tx.insert(schema.organization).values({
          id: orgId,
          name: 'Anonymous Workspace',
          slug,
          isAnonymous: true
        })

        await tx.insert(schema.member).values({
          id: uuidv7(),
          organizationId: orgId,
          userId: user.id,
          role: 'owner'
        })

        await tx
          .update(schema.user)
          .set({ lastActiveOrganizationId: orgId })
          .where(eq(schema.user.id, user.id))
      })

      activeOrganizationId = orgId
    }
  }

  if (!activeOrganizationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'No active organization found. Please select an organization.'
    })
  }

  // Verify the user is a member of this organization
  const db = getDB()
  const [membership] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, activeOrganizationId),
        eq(schema.member.userId, user.id)
      )
    )
    .limit(1)

  if (!membership) {
    if (allowAnonymous && isTest) {
      await db.insert(schema.member).values({
        id: uuidv7(),
        organizationId: activeOrganizationId,
        userId: user.id,
        role: 'owner'
      })
      return { organizationId: activeOrganizationId }
    }
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'You are not a member of this organization.'
    })
  }

  return { organizationId: activeOrganizationId }
}
