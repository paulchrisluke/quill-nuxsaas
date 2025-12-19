# References Feature Design Document

## 1. Current System Overview

### Content Model
- **Content Table**: Stores blog post metadata (id, slug, title, status, primaryKeyword, targetLocale, contentType, organizationId, currentVersionId)
- **ContentVersion Table**: Stores versioned content with:
  - `bodyMdx`: Full markdown/MDX content
  - `sections`: JSON array of structured sections (id, index, type, title, level, anchor, body, wordCount)
  - `frontmatter`: JSON metadata (title, description, slug, tags, keywords, schemaTypes, etc.)
  - `assets`: JSON metadata about associated assets
- **Sections**: Each section has a unique `id`, `title`, `body`, `type` (e.g., "introduction", "conclusion", "heading"), and `index` for ordering
- **Content can be referenced by**: UUID `id` or human-readable `slug`

### File Model
- **File Table**: Tracks uploaded files (id, originalName, fileName, mimeType, fileType, size, path, url, contentId, organizationId)
- **Storage**: Files stored in Cloudflare R2 via `FileService` with S3-compatible API
- **File Types**: Images, videos, audio, text files
- **Association**: Files can be linked to content via `contentId` (optional)
- **File Tree**: Organized in `files/` folder in workspace view

### LLM Integration
- **Chat API** (`/api/chat`): SSE streaming endpoint using agent pattern
- **Modes**:
  - `chat`: Read-only (read tools only)
  - `agent`: Read+write (full toolset)
- **Tools Available**:
  - Read: `read_content`, `read_section`, `read_source`, `read_content_list`, `read_source_list`, `read_workspace_summary`, `analyze_content_images`, `read_files`
  - Write: `content_write`, `edit_section`, `edit_metadata`, `insert_image`
  - Ingest: `source_ingest`
- **System Prompts**: Defined in `server/services/chat/agent.ts` with mode-specific instructions
- **Context Injection**: Currently done via:
  - System prompt context blocks
  - Tool results added to conversation history
  - Workspace summary messages
- **No explicit reference system**: AI must infer file/content from natural language

### UI Layout
- **ChatShell Component**: Main chat interface with `PromptComposer`
- **WorkspaceFileTree**: Shows hierarchical view:
  - `content/` folder with blog posts (by slug)
  - `files/` folder with uploaded files
  - `sources/` folder with source content (YouTube, context)
- **ContentWorkspacePage**: Displays content details, markdown, frontmatter, sections
- **No @ mention UI**: Users must describe files/content in natural language

---

## 2. What "References" Are

**References** are explicit, scoped context markers that allow blog writers to attach specific files, content sections, or entire blog posts to their LLM chat messages using `@` syntax. Unlike natural language descriptions (e.g., "the image I uploaded"), references resolve to concrete entities in the workspace and inject their content directly into the LLM's context window.

This system is optimized for **blog writers** (not programmers), so the syntax is forgiving and writer-friendly. References serve three primary functions:

1. **Explicit Context Injection**: When a user types `@image.jpg`, the system resolves the file, loads its metadata/content, and injects it into the prompt context before sending to the LLM. This prevents hallucinations and ensures the AI has exact information about what the user is referencing.

2. **Scoped Edit Permissions**: References define what the AI is allowed to modify. If a user says "Edit @content.md to include more SEO keywords", the system knows to only modify that specific content item, not other files in the workspace.

3. **Visual Feedback**: The UI shows resolved references as chips/badges, giving writers confidence that the AI understands what they're referencing before they send the message.

---

## 3. Reference Types & Syntax

### A) What Can Be Referenced

#### Files
- **Syntax**: `@filename.ext` or `@original-name.jpg`
- **Examples**: `@recipe-photo.jpg`, `@transcript.txt`, `@manual.pdf`
- **Resolution**: Match by `fileName` or `originalName` (case-insensitive, partial match supported)
- **Priority**: Exact match > partial match > most recently updated

#### Content (Blog Posts)
- **Syntax**: `@slug` or `@content-slug`
- **Examples**: `@classic-gingerbread-cookies`, `@cozy-christmas-recipes`
- **Resolution**: Match by `slug` field (case-insensitive)
- **Alternative**: `@content:slug` for explicit content type

