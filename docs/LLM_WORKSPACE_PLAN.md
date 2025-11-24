# LLM Codex Workspace & Source Content Plan

## Goals

- Integrate a "codex"-style LLM content system into the existing Nuxt SaaS backend.
- Reuse current auth/org/membership/integration patterns.
- Keep v1 **simple and organization-scoped** (no separate `workspace` table yet).
- Introduce clear, well-named domain entities:
  - `source_content` (ingested material from YouTube, Google Docs, raw text, etc.)
  - `content` (the article/post entity) with a `status` field
  - `content_version` / `content_section`
  - `publication` (to WordPress, Google Docs, etc.).

---

## Existing Foundations (Nuxt SaaS)

Already present in `server/database/schema/auth.ts` and migrations:

- `user`, `organization`, `member`, `session`, `invitation`, `subscription`.
- `integration` (per-organization OAuth-style integrations).
- `audit_log`, `file`.

We will **attach all new entities to `organization.id`** and often to `user.id` for authorship.

---

## New Core Entities (v1)

### 1. `source_content`

**Purpose**: The original material the LLM works from (YouTube, Google Docs, pasted text, etc.).

**Suggested columns:**

- `id` (text/uuid, PK)
- `organization_id` (FK → `organization.id`, not null)
- `created_by_user_id` (FK → `user.id`, not null)

- `source_type` (text, not null)  
  Examples: `"youtube"`, `"google_doc"`, `"raw_text"`, `"url"`, `"file_upload"`.
- `external_id` (text, nullable)  
  - YouTube: video ID  
  - Google Docs: doc ID  
  - WordPress: post ID (if reverse-ingesting)
- `title` (text, nullable)
- `source_text` (text, nullable) — normalized text transcript/body the LLM will consume.
- `metadata` (json/text, nullable) — provider-specific metadata.
- `ingest_status` (text, not null, default `'pending'`)  
  Values: `pending | ingested | failed`.

- `created_at` (timestamp, default now, not null)
- `updated_at` (timestamp, default now, on update, not null)

---

### 2. `content`

**Purpose**: The main article/post object users work on. Represents a logical piece of content; `draft` is a **status**, not a separate entity.

**Suggested columns:**

- `id` (text/uuid, PK)
- `organization_id` (FK → `organization.id`, not null)
- `workspace_id` (FK → `workspace.id`, nullable)
- `source_content_id` (FK → `source_content.id`, nullable)
- `created_by_user_id` (FK → `user.id`, not null)

- `slug` (text, not null) — internal slug within organization or workspace.
- `title` (text, not null)
- `status` (text, not null, default `'draft'`)  
  Values: `draft | in_review | ready_for_publish | published | archived`.
- `primary_keyword` (text, nullable)
- `target_locale` (text, nullable, e.g. `"en-US"`).
- `content_type` (text, not null, default `'blog_post'`)  
  Examples: `blog_post | landing_page | docs_article | social_thread`.

- `current_version_id` (FK → `content_version.id`, nullable)

- `created_at` (timestamp, default now, not null)
- `updated_at` (timestamp, default now, on update, not null)
- `published_at` (timestamp, nullable)

---

### 3. `content_version`

**Purpose**: Immutable snapshot of a draft produced by the LLM or manual edits.

**Suggested columns:**

- `id` (text/uuid, PK)
- `content_draft_id` (FK → `content_draft.id`, not null)
- `version` (integer, not null) — monotonically increasing per draft.
- `created_by_user_id` (FK → `user.id`, nullable if system-generated)
- `created_at` (timestamp, default now, not null)

- `frontmatter` (json/text, nullable)  
  - title, description, tags, categories, canonical URL, etc.
- `body_mdx` (text, not null)
- `body_html` (text, nullable) — pre-rendered HTML for previews/publishing.
- `sections` (json/text, nullable)  
  - serialized representation of sections; can be expanded into a table later.
