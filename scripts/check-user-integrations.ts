#!/usr/bin/env tsx
/**
 * Check user integrations and accounts
 *
 * Usage:
 *   pnpm dlx tsx scripts/check-user-integrations.ts <email>
 */

import { resolve } from 'path'
import { config } from 'dotenv'
import { Pool } from 'pg'

try {
  config({ path: resolve(process.cwd(), '.env') })
} catch {
  // It is fine if the file does not exist.
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('❌ DATABASE_URL is required')
  process.exit(1)
}

const email = process.argv[2] || 'paulchrisluke@gmail.com'

const pool = new Pool({ connectionString: databaseUrl })

// Import schema manually
const GOOGLE_INTEGRATION_MATCH_SCOPES = {
  youtube: [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl'
  ],
  google_drive: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/documents.readonly'
  ]
} as const

const parseScopes = (scope: string | null | undefined): string[] =>
  scope?.split(/[, ]+/).map(scopeEntry => scopeEntry.trim()).filter(Boolean) ?? []

const hasRequiredScopes = (scopeList: string[], required: readonly string[]): boolean =>
  required.every(scopeEntry => scopeList.includes(scopeEntry))

async function main() {
  console.log(`\n=== Checking user: ${email} ===\n`)

  // Find user
  const userResult = await pool.query('SELECT * FROM "user" WHERE email = $1', [email])

  if (userResult.rows.length === 0) {
    console.log('❌ User not found')
    await pool.end()
    return
  }

  const user = userResult.rows[0] as any

  console.log(`✅ User found: ${user.id}`)
  console.log(`   Name: ${user.name}`)
  console.log(`   Email: ${user.email}\n`)

  // Find all accounts for this user
  const accountsResult = await pool.query('SELECT * FROM account WHERE user_id = $1', [user.id])
  const accounts = accountsResult.rows as any[]

  console.log(`📦 Found ${accounts.length} account(s):\n`)
  for (const account of accounts) {
    const scopes = parseScopes(account.scope)
    console.log(`Account ID: ${account.id}`)
    console.log(`  Provider: ${account.provider_id}`)
    console.log(`  Account ID (external): ${account.account_id}`)
    console.log(`  Scopes: ${account.scope || '(none)'}`)
    console.log(`  Parsed scopes: [${scopes.join(', ')}]`)
    console.log(`  Has access token: ${!!account.accessToken}`)
    console.log(`  Has refresh token: ${!!account.refreshToken}`)
      console.log(`  Token expires at: ${account.access_token_expires_at || '(none)'}`)

    // Check YouTube scopes
    const hasYouTube = hasRequiredScopes(scopes, GOOGLE_INTEGRATION_MATCH_SCOPES.youtube)
    console.log(`  ✅ Has YouTube scopes: ${hasYouTube}`)
    if (hasYouTube) {
      console.log(`     Required: [${GOOGLE_INTEGRATION_MATCH_SCOPES.youtube.join(', ')}]`)
    }

    // Check Google Drive scopes
    const hasDrive = hasRequiredScopes(scopes, GOOGLE_INTEGRATION_MATCH_SCOPES.google_drive)
    console.log(`  ✅ Has Google Drive scopes: ${hasDrive}`)
    if (hasDrive) {
      console.log(`     Required: [${GOOGLE_INTEGRATION_MATCH_SCOPES.google_drive.join(', ')}]`)
    }
    console.log('')
  }

  // Find all organizations for this user
  const membershipsResult = await pool.query('SELECT * FROM member WHERE user_id = $1', [user.id])
  const memberships = membershipsResult.rows as any[]

  console.log(`\n🏢 Found ${memberships.length} organization membership(s):\n`)
  for (const membership of memberships) {
    const orgResult = await pool.query('SELECT * FROM organization WHERE id = $1', [membership.organization_id])
    const org = orgResult.rows[0] as any
    console.log(`Organization: ${org?.name || membership.organization_id} (${membership.organization_id})`)
    console.log(`  Role: ${membership.role}`)

    // Find integrations for this organization
    const integrationsResult = await pool.query('SELECT * FROM integration WHERE organization_id = $1', [membership.organization_id])
    const integrations = integrationsResult.rows as any[]

    console.log(`  📋 Found ${integrations.length} integration(s):`)
    for (const integration of integrations) {
      console.log(`    - ${integration.type} (${integration.name})`)
      console.log(`      ID: ${integration.id}`)
      console.log(`      Account ID: ${integration.account_id || '(none)'}`)
      console.log(`      Auth Type: ${integration.auth_type}`)
      console.log(`      Is Active: ${integration.is_active}`)
      console.log(`      Created: ${integration.created_at}`)
      console.log(`      Updated: ${integration.updated_at}`)

      // Check if account exists
      if (integration.account_id) {
        const account = accounts.find(acc => acc.id === integration.account_id)
        if (account) {
          console.log(`      ✅ Account found: ${account.id}`)
          console.log(`         Scopes: ${account.scope || '(none)'}`)
          const accountScopes = parseScopes(account.scope)

          if (integration.type === 'youtube') {
            const hasScopes = hasRequiredScopes(accountScopes, GOOGLE_INTEGRATION_MATCH_SCOPES.youtube)
            console.log(`         Has YouTube scopes: ${hasScopes}`)
          } else if (integration.type === 'google_drive') {
            const hasScopes = hasRequiredScopes(accountScopes, GOOGLE_INTEGRATION_MATCH_SCOPES.google_drive)
            console.log(`         Has Google Drive scopes: ${hasScopes}`)
          }
        } else {
          console.log(`      ❌ Account NOT found: ${integration.account_id}`)
        }
      }
      console.log('')
    }
    console.log('')
  }

  console.log('\n=== Summary ===\n')
  console.log(`User: ${user.email}`)
  console.log(`Accounts: ${accounts.length}`)
  console.log(`Organizations: ${memberships.length}`)

  const allIntegrationsPromises = memberships.map(async (m) => {
    const result = await pool.query('SELECT * FROM integration WHERE organization_id = $1', [m.organization_id])
    return result.rows as any[]
  })

  const integrationsList = await Promise.all(allIntegrationsPromises)
  const totalIntegrations = integrationsList.flat().length
  console.log(`Total Integrations: ${totalIntegrations}`)

  // Check for Google Drive specifically
  const driveIntegrations = integrationsList.flat().filter(i => i.type === 'google_drive')
  console.log(`\nGoogle Drive Integrations: ${driveIntegrations.length}`)
  for (const driveInt of driveIntegrations) {
    console.log(`  - ${driveInt.id} (org: ${driveInt.organization_id})`)
    console.log(`    Account ID: ${driveInt.account_id || '(none)'}`)
    if (driveInt.account_id) {
      const account = accounts.find(acc => acc.id === driveInt.account_id)
      if (account) {
        const scopes = parseScopes(account.scope)
        const hasDrive = hasRequiredScopes(scopes, GOOGLE_INTEGRATION_MATCH_SCOPES.google_drive)
        console.log(`    ✅ Account exists with Drive scopes: ${hasDrive}`)
        console.log(`    Account scopes: ${account.scope || '(none)'}`)
      } else {
        console.log(`    ❌ Account not found!`)
      }
    }
  }

  await pool.end()
}

main().catch(console.error)