#### Sections
- **Syntax**: `@content-slug#section-id` or `@content-slug:introduction`
- **Examples**:
  - `@my-post#intro-section-1` (by section ID)
  - `@my-post:introduction` (by section title, case-insensitive)
  - `@my-post:conclusion`
- **Resolution**: First resolve content by slug, then find section by `id` or `title`
- **Fallback**: If section not found, reference the entire content

#### Images (Special File Type)
- **Syntax**: `@image.jpg` or `@photo.png`
- **Resolution**: Same as files, but filtered to `fileType === 'image'`
- **Use Case**: "Add @image.jpg as the featured image above the conclusion"

#### Source Content
- **Syntax**: `@source:youtube` or `@source:context`
- **Examples**: `@source:youtube-video-123`, `@source:manual-transcript`
- **Resolution**: Match by `sourceType` and title/ID from `sourceContent` table

### B) Reference Syntax Rules

**Basic Format**: `@[identifier][#section][:modifier]`

- **Identifier**: File name, slug, or source identifier
- **Section Anchor** (optional): `#section-id` or `:section-title` for content sections
- **Modifier** (optional): `:introduction`, `:conclusion`, `:featured-image`

**Forgiving Matching**:
- Case-insensitive matching
- Partial matching (e.g., `@ginger` matches `classic-gingerbread-cookies`)
- Whitespace normalization (e.g., `@my post` matches `my-post`)
- Extension optional for files (e.g., `@image` matches `image.jpg`)

**Ambiguity Resolution**:
1. **Current Context**: If user is viewing a content page, `@content.md` prioritizes that content's files
2. **Same Folder**: Files in the same workspace folder as current content
3. **Global**: Search entire organization workspace
4. **Recency**: Most recently updated file if multiple matches

**Error Handling**:
- Unresolved references show as error chips: `@unknown-file (not found)`
- Partial matches suggest alternatives: `@image (did you mean: image-1.jpg, image-2.png?)`
- Multiple matches show selection UI before sending

### C) Reference Types (Permission Model)

#### READ References
- **Syntax**: Default (no modifier)
- **Behavior**: AI can read the referenced content but cannot modify it
- **Use Case**: "Summarize @youtube-transcript" or "What keywords are in @content.md?"

#### WRITE References
- **Syntax**: Implicit when user says "edit", "update", "modify", "rewrite"
- **Behavior**: AI can modify the referenced content
- **Guardrails**: Only the referenced content can be modified; other files are read-only
- **Use Case**: "Edit @content.md to include more SEO keywords"

#### INSERT References
- **Syntax**: Implicit when user says "add", "insert", "place"
- **Behavior**: AI can add content relative to the reference (e.g., insert image into content, add section)
- **Use Case**: "Add @image.jpg as the featured image above the conclusion in @my-post"

---

## 4. Context Injection Design

### How References Become Model Context

**Pre-Processing Pipeline**:
1. **Parse User Message**: Extract all `@references` from the message text
2. **Resolve References**: For each reference, query database/filesystem to find matching entity
3. **Load Content**: Fetch full content for each resolved reference:
   - Files: Load metadata (name, type, size, url) + content if text file
   - Content: Load current version with sections, frontmatter, bodyMdx
   - Sections: Load parent content + specific section body
4. **Build Context Block**: Assemble resolved references into structured context
5. **Inject into Prompt**: Add context block to system message or user message

### Context Block Format

```
**Referenced Context:**

[File: image.jpg]
Type: image
Size: 2.4 MB
URL: https://...
Description: Uploaded on 2024-01-15

[Content: classic-gingerbread-cookies]
Title: Classic Gingerbread Cookies for a Cozy Christmas
Slug: classic-gingerbread-cookies
Status: draft
Sections:
  - Introduction (id: intro-1)
  - Ingredients (id: ingredients-1)
  - Instructions (id: instructions-1)
  - Conclusion (id: conclusion-1)

[Section: classic-gingerbread-cookies#conclusion]
Title: Conclusion
Body: [Full section markdown content...]
```

### Injection Strategy

**System Message Injection** (Preferred):
- Add resolved references to system prompt as structured context
- Format: "The user has referenced the following entities: [context block]"
- Benefits: Clear separation, doesn't pollute user message, easier to parse

