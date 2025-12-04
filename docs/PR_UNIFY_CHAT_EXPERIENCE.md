# PR: Unify Chat Experience Across Home and Content Detail Pages

## Problem Statement

Currently, the chat experience is fragmented across two separate implementations:

1. **Home Page (`app/components/chat/QuillioWidget.vue`)**: Uses `useChatSession()` composable with global state for creating new drafts
2. **Content Detail Page (`app/components/chat/DraftWorkspace.vue`)**: Uses isolated local state and requires section selection before chatting

### Issues

- **No conversation continuity**: Messages don't carry over when navigating from home page to content detail page
- **Forced section selection**: Users must select a section before they can chat, breaking the natural flow
- **Duplicate state management**: Two different state systems (`useChatSession()` vs local `conversationMessages` ref)
- **Different API patterns**: Home uses general chat messages, content detail uses `patch_section` actions
- **Poor UX**: Unlike Cursor/Windsurf/Codex, users can't naturally reference sections with `@mentions` or give general instructions

### Current Architecture

```
Home Page (QuillioWidget)
├── Uses: useChatSession() composable
├── State: useState('chat/messages') - global shared state
├── API: /api/chat (general messages)
└── Creates draft → sets sessionContentId

Content Detail (DraftWorkspace)
├── Uses: Local conversationMessages ref (isolated)
├── State: Local ref, loads from /api/chat/workspace
├── API: /api/chat with patch_section actions
└── Requires: selectedSectionId before chatting
```

## Goals

1. **Unified Conversation State**: Single source of truth using `useChatSession()` across both pages
2. **Optional Section References**: Support `@section-name` mentions but don't require pre-selection
3. **Seamless Navigation**: Conversation history persists when moving between pages
4. **Natural Language Editing**: Allow general instructions like "make intro more engaging" without section selection
5. **Context-Aware Chat**: Automatically inject content sections as context when editing existing drafts
6. **Backward Compatible**: Maintain existing functionality while improving UX

## Proposed Solution

### Architecture Changes

1. **Unify State Management**
   - Make `DraftWorkspace` use `useChatSession()` instead of local state
   - Load existing messages from database into shared state when opening content
   - Sync shared state with database session

2. **Make Section Selection Optional**
   - Remove `selectedSectionId` requirement from chat input
   - Parse `@section-name` mentions in prompts
   - Let LLM determine which sections to edit based on natural language

3. **Unified API Usage**
   - Use same `/api/chat` endpoint for both contexts
   - Pass `contentId` in request body when editing existing content
   - Backend determines if it's new draft or edit based on `contentId`

4. **Smart Context Injection**
   - When `contentId` is present, automatically inject sections as context
   - Show sections in chat UI for reference (accordion), but don't require selection
   - Support `@section` mentions for explicit references

## File Changes

### Core Components

#### 1. `app/components/chat/DraftWorkspace.vue`
**Current Issues:**
- Line 170: Uses local `conversationMessages` ref instead of `useChatSession()`
- Line 166: Local `prompt` ref instead of shared state
- Line 171: Local `chatStatus` instead of shared status
- Line 556-615: `_handleSubmit()` uses isolated API call with `patch_section` action
- Line 802-819: Chat input disabled when `!selectedSectionId`

**Changes Needed:**
- Replace local state with `useChatSession()` composable
- Remove `selectedSectionId` requirement from chat input
- Update `_handleSubmit()` to use `sendMessage()` from composable
- Add section parsing logic for `@mentions`
- Make section accordion informational only (not required for selection)

#### 2. `app/composables/useChatSession.ts`
**Current State:**
- Line 95-105: Global state management
- Line 179-193: `sendMessage()` function for general chat
- Line 135-136: Sets `sessionContentId` from response

**Changes Needed:**
- Add `loadSessionForContent(contentId: string)` function to load existing messages
- Add `syncWithContent(contentId: string)` to sync state with database
- Enhance `sendMessage()` to accept optional `contentId` and section context
- Add section mention parsing helper

#### 3. `app/components/chat/QuillioWidget.vue`
**Current State:**
- Line 13-21: Uses `useChatSession()` correctly
- Line 402-410: Embeds `DraftWorkspace` when workspace is active

**Changes Needed:**
- Ensure `sessionContentId` is properly passed to `DraftWorkspace`
- Verify state continuity when opening workspace

### Server-Side Changes

#### 4. `server/api/chat/index.post.ts`
**Current State:**
- Line 140-142: Handles `initialSessionContentId` from action
- Line 147-155: Creates/finds session based on `contentId`
- Line 253-283: Separate `patch_section` action handler