- `assets` (json/text, nullable)  
  - images, tables, generator metadata:
    - e.g. `{ "generator": { "source": "blog_from_youtube", "model": "gpt-4.1" } }`.

- `seo_snapshot` (json/text, nullable)  
  - snapshot of SEO configuration and analysis at time of generation.

**Notes:**

- `content_draft.current_version_id` always points to the latest accepted version.

---

### 4. `content_section` (optional, can be added later)

**Purpose**: Fine-grained editing of specific sections (e.g. H2 blocks, FAQs).

**Suggested columns:**

- `id` (text/uuid, PK)
- `content_version_id` (FK → `content_version.id`, not null)
- `index` (integer, not null) — order within the version.
- `type` (text, nullable)  
  Examples: `heading | paragraph | list | faq | cta | code_block`.
- `title` (text, nullable) — for headings.
- `body_mdx` (text, not null)
- `word_count` (integer, not null, default 0)
- `metadata` (json/text, nullable) — e.g. heading level, anchors.

This table can be populated by a Node equivalent of `extract_sections_from_mdx`.

---

### 5. `publication`

**Purpose**: Track publishing events from drafts to external systems.

**Suggested columns:**

- `id` (text/uuid, PK)
- `organization_id` (FK → `organization.id`, not null)
- `content_draft_id` (FK → `content_draft.id`, not null)
- `content_version_id` (FK → `content_version.id`, not null)
- `integration_id` (FK → `integration.id`, not null)

- `external_id` (text, nullable) — remote post/doc ID.
- `status` (text, not null, default `'pending'`)  
  Values: `pending | success | failed`.
- `published_at` (timestamp, nullable)
- `payload_snapshot` (json/text, nullable) — what we sent to the remote system.
- `response_snapshot` (json/text, nullable) — remote response.
- `error_message` (text, nullable)

- `created_at` (timestamp, default now, not null)

---

## Alignment With Existing Conventions

- Table names: snake_case, singular (`source_content`, `content`, etc.), matching `user`, `organization`, `integration`, `file`.
- ID types: text/uuid PKs generated via `uuidv7` (same pattern as `file.id`).
- Org scoping: all new tables carry `organization_id` and often `workspace_id`.
- Auth: access control mirrors `organization/integrations.get.ts`:
  - `requireAuth(event)` → `user`.
  - Resolve `organization_id` via `user.lastActiveOrganizationId` or session.
  - Check `member` table for membership/role.

---

## Chat-First Flow (High-Level)

The LLM will commonly be driven from a chat interface where users paste YouTube or Google Docs links.

Typical flow:

1. **User sends a chat message** that may contain URLs.
2. **System parses URLs** in the message content.
   - For YouTube / Google Docs / other supported providers, either:
     - Find an existing `source_content` row by (`organization_id`, `source_type`, `external_id`), or
     - Create a new `source_content` row with `source_type`, `external_id`, and `ingest_status = 'pending'`.
3. **Ingest pipeline** resolves `source_text` for new `source_content` records (e.g. YouTube transcripts, Google Docs body) and sets `ingest_status = 'ingested'`.
4. When the user or system issues an instruction like *"turn this into an SEO blog post"*:
   - Create a new `content` row tied to:
     - `organization_id`
     - `created_by_user_id`
     - optional `source_content_id` (the primary source for this article).
   - Run the LLM using `source_text` + chat history + SEO settings to produce an initial `content_version` (version `1`).
   - Set `content.current_version_id` to this new version and leave `status = 'draft'`.
5. Subsequent chat interactions like *"rewrite the intro"* or *"optimize for keyword XYZ"*:
   - Create new `content_version` rows (version `2`, `3`, ...), potentially updating sections.
   - Optionally update `content.status` to `ready_for_publish` when the user is satisfied.

This design keeps `source_content` focused on **where the material came from and how it was ingested**, while `content` models the **SEO-ready MDX article** with `draft` as just one of several states.