**User Message Enhancement** (Fallback):
- Append context block to user message if system message is too long
- Format: Original message + "\n\n[Referenced Context: ...]"

### Scope Limits & Hallucination Prevention

**Explicit Scoping**:
- System prompt explicitly states: "You can ONLY modify content referenced with @ mentions. All other content is read-only."
- Tool calls are validated: `edit_section` can only be called with `contentId` that was referenced
- File writes are blocked unless the file was explicitly referenced

**Context Window Management**:
- Large files (>50KB text): Summarize instead of full content
- Large content (>10 sections): Include section summaries + full body for referenced sections only
- Images: Include metadata + alt text, not binary data
- Multiple references: Limit to 5 references per message to prevent context overflow

### Multiple References Handling

**Ordering**:
- References are processed in order of appearance in the message
- Context blocks are ordered: Files first, then Content, then Sections

**Conflicting Instructions**:
- If user references multiple content items with conflicting edits, AI should ask for clarification
- Example: "Edit @post1 and @post2 to say X" → "I can only edit one content item at a time. Which should I modify?"

**Chunking Strategy**:
- If total context exceeds model limits, prioritize:
  1. Referenced sections (full content)
  2. Referenced content metadata + referenced sections only
  3. Referenced file metadata + summaries
  4. Non-referenced context (workspace summary) is excluded if space is tight

---

## 5. UX Behavior Spec

### Autocomplete Behavior

**Trigger**: User types `@` in `PromptComposer`

**Autocomplete Dropdown**:
- **Sections**:
  - "Files" (collapsible)
    - Recent files (last 10)
    - All files (searchable)
  - "Content" (collapsible)
    - Recent content (last 10)
    - All content (searchable)
  - "Sections" (collapsible, only if content is open)
    - Sections from current content
    - Sections from recent content

**Search Behavior**:
- As user types after `@`, filter results in real-time
- Show: Name, type icon, preview snippet, last modified
- Highlight matching text

**Keyboard Navigation**:
- `↑/↓`: Navigate options
- `Enter/Tab`: Select and insert
- `Esc`: Close dropdown
- `@` again: Cycle through reference types

**Insertion Format**:
- Insert full reference: `@filename.jpg` or `@content-slug#section-id`
- Replace `@` trigger with selected reference

### Inline Preview

**Hover Behavior**:
- When user hovers over a resolved reference chip, show tooltip:
  - **File**: Thumbnail (if image), name, size, type, upload date
  - **Content**: Title, slug, status, section count, last modified
  - **Section**: Parent content title, section title, word count, preview (first 100 chars)

**Selection Behavior**:
- Clicking a reference chip opens a preview panel (right side or modal)
- Preview shows full content/metadata
- "Open in workspace" button to navigate to the entity

### Visual Chips/Badges

**Resolved References**:
- Display as chips above or below the input (or inline if space allows)
- Format: `[Icon] filename.jpg` or `[Icon] content-slug`
- Color: Primary color, subtle background
- Clickable: Opens preview
- Removable: X button to remove reference before sending

**Unresolved References**:
- Format: `[⚠️] @unknown-file (not found)`
- Color: Warning/error color
- Clickable: Opens resolution dialog with suggestions

**Multiple Matches**:
- Format: `[?] @image (3 matches - click to choose)`
- Clickable: Opens selection dialog with all matches

**Reference Type Indicators**:
- File: File icon
- Content: Document icon
- Section: Section/heading icon
- Image: Image icon (special file type)

### Error States

**Unresolved Reference**:
- Show error chip: `@unknown-file (not found)`
- Suggest similar matches: "Did you mean: image-1.jpg, image-2.png?"
- Allow user to select from suggestions or remove reference

**Permission Issue**:
- Show warning: `@content-slug (read-only in chat mode)`
- Suggest: "Switch to agent mode to edit this content"

**Deleted File**:
- Show error: `@deleted-file.jpg (file was deleted)`
- Option to remove reference

### Pre-Send Confirmation

**Reference Summary Panel** (Optional, can be toggled):
- Shows all resolved references before sending
- Lists what will be read vs. what will be modified
- "Send" button confirms user understands scope