**Changes Needed:**
- Enhance message parsing to detect `@section` mentions
- Automatically inject section context when `contentId` is present
- Make `patch_section` optional - infer from natural language if section mentioned
- Support both explicit actions and natural language instructions

#### 5. `server/api/chat/workspace.get.ts`
**Current State:**
- Line 32-34: Returns workspace payload with chat messages
- Line 33: Calls `getContentWorkspacePayload()`

**Changes Needed:**
- Ensure messages are returned in format compatible with `useChatSession()`
- Verify message normalization matches frontend expectations

#### 6. `server/services/content/generation.ts`
**Current State:**
- Contains `updateContentSectionWithAI()` for section patching

**Changes Needed:**
- Add function to parse section mentions from natural language
- Enhance to handle general content edits (not just section-specific)
- Support section inference from context

### Supporting Files

#### 7. `app/components/chat/DraftWorkspace.vue` - Section UI
**Current State:**
- Line 724-791: Sections accordion in chat messages
- Line 730-757: Section selection UI with "Set active" button
- Line 774-778: `@section` badge for inserting references

**Changes Needed:**
- Keep accordion for reference but remove "Set active" requirement
- Make `@section` badges clickable to insert mentions (optional)
- Add visual indicator that sections are available for reference
- Remove disabled state from chat input based on section selection

#### 8. `server/utils/chat.ts` (may need to create)
**New File:**
- Add `parseSectionMentions(message: string, sections: Section[]): string[]`
- Add `extractSectionReferences(message: string): string[]`
- Helper functions for section context injection

## Implementation Steps

### Phase 1: Unify State Management
1. ✅ Update `DraftWorkspace.vue` to use `useChatSession()` instead of local state
2. ✅ Add `loadSessionForContent()` to `useChatSession.ts`
3. ✅ Load existing messages when `DraftWorkspace` mounts with `contentId`
4. ✅ Sync state when navigating between pages

### Phase 2: Remove Section Selection Requirement
1. ✅ Remove `selectedSectionId` requirement from chat input in `DraftWorkspace.vue`
2. ✅ Update `_handleSubmit()` to work without required section
3. ✅ Make section accordion informational only
4. ✅ Keep `@section` mention insertion as optional feature

### Phase 3: Enhance Backend for Natural Language
1. ✅ Add section mention parsing to `/api/chat/index.post.ts`
2. ✅ Auto-inject section context when `contentId` is present
3. ✅ Support both explicit `patch_section` actions and natural language
4. ✅ Enhance `updateContentSectionWithAI()` to handle inferred sections

### Phase 4: Improve UX
1. ✅ Add visual indicators for available sections
2. ✅ Show section context in chat messages (keep accordion)
3. ✅ Add helper text about `@mentions` (optional)
4. ✅ Test conversation continuity across navigation

### Phase 5: Testing & Refinement
1. ✅ Test creating draft on home page → navigating to content detail
2. ✅ Test conversation history persistence
3. ✅ Test `@section` mentions
4. ✅ Test general instructions without section selection
5. ✅ Test backward compatibility with existing drafts

## Testing Checklist

- [ ] Create new draft on home page, verify messages appear
- [ ] Navigate to content detail page, verify same messages appear
- [ ] Send message on content detail without selecting section
- [ ] Use `@section-name` mention in prompt
- [ ] Give general instruction like "make intro more engaging"
- [ ] Verify sections are shown in chat for reference
- [ ] Test with existing drafts that have chat history
- [ ] Verify backward compatibility with `patch_section` actions
- [ ] Test error handling and edge cases

## Migration Notes

- Existing drafts with chat history will continue to work
- `patch_section` actions will still be supported for backward compatibility
- Section selection UI will remain but become optional
- No database schema changes required

## Success Criteria

1. ✅ Users can chat on content detail page without selecting a section first
2. ✅ Conversation history persists when navigating between pages
3. ✅ Users can reference sections with `@mentions` naturally
4. ✅ General instructions work without explicit section selection
5. ✅ Single unified state management system
6. ✅ Backward compatible with existing functionality

## Related Files Summary

**Frontend:**
- `app/components/chat/DraftWorkspace.vue` - Main refactor target
- `app/components/chat/QuillioWidget.vue` - Minor updates
- `app/composables/useChatSession.ts` - Add session loading functions

**Backend:**
- `server/api/chat/index.post.ts` - Enhance message handling
- `server/api/chat/workspace.get.ts` - Verify message format
- `server/services/content/generation.ts` - Enhance section handling
- `server/utils/chat.ts` - New file for parsing helpers

**Database:**
- No schema changes required
- Existing `content_chat_session` and `content_chat_message` tables are sufficient