## Chat API & Conversation Behavior

To support "normal" conversation while still discovering sources and generating content, we separate **chat handling** from **generation triggers**.

### Chat endpoint

- `POST /api/chat` (example path)
  - Body:
    - `message: string`
    - optional `contentId` or `sourceContentId`
  - Response:
    - `assistantMessage: string`
    - optional `actions: Array<{ type: string; payload: any }>` (e.g. suggestions like `suggest_generate`).

Behavior:

- Use `requireAuth(event)` and org membership checks.
- Resolve `organization_id` from the session (same pattern as integrations).
- Optionally persist chat history in `chat_session` / `chat_message` tables later.

### URL detection during normal conversation

Within the chat handler:

1. Parse URLs from `message` (simple URL regex / parser).
2. For each URL:
   - Classify type: YouTube, Google Docs, generic article, etc.
   - **Upsert** a `source_content` row scoped to the organization:
     - `organization_id`, `created_by_user_id`
     - `source_type`, `external_id`, optional `title`
     - `ingest_status = 'pending'` initially
3. Optionally trigger background ingest to populate `source_text` for new `source_content` records.

This runs for all chat messages so the system quietly accumulates sources, but it does **not** auto-generate content.

### Confirmation-driven generation (LLM asks first)

Typical LLM pattern:

- Step 1: Detect URLs and upsert `source_content` as above.
- Step 2: Have the LLM respond with a natural question, for example:
  - "I found a YouTube link in your message – would you like me to start an SEO blog draft based on it?"
  - "I see a Google Doc link; should I create an article outline from that document?"
- Step 3: On the **next user message** ("yes", "go ahead", etc.), the chat handler treats this as confirmation and triggers generation.

Implementation sketch:

- `/api/chat` remains the single entry point for conversation.
- URL detection and `source_content` upsert occur whenever messages are received.
- The LLM response decides whether to *offer* an action ("start a draft") based on context.
- When the user confirms, `/api/chat` can:
  - Internally call the content generation logic (equivalent to `POST /api/content/generate`), or
  - Expose this as an explicit front-end call while still reflecting the intent in `actions`.

Dedicated content endpoints still perform the heavy work:

- `POST /api/content/generate`
  - Uses `source_content.source_text` and SEO options + AI Gateway to create an initial `content_version` and update `content.current_version_id`.
- `POST /api/content/[contentId]/sections/patch`
  - Uses the AI Gateway to patch sections and create new `content_version` rows.

This keeps **conversation** natural, with the LLM first asking permission to start a draft, and only generating content after explicit confirmation within the same conversational flow.

## YouTube Ingest, Chunking & Embeddings (v1)

For v1 we will support **YouTube-only ingest** for long-form source content; Google Docs and other rich sources are explicitly deferred.

### YouTube ingest

- When a YouTube URL is detected and confirmed by the user ("yes, start a draft"):
  - Upsert a `source_content` row with:
    - `source_type = 'youtube'`
    - `external_id` = YouTube video ID
    - `metadata` containing basic video metadata (title, channel, duration) when available.
  - Run a YouTube ingest helper (Node equivalent of current Python logic) that:
    - Fetches or receives the transcript.
    - Normalizes it into `source_text`.
    - Updates `source_content.source_text` and `ingest_status = 'ingested'`.

### Chunking & embeddings (required v1)

- Long 20–30 minute transcripts **must** be handled via chunks and embeddings so the LLM can work with manageable context:
- V1 will define a concrete `chunk` concept:
  - Each chunk belongs to an `organization_id` and a `source_content_id`.
  - Chunk metadata includes at least: `index`, `start_char`, `end_char`, and a short `text_preview`.
  - Implementation detail:
    - Initial implementation may store chunk metadata in `content_version.sections` / `assets`.
    - A dedicated `chunk` table can be introduced (or generated via migration) without changing the external API.
  - Chunk `source_text` into overlapping segments with indices and character ranges.
  - Compute and store embeddings in the chosen vector store keyed by organization + source/video and chunk index.
