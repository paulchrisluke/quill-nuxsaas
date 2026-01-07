import { afterEach, describe, expect, it } from 'vitest'
import { shouldSkipAuthClient } from '~~/app/plugins/auth.client'

describe('auth client plugin', () => {
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('skips session fetching in test environments', () => {
    process.env.NODE_ENV = 'test'
    expect(shouldSkipAuthClient()).toBe(true)
  })

  it('does not skip session fetching outside test environments', () => {
    process.env.NODE_ENV = 'development'
    expect(shouldSkipAuthClient()).toBe(false)
  })
})
