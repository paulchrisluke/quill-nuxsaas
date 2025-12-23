import type { H3Event } from 'h3'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware, getOAuthState } from 'better-auth/api'
import { admin as adminPlugin, apiKey, openAPI, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { and, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { getDB } from './db'
import { cacheClient } from './drivers'
import { runtimeConfig } from './runtimeConfig'

// Minimal access control for Better Auth organization plugin
const statement = {
  organization: ['update', 'delete', 'view', 'leave'],
  member: ['create', 'update', 'delete', 'view'],
  invitation: ['create', 'cancel', 'resend'],
  billing: ['manage', 'view'],
  settings: ['view', 'update']
} as const

const ac = createAccessControl(statement)
const member = ac.newRole({
  organization: ['view', 'leave'],
  member: ['view'],
  settings: ['view']
})
const admin = ac.newRole({
  organization: ['update', 'view', 'leave'],
  member: ['create', 'update', 'delete', 'view'],
  invitation: ['create', 'cancel', 'resend'],
  settings: ['view', 'update']
})
const owner = ac.newRole({
  organization: ['update', 'delete', 'view'],
  member: ['create', 'update', 'delete', 'view'],
  invitation: ['create', 'cancel', 'resend'],
  billing: ['manage', 'view'],
  settings: ['view', 'update']
})

type User = typeof schema.user.$inferSelect

export const createBetterAuth = () => betterAuth({
  baseURL: runtimeConfig.public.baseURL || 'http://localhost:3000',
  trustedOrigins: [
    'http://localhost:8787',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:4000',
    'http://127.0.0.1:8787',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4000',
    runtimeConfig.public.baseURL || 'http://localhost:3000'
  ].filter(Boolean),
  secret: runtimeConfig.betterAuthSecret || 'change-me-in-production',
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
      enabled: true
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
          if (ctx?.path?.startsWith('/callback') && ctx) {
            try {
              const additionalData = await getOAuthState()
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
        }
      },
      update: {
        after: async (_user) => {
          // Stripe sync disabled for minimal setup
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
        before: async (_org: any) => {
          // Logging disabled for minimal setup
        }
      }
    },
    member: {
      create: {
        after: async (_member: any) => {
          // Stripe sync disabled for minimal setup
        }
      },
      delete: {
        after: async (_member: any) => {
          // Stripe sync disabled for minimal setup
        }
      }
    },
    invitation: {
      create: {
        after: async (_invitation: any) => {
          // Stripe sync disabled for minimal setup
        }
      },
      delete: {
        after: async (_invitation: any) => {
          // Stripe sync disabled for minimal setup
        }
      }
    }
  },
  secondaryStorage: cacheClient,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false
  },
  emailVerification: {
    sendOnSignUp: false,
    autoSignInAfterVerification: true
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
    after: createAuthMiddleware(async () => {
      // Audit logging disabled for minimal setup
    })
  },
  plugins: [
    ...(runtimeConfig.public.appEnv === 'development' ? [openAPI()] : []),
    adminPlugin(),
    organization({
      ac,
      roles: {
        owner,
        admin,
        member
      },
      enableMetadata: true
    }),
    apiKey({
      enableMetadata: true,
      schema: {
        apikey: {
          modelName: 'apiKey'
        }
      }
    })
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

export const getAuthSession = async (event: H3Event) => {
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
  return session
}

export const requireAuth = async (event: H3Event) => {
  const session = await getAuthSession(event)
  if (!session || !session.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }
  // Save the session to the event context for later use
  event.context.user = session.user
  return session.user as User
}