- Content generation and later edits will:
  - Pull relevant transcript chunks/snippets based on the current section / instructions and similarity search.
  - Feed only those chunks plus high-level summary into the AI Gateway calls so that long videos are handled reliably.

This ensures the system can handle long videos in a codex-like fashion without hitting model context limits.

## Migration Plan (High-Level)

1. **Add new Drizzle schema files**
   - `server/database/schema/sourceContent.ts`
   - `server/database/schema/content.ts` (for `content`, `content_version`, `content_section`, `publication`).
   - Export them from `server/database/schema/index.ts`.

2. **Generate and run migrations**
   - Use Drizzle migration tooling from `drizzle.config.ts`.
   - Validate against existing migrations `0000`–`0002` to avoid conflicts.

3. **Add basic API routes**
   - `server/api/workspaces/*.ts`  
     - Create/list workspaces in an org.
   - `server/api/source-content/*.ts`  
     - Create/list `source_content` records (e.g. from YouTube, pasted text).
   - `server/api/content-drafts/*.ts`  
     - CRUD for `content_draft` and attach to `workspace` + `source_content`.
   - `server/api/content/*.ts`  
      - CRUD for `content` and attach to `source_content`.

4. **Wire in LLM operations via Cloudflare AI Gateway (Option 2)** ✅

   Reuse the existing, working AI Gateway pattern directly from the Nuxt/Node backend.

   **Config / environment (Nuxt runtimeConfig):**

   - Reuse `NUXT_CF_ACCOUNT_ID` (already used for R2) as the Cloudflare account ID for AI Gateway.
   - `NUXT_CF_AI_GATEWAY_TOKEN`
   - `NUXT_OPENAI_BLOG_MODEL` (default: `gpt-5.1` or `gpt-4.1-mini`)
   - `NUXT_OPENAI_BLOG_TEMPERATURE` (default: `0.6`)
   - `NUXT_OPENAI_BLOG_MAX_OUTPUT_TOKENS` (default: `2200`)

   **Shared helper:** `server/utils/aiGateway.ts`

   - Build `gatewayBase = https://gateway.ai.cloudflare.com/v1/${NUXT_CF_ACCOUNT_ID}/quill/openai`.
   - Implement `callChatCompletions({ model, systemPrompt, userPrompt, temperature, maxTokens })`:
     - `POST /chat/completions`
     - Headers:
       - `Content-Type: application/json`
       - `cf-aig-authorization: Bearer ${NUXT_CF_AI_GATEWAY_TOKEN}`
     - Body mirrors Python implementation:
       - `model`
       - `messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]`
       - `temperature`
       - optional `max_completion_tokens`.
     - Parse `choices[0].message.content` (string or list of segments) into a single string.

   **High-level AI functions (Node equivalents of Python helpers):**

   - `composeBlogFromText(text, options)`
     - Port logic from `compose_blog_from_text` (Python):
       - Clean/validate `text`.
       - Generate SEO metadata and build system/user prompts.
       - Call `callChatCompletions`.
       - Return `{ markdown, meta }` (markdown body + metadata: word count, engine, model, SEO fields).
   - `callAiGatewayForSection(systemPrompt, userPrompt)`
     - Port `_call_ai_gateway_for_section` behavior:
       - Use `OPENAI_BLOG_MODEL` + `OPENAI_BLOG_TEMPERATURE`.
       - Call `callChatCompletions`.
       - Extract and trim the new section body from `choices[0].message.content`.

   **API usage:**

   - `POST /api/content/generate` (or similar):
     - Resolve `source_content.source_text` for the org.
     - Call `composeBlogFromText` to get MDX.
     - Create `content_version` (version `1`) and set `content.current_version_id`.
   - `POST /api/content/[contentId]/sections/patch`:
     - Load current `content_version` and extract the target section.
     - Build prompts equivalent to `_build_section_patch_prompts` in Python.
     - Call `callAiGatewayForSection`.
     - Create a new `content_version` with the patched section and update `content.current_version_id`.