**Visual Indicators**:
- Green checkmark: Reference resolved
- Yellow warning: Multiple matches (user should verify)
- Red error: Unresolved or permission issue (blocks send)

---

## 6. Safety & Permission Model

### Edit Constraints

**Explicit Reference Requirement**:
- In agent mode, write operations (`edit_section`, `edit_metadata`, `content_write`) can only target content that was explicitly referenced
- System prompt: "You can ONLY modify content that was referenced with @ mentions in the user's message. All other content is read-only."

**Tool Call Validation**:
- Before executing `edit_section`, validate that `contentId` matches a referenced content
- Before executing `insert_image`, validate that `fileId` matches a referenced file
- Reject tool calls that target non-referenced entities with error: "Cannot modify [entity] - it was not referenced in the user's message."

**Read-Only Mode Enforcement**:
- Chat mode: All references are read-only, even if user says "edit"
- System prompt in chat mode: "All references are read-only. You can inspect them but cannot modify them."

### Destructive Edit Preview

**Change Summary** (Before applying edits):
- Show diff preview: What will be added/deleted
- For section edits: Show old vs. new section body
- For metadata edits: Show old vs. new values
- User confirmation: "Apply these changes?" (can be auto-approved for non-destructive edits)

**Versioning**:
- All edits create new `ContentVersion` (existing behavior)
- Reference-based edits are logged in version metadata: `{ editedViaReference: true, reference: '@content-slug' }`
- Users can rollback to previous versions

### Audit Trail

**Logging**:
- Log all reference resolutions: `reference_resolved` event with entity ID, reference string, resolution method
- Log all reference-based edits: `edit_via_reference` event with reference, contentId, changes
- Store in `conversation_log` table with type `reference_action`

**Metadata**:
- Store resolved references in message `payload`: `{ references: [{ type: 'file', id: '...', reference: '@image.jpg' }] }`
- This allows reconstructing what was referenced in historical conversations

### Rollback/Versioning

**Existing System**:
- Content versions are already versioned (each edit creates new version)
- Users can view version history and rollback

**Reference-Aware Rollback**:
- When rolling back, show which references were used in that version
- Allow users to see: "This version was edited via @content-slug reference"

**File Deletion Protection**:
- If a referenced file is deleted, mark reference as invalid but don't break conversation history
- Show warning: "Referenced file was deleted" but allow viewing historical context

---

## 7. Step-by-Step Implementation Plan

### Phase 1: Backend - Reference Parser & Resolver

#### 1.1 Reference Parser Service
**File**: `server/services/chat/references/parser.ts`

**Functions**:
- `parseReferences(message: string): ReferenceToken[]`
  - Regex: `/@([\w\-\.#:]+)/g`
  - Extract all `@` mentions
  - Return array of `ReferenceToken` objects

**Types**:
```typescript
interface ReferenceToken {
  raw: string  // "@image.jpg"
  identifier: string  // "image.jpg"
  sectionAnchor?: string  // "#section-id" or ":section-title"
  type?: 'file' | 'content' | 'section' | 'source'
}
```

#### 1.2 Reference Resolver Service
**File**: `server/services/chat/references/resolver.ts`

**Functions**:
- `resolveReference(token: ReferenceToken, context: ResolverContext): Promise<ResolvedReference | null>`
  - Context includes: `organizationId`, `currentContentId`, `userId`
  - Try file match first, then content match, then section match
  - Return `ResolvedReference` with entity ID and metadata

**Types**:
```typescript
interface ResolvedReference {
  type: 'file' | 'content' | 'section'
  id: string
  metadata: {
    name: string
    // ... entity-specific metadata
  }
  content?: string  // For files/sections, the actual content
}
```

#### 1.3 Reference Content Loader
**File**: `server/services/chat/references/loader.ts`

**Functions**:
- `loadReferenceContent(reference: ResolvedReference, db: DB): Promise<ReferenceContent>`
  - For files: Load metadata + content if text file
  - For content: Load current version with sections
  - For sections: Load parent content + specific section
  - Return structured content for injection

#### 1.4 Context Builder
**File**: `server/services/chat/references/contextBuilder.ts`

