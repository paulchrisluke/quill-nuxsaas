# Edit Ops Refactor Audit

## Scope
This document covers the current AI editing architecture and a proposed refactor from section-based edits to patch-based edit operations. It excludes UI changes and does not propose backwards compatibility for section tools.

## Status Update (Post-Refactor)
- Implemented `edit_ops` tool with patch-based edits and constraints.
- Removed `edit_section` and `move_section` from tool definitions and execution paths.
- Section update API endpoint removed to avoid backwards compatibility.

## Audit Findings
The findings below reflect the pre-refactor state; see Status Update above for current behavior.

### Current tool surface (server/services/chat/tools.ts)
- Write tools: `content_write`, `edit_section`, `move_section`, `edit_metadata`, `insert_image`
- Ingest tool: `source_ingest`
- Read tools: `read_content`, `read_section`, `read_source`, `read_content_list`, `read_source_list`, `read_workspace_summary`, `analyze_content_images`, `read_files`

### Section-based edit pipeline
- Tool selection explicitly prefers `edit_section` for content edits (server/services/chat/agent.ts).
- `edit_section` executes in the chat API (server/api/chat/index.post.ts) and calls `updateContentSection`.
- `updateContentSectionWithAI` rewrites an entire section based on instructions, then reassembles the full markdown (server/services/content/generation/index.ts).
- This encourages broad rewrites and can change phrasing beyond the user’s intent.

### Edit output behavior
- The system currently accepts full section rewrites from the model, which makes it easy to over-edit even for small requests.
- Diff stats are calculated after the fact, not used as a guardrail to limit edits.
- The UX can show “focused changes,” but this is UI-only and does not constrain edits.

## Goals (Non-UI)
1. Make edits deterministic and scope-limited: small instructions produce small changes.
2. Preserve original phrasing by default unless the user explicitly requests a rewrite.
3. Route natural language requests (e.g., “replace X in conclusion with Y”) to precise edit operations.
4. Remove section-based edit tools and logic entirely (no fallback, no backwards compatibility).
5. Keep ingest, writing, images, and metadata edits intact.

## Proposed Architecture

### 1) New edit-ops tool (patch-based)
Add a tool (e.g., `edit_ops`) that accepts structured operations and applies them to the current markdown.

Example schema (high level):
- `contentId`
- `ops`: list of operations with type `replace`, `insert`, `delete`
- `anchors`: text fragments or line hints to localize edits
- `scope`: optional section title or natural-language scope (“conclusion”, “first paragraph”)
- `constraints`: optional (max changed lines, disallow heading changes)

The model outputs an edit plan; the server applies it deterministically.

### 2) Deterministic patcher + validation gates
Implement a patcher that:
- Locates anchors with exact/fuzzy matching.
- Applies minimal edits only where anchored.
- Validates against constraints (max diff size, scope boundaries).
- Rejects the patch if it touches unrelated areas or exceeds limits.
- If ambiguous, return a single clarifying question instead of rewriting.

### 3) Tool routing
- Update agent/tool selection to use `edit_ops` for precise modifications.
- Keep `content_write` for new drafts and `edit_metadata` for metadata changes.
- Preserve `insert_image` and `source_ingest` paths unchanged.

### 4) Remove section-based tooling
Delete section tools entirely:
- Remove `edit_section` and `move_section` from tool definitions and routing.
- Remove section-based execution branches in the chat API.
- Remove or retire `updateContentSectionWithAI` and related helpers.
- Remove section tool guards from reference enforcement.

## Expected Outcomes
- Small natural language edits result in minimal diffs.
- Reduced “helpful” rephrasing and stylistic drift.
- Clear separation between “create new content” and “patch existing content.”

## Non-Goals
- No UI changes or layout work.
- No backwards compatibility for section tools.
- No prompt/UI personalization changes beyond tool routing.

## Risks
- Anchors may be ambiguous; must ask clarification when multiple matches exist.
- If constraints are too strict, edits may fail more often; needs tuning.
- Requires careful patch validation to avoid partial corruptions.

## Answers to Review Questions

### LLM Prompting & Context

#### Exact prompt template for rewrite operations
System message (server/services/content/generation/sections.ts):
```
You are revising a single section of an existing article. Only update that section using the author instructions and contextual snippets. Do NOT include the section heading in your response - only write the body content. Respond with JSON.
```

User message (server/services/content/generation/index.ts, constructed in updateContentSectionWithAI):
```
You are editing a single section of a {frontmatter.contentType}.
Section title: {targetSection.title}
Current section body:
{targetSection.body}
Author instructions: {trimmedInstructions}
Organization tone guide:
{tonePrompt}
Frontmatter: {JSON.stringify(frontmatter fields)}
Context to ground this update:
{contextBlock}
Respond with JSON {"body": string, "summary": string?}. Rewrite only this section content - do NOT include the section heading or title, as it will be added automatically.
```