5. **Publishing flows**
   - Endpoints to publish a `content_version` through an `integration` to:
     - WordPress
     - Google Docs
     - Other channels
   - Record a `publication` row per publish attempt.

6. **Progressive enhancement**
   - Later, introduce `seo_profile` and `generation_job` tables if needed.
   - Add analytics and activity feeds tying into `audit_log`.

---

## SEO-aware Generation (v1)

We will not ship a separate SEO analyzer UI in v1, but the generation pipeline must still produce **SEO-ready, branded articles**.

### Org-level SEO & branding config

- Store simple org-level SEO/brand settings in a JSON field (either on `organization.metadata` or a future `seo_profile` table), for example:
  - Preferred tone (e.g. "authoritative but friendly").
  - Target audience/persona description.
  - Default content types (blog, docs, landing pages).
  - Brand voice guidelines and style notes.

### Prompting for SEO-quality output

- `composeBlogFromText` will:
  - Pull org-level SEO/brand config.
  - Compute lightweight SEO metadata (title hint, keywords) from `source_text`.
  - Build system + user prompts that include:
    - Brand voice and tone.
    - Target keywords and meta description guidance.
    - Requirements for headings, structure, CTAs, and internal linking suggestions.

### Frontmatter and sections

- Each `content_version` should:
  - Populate `frontmatter` with SEO-friendly fields:
    - `title`, `description`, `slug`, `tags/categories`, canonical URL placeholder.
  - Use sections/headings that map cleanly to:
    - H1 title.
    - H2/H3 subsections organized around search intent.
  - Optionally store a `seo_snapshot` JSON block with:
    - Chosen keywords.
    - Content type hints.
    - Any scores or heuristics we compute later.

#### Sections JSON shape

- `sections` on `content_version` will be a structured index over `body_mdx`, for example:

  ```json
  [
    {
      "id": "sec_01_intro",
      "index": 0,
      "type": "heading_block",
      "level": 2,
      "title": "Introduction",
      "startOffset": 0,
      "endOffset": 512,
      "anchor": "introduction",
      "wordCount": 120,
      "meta": {
        "isSummary": false,
        "isKeySection": true
      }
    }
  ]
  ```

- Recommended fields per section:
  - `id`: stable identifier (e.g. `sec_${versionId}_${index}` or UUID).
  - `index`: numeric order within the article.
  - `type`: e.g. `heading_block`, `faq_block`, `cta_block`, etc.
  - `level`: heading level (2 for H2, 3 for H3), if applicable.
  - `title`: heading text for that section.
  - `startOffset` / `endOffset`: 0-based character indices into `body_mdx` (end exclusive).
  - `anchor`: slug/anchor used for TOC or deep links.
  - `wordCount`: precomputed word count for the section.
  - `meta`: freeform JSON for additional flags/SEO hints.

- Section patching flow:
  - Load current `content_version` (`body_mdx`, `sections`).
  - Find target section by `id` or `index`.
  - Extract the current section body via `body_mdx.slice(startOffset, endOffset)`.
  - Build prompts using this text + instructions + relevant transcript chunks.
  - Replace that slice in `body_mdx` with the new section body.
  - Re-run the section extractor (`extract_sections_from_mdx` equivalent) to regenerate `sections`.
  - Persist a new `content_version` row and update `content.current_version_id`.

### Content type and schema.org behavior

- We distinguish between:
  - `content_type`: internal category used for prompt guidance (often `blog_post` in v1, but may include values like `recipe`, `course`, `faq_page`).
  - `schema_type`: the schema.org type that should be reflected in JSON-LD (e.g. `Article`, `BlogPosting`, `Recipe`, `FAQPage`, `HowTo`, `Course`).