**Functions**:
- `buildContextBlock(references: ReferenceContent[]): string`
  - Format references into markdown context block
  - Handle chunking for large content
  - Return formatted string for system prompt

### Phase 2: Backend - Prompt Integration

#### 2.1 Chat API Integration
**File**: `server/api/chat/index.post.ts`

**Changes**:
- In request handler, before calling agent:
  1. Parse references from `message`
  2. Resolve all references
  3. Load reference content
  4. Build context block
  5. Pass context block to agent system prompt

**Code Location**: After `validateRequestBody`, before `runChatAgentWithMultiPassStream`

#### 2.2 Agent System Prompt Enhancement
**File**: `server/services/chat/agent.ts`

**Changes**:
- Modify `buildSystemPrompt` to accept `referenceContext?: string`
- Append reference context to system prompt if provided
- Add explicit instruction: "You can ONLY modify content referenced with @ mentions"

#### 2.3 Tool Execution Validation
**File**: `server/api/chat/index.post.ts` (in `executeChatTool`)

**Changes**:
- Before executing write tools, validate that target entity was referenced
- Store resolved references in request context
- Check `contentId`/`fileId` against referenced entities
- Reject with error if not referenced

### Phase 3: Frontend - Autocomplete Component

#### 3.1 Reference Autocomplete Component
**File**: `app/components/chat/ReferenceAutocomplete.vue`

**Features**:
- Dropdown triggered by `@` in input
- Search files, content, sections
- Keyboard navigation
- Insert reference on selection

**Props**:
- `modelValue: string` (input text)
- `contentId?: string` (current content context)
- `organizationId: string`

**Events**:
- `@update:modelValue` (updated text with reference inserted)

#### 3.2 Reference Data Fetcher
**File**: `app/composables/useReferenceSearch.ts`

**Functions**:
- `searchFiles(query: string): Promise<FileRecord[]>`
- `searchContent(query: string): Promise<ContentItem[]>`
- `searchSections(contentId: string, query: string): Promise<Section[]>`

**Uses**: Existing `useFileList` and `useContentList` composables

#### 3.3 PromptComposer Integration
**File**: `app/components/chat/PromptComposer.vue`

**Changes**:
- Integrate `ReferenceAutocomplete` component
- Handle `@` keypress to show autocomplete
- Insert selected reference into input
- Show reference chips above input

### Phase 4: Frontend - Reference Chips & Preview

#### 4.1 Reference Chip Component
**File**: `app/components/chat/ReferenceChip.vue`

**Features**:
- Display resolved reference with icon
- Show error state for unresolved references
- Click to open preview
- X button to remove

**Props**:
- `reference: ResolvedReference`
- `status: 'resolved' | 'unresolved' | 'error'`

#### 4.2 Reference Preview Panel
**File**: `app/components/chat/ReferencePreview.vue`

**Features**:
- Show full content/metadata for reference
- "Open in workspace" button
- Close button

**Props**:
- `reference: ResolvedReference`

#### 4.3 Reference Parser (Client-Side)
**File**: `app/utils/references.ts`

**Functions**:
- `parseReferences(message: string): ReferenceToken[]` (same as backend)
- `formatReference(token: ReferenceToken): string`

**Purpose**: Client-side parsing for UI display before sending

### Phase 5: Frontend - Pre-Send Validation

#### 5.1 Reference Resolution Service
**File**: `app/composables/useReferenceResolution.ts`

**Functions**:
- `resolveReferences(tokens: ReferenceToken[]): Promise<ResolvedReference[]>`
  - Call API endpoint to resolve references
  - Return resolved references with status

**API Endpoint**: `POST /api/chat/resolve-references`
- Accepts: `{ references: ReferenceToken[], organizationId: string, contentId?: string }`
- Returns: `{ resolved: ResolvedReference[], unresolved: ReferenceToken[] }`

#### 5.2 Pre-Send Validation
**File**: `app/components/chat/ChatShell.vue`

**Changes**:
- Before calling `sendMessage`, resolve all references
- Show unresolved references as error chips
- Block send if critical references are unresolved (or show warning)
- Show reference summary panel (optional)

### Phase 6: Backend - Reference API Endpoint

#### 6.1 Resolve References Endpoint
**File**: `server/api/chat/resolve-references.post.ts`