#### How much context is sent
- Only the current section body + frontmatter + tone prompt + RAG chunks.
- Not the full draft.
- The original transcript is only included if it appears in the retrieved RAG chunks.
- RAG chunks are fetched via `findGlobalRelevantChunks` and truncated to ~600 chars each.

#### Model + parameters
- Model: `NUXT_OPENAI_BLOG_MODEL` (default `gpt-4o-mini`).
- Temperature: `NUXT_OPENAI_BLOG_TEMPERATURE` (default 0.6).
- Max output tokens: `NUXT_OPENAI_BLOG_MAX_OUTPUT_TOKENS` (default 2200).
- `top_p` is not set.
- Source: `server/utils/aiGateway.ts` and `server/utils/runtimeConfig.ts`.

#### How tone settings are incorporated
- `tonePrompt` is pulled from organization metadata (`siteConfig.tonePrompt`).
- It is appended into the user prompt as `Organization tone guide:` for both section generation and section updates.
- There is no separate system-level enforcement beyond this prompt injection.

### Content Structure & State

#### How a “section” is defined
- Stored in `contentVersion.sections` as a structured array (id/title/index/level/startOffset/endOffset/etc.).
- `normalizeContentSections` uses offsets to extract section bodies from markdown.
- Not based on paragraph breaks; it is structured data built during generation/assembly.
- Source: `server/services/content/generation/sections.ts`.

#### What is preserved across rewrites
- Full version history via `contentVersion` rows.
- Diff stats computed post-update (`calculateDiffStats`).
- Prior versions remain in DB, but the update itself replaces the section body.

#### What gets sent when user clicks “rewrite”
- The section title, current section body, user instructions, tone prompt, frontmatter fields, and RAG chunks.
- No full-draft context or explicit “preserve phrasing” constraints.

### The Core Problem: Preservation vs. Change

#### Current prompt instructions about preserving original content
- No explicit preservation constraints.
- The prompt says “rewrite only this section content,” which does not prevent paraphrasing.

#### Few-shot examples
- None in the codebase for `edit_section`.

#### How the model is told what to change vs. preserve
- Only via the free-form `Author instructions` string.
- No structural constraints or diff-size limits are enforced.

#### What is the LLM’s goal on rewrite
- “Revise a single section using author instructions and contextual snippets.”
- No explicit specification to prefer reorganization over rewording.

### Original Transcript Integration

#### Where the original transcript lives
- Stored as `sourceContent` and chunked into embeddings for RAG.
- Not directly linked to rewrite operations unless chunks are retrieved.

#### Is transcript sent during rewrites
- Only indirectly via RAG chunks in `contextBlock`.
- No explicit label like “Original transcript” in the prompt.

#### How the system distinguishes “voice” vs filler/errors
- No logic for this in the current pipeline.

### Fact Injection & Research

#### Current way to add facts like “dishes ordered”
- Must be included in the user’s instruction text.
- There is no structured fact injection tool in the rewrite path.

#### Are facts injected as must-include constraints
- Not for section updates.
- “Must include” fields exist in conversation intent summaries for new generation, not section edits.

#### Structured data about the blog post topic
- Limited to frontmatter fields: title/description/tags/contentType/schemaTypes/primaryKeyword/targetLocale.
- No structured fields for restaurant, dishes, dates, etc.

### Specific Examples Needed
These are not available in the repo. Real examples would need to come from logs or user-provided samples.
- Bad rewrite examples (original, request, output).
- Repeated phrases origin (transcript vs hallucination).
- Specific wording/structure that should be preserved.

- `DATABASE_URL` is not set in the current environment, so no DB queries can be run to pull real examples.
- A specific email address alone is not enough without DB access to join `user` → `conversation` → `conversation_message`.
- Once DB access is available, the query path is:
  - `user.email` → `conversation.createdByUserId`
  - `conversation.id` → `conversation_message.conversationId`
  - optional `conversation_log` for tool history and rewrite metadata

### Desired Behavior Definition (for the refactor)
- “Rewrite” should map to targeted edit ops by default (replace/insert/delete around anchors).
- “Expand” and “reorganize” should be distinct actions with clear constraints.
- Word choice should remain unchanged unless explicitly requested.
- “Reorganizing” should allow sentence/paragraph reordering without paraphrasing.

## Edit-Ops Constraints (Decided)
- Default max-diff threshold: allow at most 12 changed lines or 8% of total lines (whichever is smaller). If the request exceeds this, return a clarification prompt or require an explicit “expand scope” request.
- Heading changes: disallowed by default. Allow only when the user explicitly requests a heading change and the request sets `allowHeadingChanges: true`.
- Scope restriction: default to the smallest containing paragraph or the smallest matched anchor block. Any multi-paragraph change requires explicit “expand”/“rewrite” language or a `scope: 'multi-paragraph'` override.
- Line-number anchors: supported as optional, but secondary to text anchors. If provided, validate they map to the current content version and do not broaden the scope beyond the allowed diff/paragraph limits.