- In v1, most flows will use `content_type = 'blog_post'` with `schema_type = 'Article'` or `BlogPosting`, but when the user or org configuration indicates a more specific pattern (e.g. recipe, course, FAQ), prompts and frontmatter/JSON-LD should:
  - Switch to the appropriate `schema_type`.
  - Encourage the LLM to produce the extra structure those schemas expect (ingredients/steps for `Recipe`, questions/answers for `FAQPage`, etc.).


This makes the articles SEO-aware from the first generation, and keeps the underlying data model ready for a more advanced analyzer or additional SEO tooling in a later phase.

## Directory & File Structure (Nuxt Repo)

## Directory & File Structure (Nuxt Repo)

Given the current layout of `nuxt-saas-v1`, we will follow existing conventions.

### Database schema & migrations

- `server/database/schema/`
  - `auth.ts` (existing)
  - `file.ts` (existing)
  - `auditLog.ts` (existing)
  - **New:** `sourceContent.ts`
  - **New:** `content.ts`
  - **Future (but recommended early):** `chunk.ts`
  - `index.ts` should export everything:
    - `export * from './auditLog'`
    - `export * from './auth'`
    - `export * from './file'`
    - `export * from './sourceContent'`
    - `export * from './content'`

- `server/database/migrations/`
  - Existing `0000`, `0001`, `0002` migrations remain.
  - New migrations generated by Drizzle to create:
    - `source_content`
    - `content`
    - `content_version`
    - optional `content_section`
    - optional `chunk`
    - `publication`

### Backend utilities

- `server/utils/`
  - `auth.ts` (existing, better-auth)
  - `db.ts` (existing, Drizzle Postgres helper)
  - **New:** `aiGateway.ts`
    - Implements `callChatCompletions` and higher-level helpers:
      - `composeBlogFromText`
      - `callAiGatewayForSection`
  - Optional future utilities:
    - `seo.ts` (SEO helpers for computing title/slug/keywords, building JSON-LD blocks, and normalizing `frontmatter` / `seo_snapshot` fields.)
    - `chatRouter.ts` (chat-specific helpers for URL parsing, light intent/command detection such as recognizing "start a draft" or "edit intro" requests.)

### API routes

- `server/api/`
  - `organization/integrations.get.ts` (existing pattern for org-scoped routes)
  - **Chat:**
    - `chat.post.ts` or `chat/index.post.ts`
      - Uses `requireAuth`, resolves `organization_id`, handles chat + URL detection.
  - **Source content:**
    - `source-content/index.get.ts` / `index.post.ts` (optional admin listing/creation APIs).
  - **Content & versions:**
    - `content/index.post.ts` (manual content creation if needed).
    - `content/generate.post.ts` or `content/[contentId]/generate.post.ts` (wire into AI Gateway).
    - `content/[contentId]/sections/patch.post.ts` (section editing via AI Gateway).
  - **Publishing:**
    - `content/[contentId]/publish.post.ts` or
    - `content/[contentId]/publish/[integrationId].post.ts`
      - Uses existing `integration` table.

All routes should:

- Call `requireAuth(event)` from `server/utils/auth.ts`.
- Use `getDB()` / `useDB()` from `server/utils/db.ts`.
- Scope queries by `organization_id` using the same pattern as `organization/integrations.get.ts`.

---

## Next Steps

- Implement Drizzle schema definitions for `source_content`, `content`, `content_version`, `content_section`, `publication` following this plan.
- Generate and apply migrations.
- Implement `server/utils/aiGateway.ts` and the high-level helpers `composeBlogFromText` and `callAiGatewayForSection`.
- Scaffold Nuxt server routes that:
  - Use `requireAuth` and org membership checks.
  - Operate at the `organization` level.
  - Return consistent JSON shapes for the front-end codex UI.
