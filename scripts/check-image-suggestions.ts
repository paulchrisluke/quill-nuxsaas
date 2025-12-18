#!/usr/bin/env tsx
/**
 * Check image suggestions for a content item
 *
 * Usage:
 *   pnpm dlx tsx scripts/check-image-suggestions.ts <content-slug-or-id>
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

const contentIdentifier = process.argv[2]
if (!contentIdentifier) {
  console.error('❌ Content slug or ID is required')
  console.error('Usage: pnpm dlx tsx scripts/check-image-suggestions.ts <content-slug-or-id>')
  process.exit(1)
}

const dbPool = new Pool({ connectionString: databaseUrl })

async function checkBinaries() {
  console.log('\n🔧 Checking Required Binaries:')
  console.log('='.repeat(60))

  const { execSync } = await import('child_process')

  // Check yt-dlp
  try {
    const ytdlpVersion = execSync('yt-dlp --version', { encoding: 'utf-8', stdio: 'pipe' }).trim()
    console.log(`✅ yt-dlp: Installed (version: ${ytdlpVersion})`)
  } catch {
    console.log('❌ yt-dlp: NOT INSTALLED')
    console.log('   Install with: brew install yt-dlp (macOS) or pip install yt-dlp')
  }

  // Check ffmpeg
  try {
    const ffmpegVersion = execSync('ffmpeg -version', { encoding: 'utf-8', stdio: 'pipe' }).split('\n')[0]
    console.log(`✅ ffmpeg: Installed (${ffmpegVersion})`)
  } catch {
    console.log('❌ ffmpeg: NOT INSTALLED')
    console.log('   Install with: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux)')
  }

  console.log('='.repeat(60))
}

async function checkImageSuggestions() {
  try {
    // Check if identifier is UUID or slug
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contentIdentifier)
    const whereClause = isUuid ? 'c.id = $1' : 'c.slug = $1'

    // Get content and version with assets
    const contentQuery = `
      SELECT
        c.id,
        c.title,
        c.slug,
        c.source_content_id,
        cv.id as version_id,
        cv.version as version_number,
        cv.assets,
        cv.assets->'imageSuggestions' as image_suggestions,
        jsonb_array_length(COALESCE(cv.assets->'imageSuggestions', '[]'::jsonb)) as suggestion_count,
        cv.assets->'generator' as generator_metadata
      FROM content c
      JOIN content_version cv ON cv.id = c.current_version_id
      WHERE ${whereClause}
      LIMIT 1
    `

    const contentResult = await dbPool.query(contentQuery, [contentIdentifier])

    if (contentResult.rows.length === 0) {
      console.error(`❌ Content not found: ${contentIdentifier}`)
      process.exit(1)
    }

    const content = contentResult.rows[0]
    console.log('\n📄 Content Information:')
    console.log('='.repeat(60))
    console.log(`ID: ${content.id}`)
    console.log(`Title: ${content.title}`)
    console.log(`Slug: ${content.slug}`)
    console.log(`Source Content ID: ${content.source_content_id || 'None'}`)
    console.log(`Version ID: ${content.version_id}`)
    console.log(`Version Number: ${content.version_number}`)
    console.log(`Image Suggestions Count: ${content.suggestion_count || 0}`)

    // Check source content if it exists
    if (content.source_content_id || content.sourceContentId) {
      const sourceQuery = `
        SELECT
          id,
          source_type,
          external_id,
          ingest_status,
          metadata->'youtube' as youtube_metadata,
          CASE
            WHEN metadata->'youtube'->>'videoId' IS NOT NULL THEN metadata->'youtube'->>'videoId'
            ELSE NULL
          END as video_id,
          CASE
            WHEN metadata->'youtube'->>'vttContent' IS NOT NULL THEN 'Yes'
            ELSE 'No'
          END as has_vtt_content
        FROM source_content
        WHERE id = $1
        LIMIT 1
      `
      const sourceResult = await dbPool.query(sourceQuery, [content.source_content_id])

      if (sourceResult.rows.length > 0) {
        const source = sourceResult.rows[0]
        console.log('\n🎥 Source Content Information:')
        console.log('='.repeat(60))
        console.log(`Source Type: ${source.source_type}`)
        console.log(`External ID: ${source.external_id || 'None'}`)
        console.log(`Video ID: ${source.video_id || 'None'}`)
        console.log(`Ingest Status: ${source.ingest_status}`)
        console.log(`Has VTT Content: ${source.has_vtt_content}`)
        console.log(`Is YouTube: ${source.source_type === 'youtube' && !!source.video_id ? 'Yes ✅' : 'No ❌'}`)
      }
    }

    // Check image suggestions
    console.log('\n🖼️  Image Suggestions:')
    console.log('='.repeat(60))

    if (!content.image_suggestions || content.suggestion_count === 0) {
      console.log('❌ No image suggestions found in assets')
      console.log('\nDebugging:')
      console.log(`- Assets exists: ${content.assets ? 'Yes' : 'No'}`)
      console.log(`- Assets keys: ${content.assets ? Object.keys(content.assets).join(', ') : 'N/A'}`)
      if (content.generator_metadata) {
        console.log(`- Generator stages: ${JSON.stringify((content.generator_metadata as any)?.stages || [])}`)
      }
    } else {
      const suggestions = content.image_suggestions as any[]
      console.log(`✅ Found ${suggestions.length} image suggestion(s)\n`)

      suggestions.forEach((suggestion, index) => {
        console.log(`\nSuggestion ${index + 1}:`)
        console.log(`  Type: ${suggestion.type || 'N/A'}`)
        console.log(`  Section ID: ${suggestion.sectionId || 'N/A'}`)
        console.log(`  Position: ${suggestion.position || 'N/A'}`)
        console.log(`  Alt Text: ${suggestion.altText || 'N/A'}`)
        console.log(`  Priority: ${suggestion.priority || 'N/A'}`)
        console.log(`  Status: ${suggestion.status || 'N/A'}`)

        if (suggestion.type === 'screencap') {
          console.log(`  Video ID: ${suggestion.videoId || 'N/A'}`)
          console.log(`  Estimated Timestamp: ${suggestion.estimatedTimestamp || 'N/A'} seconds`)
          console.log(`  Thumbnail URL: ${suggestion.thumbnailUrl || 'Not generated'}`)
          console.log(`  Full Size URL: ${suggestion.fullSizeUrl || 'Not inserted'}`)
        }
      })
    }

    // Check generator stages
    if (content.generator_metadata) {
      const stages = (content.generator_metadata as any)?.stages || []
      console.log('\n🔧 Generator Stages:')
      console.log('='.repeat(60))
      console.log(`Stages: ${stages.length > 0 ? stages.join(', ') : 'None'}`)
      console.log(`Has image_suggestions stage: ${stages.includes('image_suggestions') ? 'Yes ✅' : 'No ❌'}`)
      console.log(`Has image_thumbnails stage: ${stages.includes('image_thumbnails') ? 'Yes ✅' : 'No ❌'}`)
    }
    console.log(`\n${'='.repeat(60)}`)
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await dbPool.end()
  }
}

async function main() {
  await checkBinaries()
  await checkImageSuggestions()
}

main()
