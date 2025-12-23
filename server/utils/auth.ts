import type { H3Event } from 'h3'
import type { User } from '~~/shared/utils/types'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, openAPI, organization } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { ac, admin as adminRole, member, owner } from '~~/shared/utils/permissions'
import { logAuditEvent } from './auditLogger'
import { getDB } from './db'
import { cacheClient, resendInstance } from './drivers'
import { runtimeConfig } from './runtimeConfig'
import { setupStripe } from './stripe'

console.log(`Base URL is ${runtimeConfig.public.baseURL}`)

export const createBetterAuth = () => betterAuth({
  baseURL: runtimeConfig.public.baseURL,
  trustedOrigins: [
    'http://localhost:3000',
    'http://localhost:8787',
    'https://quill-nuxt-saas-v1.pages.dev',
    'https://getquillio.com',
    'https://quill-nuxt-saas-v1.nuxt.dev',
    'https://quillio-worker.mrjoeelia.workers.dev',
    runtimeConfig.public.baseURL
  ],
  secret: runtimeConfig.betterAuthSecret,
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
  secondaryStorage: cacheClient,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const response = await resendInstance.emails.send({
        from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
        to: user.email,
        subject: 'Reset your password',
        text: `Click the link to reset your password: ${url}`
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
      const response = await resendInstance.emails.send({
        from: `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`,
        to: user.email,
        subject: 'Verify your email address',
        text: `Click the link to verify your email: ${url}`
      })
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
        console.error(`Failed to send verification email: ${response.error.message}`)
        throw createError({
          statusCode: 500,
          statusMessage: 'Internal Server Error'
        })
      }
    }
  },
  socialProviders: {
    ...(runtimeConfig.githubClientId && runtimeConfig.githubClientSecret && {
      github: {
        clientId: runtimeConfig.githubClientId,
        clientSecret: runtimeConfig.githubClientSecret
      }
    }),
    ...(runtimeConfig.googleClientId && runtimeConfig.googleClientSecret && {
      google: {
        clientId: runtimeConfig.googleClientId,
        clientSecret: runtimeConfig.googleClientSecret
      }
    })
  },
  account: {
    accountLinking: {
      enabled: true
    }
  },
  plugins: [
    ...(runtimeConfig.public.appEnv === 'development' ? [openAPI()] : []),
    admin(),
    organization({
      ac,
      roles: {
        owner,
        admin: adminRole,
        member
      },
      enableMetadata: true
    }),
    setupStripe()
  ]
})

let _auth: ReturnType<typeof betterAuth>

// Used by npm run auth:schema only.
const isAuthSchemaCommand = process.argv.some(arg => arg.includes('server/database/schema/auth.ts'))
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
  const headers = event.headers
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

export interface SessionWithOrg {
  session?: {
    activeOrganizationId?: string
  } | null
  data?: {
    session?: {
      activeOrganizationId?: string
    } | null
  } | null
  activeOrganizationId?: string
}

export interface AuthSessionLike extends SessionWithOrg {
  user?: User | null
}

export const normalizeAuthSession = <TSession = unknown>(
  authSession: AuthSessionLike | null | undefined
) => {
  if (!authSession) {
    return { session: null as TSession | null, user: null }
  }

  const session = (authSession.session ?? authSession.data?.session ?? null) as TSession | null
  return {
    session,
    user: authSession.user ?? null
  }
}

export const getSessionOrganizationId = (session: SessionWithOrg | null | undefined): string | null => {
  if (!session) {
    return null
  }
  // Try to get activeOrganizationId from session (Better Auth's organization plugin sets this)
  return session.session?.activeOrganizationId
    ?? session.data?.session?.activeOrganizationId
    ?? session.activeOrganizationId
    ?? null
}

export const requireActiveOrganization = async (event: H3Event) => {
  const user = await requireAuth(event)
  const session = await getAuthSession(event)

  const activeOrganizationId = getSessionOrganizationId(session)

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
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'You are not a member of this organization.'
    })
  }

  return { organizationId: activeOrganizationId }
}
