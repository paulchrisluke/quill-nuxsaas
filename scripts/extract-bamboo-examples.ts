#!/usr/bin/env tsx
import { writeFile } from 'node:fs/promises'
import * as dotenv from 'dotenv'
import { Pool } from 'pg'
import { calculateDiffStats } from '../server/services/content/diff'

/**
 * Extract rewrite/edit examples for a user email with tool logs and content versions.
 * Usage: pnpm dlx tsx scripts/extract-bamboo-examples.ts [email]
 */

dotenv.config()

const DEFAULT_EMAIL = 'bamboo.chow@gmail.com'
const TARGET_EMAIL = process.argv[2] || process.env.TARGET_EMAIL || DEFAULT_EMAIL

const MAX_EXAMPLES = Number(process.env.MAX_EXAMPLES || 5)
const CONTEXT_BEFORE = Number(process.env.CONTEXT_BEFORE || 2)
const CONTEXT_AFTER = Number(process.env.CONTEXT_AFTER || 2)
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 1600)
const MAX_BODY_CHARS = Number(process.env.MAX_BODY_CHARS || 2000)
const MAX_TOOL_LOGS = Number(process.env.MAX_TOOL_LOGS || 8)
const MAX_VERSIONS = Number(process.env.MAX_VERSIONS || 4)

const KEYWORDS = [
  'rewrite',
  're-write',
  'reword',
  'rephrase',
  'reorganize',
  'reorganise',
  'conclusion',
  'section',
  'tone',
  'preserve',
  'wording',
  'structure'
]

const PHRASES = [
  'fate led us straight to',
  'every ingredient quietly takes center stage'
]

const truncate = (text: string, max = 1200) => {
  const trimmed = String(text || '').trim()
  if (trimmed.length <= max) {
    return trimmed
  }
  return `${trimmed.slice(0, max)}…`
}

const formatJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const main = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()

  try {
    const userResult = await client.query(
      'SELECT id, email, name, default_organization_id FROM "user" WHERE lower(email) = lower($1) LIMIT 1',
      [TARGET_EMAIL]
    )

    if (userResult.rows.length === 0) {
      throw new Error(`No user found for ${TARGET_EMAIL}`)
    }

    const user = userResult.rows[0]

    const memberResult = await client.query(
      'SELECT organization_id FROM "member" WHERE user_id = $1',
      [user.id]
    )

    const orgIds = new Set<string>()
    if (user.default_organization_id) {
      orgIds.add(user.default_organization_id)
    }
    for (const row of memberResult.rows) {
      if (row.organization_id) {
        orgIds.add(row.organization_id)
      }
    }

    if (orgIds.size === 0) {
      throw new Error(`No organizations found for user ${TARGET_EMAIL}`)
    }

    const orgList = Array.from(orgIds)

    const conversationsResult = await client.query(
      'SELECT id, organization_id, created_at, updated_at FROM "conversation" WHERE organization_id = ANY($1) ORDER BY updated_at DESC LIMIT 120',
      [orgList]
    )

    const conversationIds = conversationsResult.rows.map(row => row.id)

    if (conversationIds.length === 0) {
      throw new Error(`No conversations found for orgs: ${orgList.join(', ')}`)
    }

    const messagesResult = await client.query(
      `SELECT id, conversation_id, role, content, payload, created_at
       FROM "conversation_message"
       WHERE conversation_id = ANY($1)
       ORDER BY conversation_id, created_at ASC`,
      [conversationIds]
    )

    const logsResult = await client.query(
      `SELECT id, conversation_id, type, message, payload, created_at
       FROM "conversation_log"
       WHERE conversation_id = ANY($1)
       ORDER BY conversation_id, created_at ASC`,
      [conversationIds]
    )

    const contentResult = await client.query(
      `SELECT id, conversation_id, title, slug, status, content_type, current_version_id, updated_at
       FROM "content"
       WHERE conversation_id = ANY($1)
       ORDER BY updated_at DESC`,
      [conversationIds]
    )

    const versionsResult = await client.query(
      `SELECT id, content_id, version, created_at, frontmatter, body_markdown
       FROM "content_version"
       WHERE content_id = ANY($1)
       ORDER BY content_id, version DESC`,
      [contentResult.rows.map((row: any) => row.id)]
    )

    const messagesByConversation = new Map<string, any[]>()
    for (const row of messagesResult.rows) {
      if (!messagesByConversation.has(row.conversation_id)) {
        messagesByConversation.set(row.conversation_id, [])
      }
      messagesByConversation.get(row.conversation_id)?.push(row)
    }

    const logsByConversation = new Map<string, any[]>()
    for (const row of logsResult.rows) {
      if (!logsByConversation.has(row.conversation_id)) {
        logsByConversation.set(row.conversation_id, [])
      }
      logsByConversation.get(row.conversation_id)?.push(row)
    }

    const contentByConversation = new Map<string, any[]>()
    for (const row of contentResult.rows) {
      if (!contentByConversation.has(row.conversation_id)) {
        contentByConversation.set(row.conversation_id, [])
      }
      contentByConversation.get(row.conversation_id)?.push(row)
    }

    const versionsByContent = new Map<string, any[]>()
    for (const row of versionsResult.rows) {
      if (!versionsByContent.has(row.content_id)) {
        versionsByContent.set(row.content_id, [])
      }
      versionsByContent.get(row.content_id)?.push(row)
    }

    const keywordRegex = new RegExp(KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')

    const candidateExamples: Array<{
      conversationId: string
      userMessage: any
      assistantMessage: any | null
      context: any[]
      logs: any[]
    }> = []

    for (const [conversationId, msgs] of messagesByConversation.entries()) {
      for (let i = 0; i < msgs.length; i += 1) {
        const message = msgs[i]
        if (message.role !== 'user') {
          continue
        }
        if (!keywordRegex.test(message.content || '')) {
          continue
        }
        let assistantMessage = null
        for (let j = i + 1; j < msgs.length; j += 1) {
          if (msgs[j].role === 'assistant') {
            assistantMessage = msgs[j]
            break
          }
        }
        const start = Math.max(0, i - CONTEXT_BEFORE)
        const end = Math.min(msgs.length, i + CONTEXT_AFTER + 1)
        const context = msgs.slice(start, end)
        candidateExamples.push({
          conversationId,
          userMessage: message,
          assistantMessage,
          context,
          logs: logsByConversation.get(conversationId) || []
        })
      }
    }

    const phraseHits: Array<{ conversationId: string, message: any, phrase: string }> = []
    for (const [conversationId, msgs] of messagesByConversation.entries()) {
      for (const msg of msgs) {
        if (msg.role !== 'assistant') {
          continue
        }
        const content = String(msg.content || '')
        for (const phrase of PHRASES) {
          if (content.toLowerCase().includes(phrase.toLowerCase())) {
            phraseHits.push({ conversationId, message: msg, phrase })
          }
        }
      }
    }

    const topExamples = candidateExamples.slice(0, MAX_EXAMPLES)

    const lines: string[] = []
    lines.push('# Bamboo Rewrite Examples (Auto Extracted)')
    lines.push('')
    lines.push(`User: ${user.email}`)
    lines.push(`User ID: ${user.id}`)
    lines.push(`Organizations: ${orgList.join(', ')}`)
    lines.push('')

    lines.push('## Examples')
    if (topExamples.length === 0) {
      lines.push('No rewrite-like examples found with keyword filter.')
    }

    topExamples.forEach((example, index) => {
      lines.push('')
      lines.push(`### Example ${index + 1}`)
      lines.push(`Conversation: ${example.conversationId}`)
      lines.push(`User message at: ${example.userMessage.created_at}`)
      lines.push('')

      lines.push('**Conversation context**')
      for (const msg of example.context) {
        lines.push(`- ${msg.created_at} [${msg.role}] ${truncate(msg.content || '', MAX_MESSAGE_CHARS)}`)
      }
      lines.push('')

      lines.push('**User request (full)**')
      lines.push('```')
      lines.push(truncate(example.userMessage.content || '', MAX_MESSAGE_CHARS))
      lines.push('```')
      lines.push('')

      lines.push('**Assistant response (full)**')
      if (example.assistantMessage) {
        lines.push('```')
        lines.push(truncate(example.assistantMessage.content || '', MAX_MESSAGE_CHARS))
        lines.push('```')
        lines.push('')
      } else {
        lines.push('No assistant response found after this user message.')
      }

      const toolLogs = example.logs.filter(log => ['tool_started', 'tool_retrying', 'tool_succeeded', 'tool_failed'].includes(log.type))
      if (toolLogs.length > 0) {
        lines.push('**Tool logs (conversation)**')
        for (const log of toolLogs.slice(0, MAX_TOOL_LOGS)) {
          lines.push(`- ${log.type} @ ${log.created_at}: ${truncate(log.message || '', 300)}`)
          if (log.payload) {
            lines.push('```json')
            lines.push(truncate(formatJson(log.payload), 1200))
            lines.push('```')
          }
        }
        lines.push('')
      }

      const contentItems = contentByConversation.get(example.conversationId) || []
      if (contentItems.length > 0) {
        lines.push('**Related content versions**')
        for (const item of contentItems) {
          lines.push(`- Content: ${item.title} (${item.id}) status=${item.status} updated=${item.updated_at}`)
          const versions = (versionsByContent.get(item.id) || []).slice(0, MAX_VERSIONS)
          for (const version of versions) {
            const diffStats = version.frontmatter?.diffStats || version.frontmatter?.diff_stats || null
            lines.push(`  - v${version.version} ${version.created_at} id=${version.id} diffStats=${diffStats ? formatJson(diffStats) : 'n/a'}`)
            lines.push('```')
            lines.push(truncate(version.body_markdown || '', MAX_BODY_CHARS))
            lines.push('```')
          }
          if (versions.length >= 2) {
            const latest = versions[0]
            const previous = versions[1]
            const comparison = calculateDiffStats(previous.body_markdown || '', latest.body_markdown || '')
            lines.push(`  - Version compare (v${previous.version} → v${latest.version}): +${comparison.additions} / -${comparison.deletions}`)
          }
        }
        lines.push('')
      }
    })

    lines.push('## Repeated Phrase Hits')
    if (phraseHits.length === 0) {
      lines.push('No assistant messages matched the target phrases.')
    } else {
      phraseHits.slice(0, 5).forEach((hit, idx) => {
        lines.push('')
        lines.push(`### Phrase Hit ${idx + 1}`)
        lines.push(`Phrase: ${hit.phrase}`)
        lines.push(`Conversation: ${hit.conversationId}`)
        lines.push(`Message at: ${hit.message.created_at}`)
        lines.push('```')
        lines.push(truncate(hit.message.content || '', MAX_MESSAGE_CHARS))
        lines.push('```')
      })
    }

    lines.push('')
    lines.push('## Notes')
    lines.push(`- Keyword filter uses: ${KEYWORDS.join(', ')}`)
    lines.push(`- MAX_EXAMPLES=${MAX_EXAMPLES}, CONTEXT_BEFORE=${CONTEXT_BEFORE}, CONTEXT_AFTER=${CONTEXT_AFTER}`)
    lines.push(`- Output is truncated (messages: ${MAX_MESSAGE_CHARS} chars, body: ${MAX_BODY_CHARS} chars).`)
    lines.push('- Tool logs include payload JSON when present.')

    const outputPath = 'docs/bamboo-rewrite-examples.md'
    await writeFile(outputPath, lines.join('\n'), 'utf8')

    console.log(`Wrote ${outputPath} with ${topExamples.length} examples and ${phraseHits.length} phrase hits.`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('Failed to extract examples:', error)
  process.exit(1)
})