**Functions**:
- Accept reference tokens from client
- Resolve each reference using resolver service
- Return resolved + unresolved references
- Include suggestions for unresolved references

### Phase 7: Testing & Edge Cases

#### 7.1 Unit Tests
- Reference parser (various formats)
- Reference resolver (exact match, partial match, ambiguity)
- Context builder (chunking, formatting)

#### 7.2 Integration Tests
- End-to-end: User types `@reference`, sends message, AI receives context
- Tool validation: Verify write tools reject non-referenced entities
- Error handling: Unresolved references, deleted files, permission issues

#### 7.3 Edge Cases
- Multiple references with same name
- References to deleted files/content
- Very long reference content (chunking)
- Special characters in file names
- References in conversation history (should they be re-resolved?)

---

## 8. Open Questions / Assumptions

### Assumptions
1. **Reference Resolution is Synchronous**: We assume references can be resolved before sending the message. If resolution is slow, we may need async resolution with progress indicators.

2. **Context Window Limits**: We assume the LLM context window can handle 5-10 references. If not, we'll need more aggressive summarization.

3. **File Content Loading**: We assume text files can be loaded into memory. For very large files (>1MB), we may need to summarize instead of loading full content.

4. **Section References Require Content Context**: We assume users will reference sections from content they're currently viewing, or we'll need a way to search sections across all content.

5. **Reference Persistence**: We assume references are resolved fresh on each message. We don't cache resolved references across messages (to handle deleted files, etc.).

### Open Questions

1. **Reference Caching**: Should we cache resolved references within a conversation to avoid re-resolving `@image.jpg` multiple times? Or always resolve fresh?

2. **Reference History**: Should we show a history of recently used references in autocomplete? (e.g., "Recently referenced: @image.jpg, @my-post")

3. **Reference Aliases**: Should users be able to create aliases? (e.g., `@featured` → `@image-123.jpg`)

4. **Reference Groups**: Should we support referencing multiple files at once? (e.g., `@images/*` or `@all-images`)

5. **Reference in Tool Results**: When the AI returns tool results that mention files/content, should we automatically create references for those? (e.g., "I've updated @content.md" → auto-reference)

6. **Reference Permissions**: Should references respect file/content permissions? (e.g., if user can't read a file, should reference fail?)

7. **Reference in Edit Instructions**: If user says "Edit @content.md: make the introduction longer", should `:introduction` be parsed as a section reference or part of the instruction?

8. **Reference Validation Timing**: Should we validate references on the client (before send) or server (after send)? Client validation gives better UX but requires API call.

9. **Reference in Streaming Responses**: If AI mentions a reference in its response (e.g., "I've updated @content.md"), should we auto-resolve and show as a chip in the UI?

10. **Reference Scope in Multi-Content Workspaces**: If a workspace has 100+ content items, should reference search be scoped to recent/relevant content, or search all?

### Recommendations

1. **Start Simple**: Implement basic file and content references first, add sections later
2. **Client-Side Resolution**: Resolve references on client before send for better UX (show errors immediately)
3. **No Caching Initially**: Always resolve fresh to avoid stale references
4. **Aggressive Summarization**: For large content, always summarize non-referenced sections
5. **Explicit Section Syntax**: Use `#section-id` for sections to avoid ambiguity with instructions

---

## Appendix: Data Structures

### ReferenceToken
```typescript
interface ReferenceToken {
  raw: string  // "@image.jpg"
  identifier: string  // "image.jpg"
  sectionAnchor?: string  // "#section-id" or ":section-title"
  startIndex: number  // Position in original message
  endIndex: number
}
```

### ResolvedReference
```typescript
interface ResolvedReference {
  type: 'file' | 'content' | 'section'
  id: string  // Entity UUID
  token: ReferenceToken  // Original token
  metadata: {
    name: string
    // Type-specific metadata
  }
  content?: string  // Loaded content (for injection)
  permission: 'read' | 'write'  // Based on mode and user intent
}
```

### ReferenceContent (for context injection)
```typescript
interface ReferenceContent {
  type: 'file' | 'content' | 'section'
  id: string
  name: string
  summary?: string  // For large content
  fullContent?: string  // For small content or referenced sections
  metadata: Record<string, any>
}
```
