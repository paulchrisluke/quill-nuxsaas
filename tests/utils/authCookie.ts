import { $fetch } from 'ofetch'

const getSetCookieHeaders = (headers: Headers): string[] => {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie()
  }
  const raw = (headers as any)?.raw?.() as Record<string, string[]> | undefined
  if (raw?.['set-cookie']) {
    return raw['set-cookie']
  }
  const fallback = headers.get('set-cookie')
  return fallback ? [fallback] : []
}

const joinCookiePairs = (cookies: string[]) =>
  cookies
    .map(cookie => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')

export const getAuthCookie = async (baseURL: string, options: {
  email?: string
  password?: string
} = {}) => {
  const email = options.email ?? process.env.NUXT_TEST_EMAIL
  const password = options.password ?? process.env.NUXT_TEST_PASSWORD

  if (!email || !password) {
    throw new Error('NUXT_TEST_EMAIL and NUXT_TEST_PASSWORD must be set to run e2e auth tests.')
  }

  const response = await $fetch.raw(`${baseURL}/api/auth/sign-in/email`, {
    method: 'POST',
    retry: 0,
    headers: {
      Origin: baseURL,
      Referer: `${baseURL}/`
    },
    body: {
      email,
      password
    }
  })

  const cookies = getSetCookieHeaders(response.headers)
  const cookieHeader = joinCookiePairs(cookies)
  if (!cookieHeader) {
    throw new Error('Auth sign-in did not return cookies; ensure the test user exists and credentials are valid.')
  }

  return cookieHeader
}

export const ensureActiveOrganization = async (baseURL: string, cookie: string) => {
  const headers = {
    'Cookie': cookie,
    'Content-Type': 'application/json'
  }

  const configuredOrgId = process.env.NUXT_TEST_ORGANIZATION_ID
  let organizationId = configuredOrgId

  if (!organizationId) {
    const listResponse = await $fetch('/api/auth/organization/list', {
      baseURL,
      method: 'GET',
      headers,
      retry: 0
    }) as any

    const items = Array.isArray(listResponse)
      ? listResponse
      : Array.isArray(listResponse?.data)
        ? listResponse.data
        : []

    organizationId = items[0]?.id as string | undefined
  }

  if (!organizationId) {
    return {
      organizationId: null,
      setActive: false
    }
  }

  try {
    await $fetch('/api/auth/organization/set-active', {
      baseURL,
      method: 'POST',
      headers,
      retry: 0,
      body: {
        organizationId
      }
    })
    return { organizationId, setActive: true }
  } catch (error: any) {
    if (error?.status === 403 || error?.statusCode === 403) {
      return { organizationId, setActive: false }
    }
    throw error
  }
}
