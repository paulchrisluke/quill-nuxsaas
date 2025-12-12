# Multi-Step Agent Progress Tracker - Implementation Guide

## Overview

This directory contains components for displaying detailed, multi-step progress tracking for agent operations. This provides a comprehensive view of tool execution, thinking time, file edits, and other agent activities during long-running processes.

## Current State Analysis

### Existing Components (Before This Implementation)

1. **`AgentStatus.vue`** (parent directory)
   - Shows individual tool call status (preparing/running/success/error)
   - Simple inline display per tool
   - Used in `ChatMessageContent.vue` for each `tool_call` part

2. **`UChatMessages`** (NuxtUI component)
   - Shows global conversation status via `:status` prop
   - Displays thinking/streaming indicator when `status === 'submitted'` or `'streaming'`
   - Used in `ChatConversationMessages.vue`

3. **Unused State** (`useConversation.ts`)
   - `currentActivity: 'thinking' | 'streaming' | null` - tracked but not displayed
   - `currentToolName: string | null` - tracked but not displayed

### Goal

Create a unified, multi-step progress tracker that:
- Consolidates tool status displays
- Shows numbered steps with detailed information
- Displays thinking time ("Thought for Xs")
- Shows file diffs and edits
- Provides collapse/expand functionality
- Works alongside existing `UChatMessages` global status

---

## Component Architecture

```
AgentProgressTracker.vue          ← Main container (replaces/enhances AgentStatus)
├── ProgressControls.vue          ← "Collapse all" / "Expand all" controls
└── ProgressStep.vue (multiple)   ← Individual step components
    ├── StepHeader.vue            ← Step number, icon, title, status
    └── StepContent.vue           ← Step-specific content
        ├── ThinkingIndicator.vue ← For thinking steps
        ├── FileDiffView.vue      ← For file edit steps
        ├── AnalysisStep.vue      ← For analysis/search steps
        └── ToolExecutionStep.vue ← For tool execution steps
```

---

## Implementation Steps

### Step 1: Create Base Components

1. **`StepHeader.vue`** - Reusable header component
   - Step number badge
   - Status icon (clock/spinner/check/x)
   - Step title/label
   - Collapse/expand toggle
   - Status badge (preparing/running/success/error)

2. **`ThinkingIndicator.vue`** - "Thought for Xs" display
   - Timer display
   - Expandable thinking content
   - Uses `currentActivity` state when available

3. **`StepContent.vue`** - Content wrapper
   - Handles different step types
   - Renders appropriate sub-component based on step type

### Step 2: Create Step-Specific Components

4. **`FileDiffView.vue`** - File edit display
   - Shows file path
   - Displays diff (+X -Y lines)
   - "Open diff" link (if applicable)
   - Error states

5. **`AnalysisStep.vue`** - Analysis/search steps
   - Shows what was analyzed/searched
   - Results count
   - Expandable details

6. **`ToolExecutionStep.vue`** - Tool execution display
   - Tool name and status
   - Progress messages
   - Result/error display
   - Can reuse/extend existing `AgentStatus.vue` logic

### Step 3: Create Main Components

7. **`ProgressStep.vue`** - Individual step container
   - Wraps `StepHeader` and `StepContent`
   - Handles collapse/expand state
   - Manages step-specific logic

8. **`ProgressControls.vue`** - Global controls
   - "Collapse all" / "Expand all" button
   - Optional: Filter by status

9. **`AgentProgressTracker.vue`** - Main container
   - Aggregates all tool calls from a message
   - Organizes them as numbered steps
   - Renders `ProgressControls` and multiple `ProgressStep` components
   - Handles step ordering and grouping

### Step 4: Integration

10. **Update `ChatMessageContent.vue`**
    - Replace or enhance `AgentStatus` usage
    - Use `AgentProgressTracker` for messages with multiple tool calls
    - Keep `AgentStatus` for simple single-tool cases (backward compat)

11. **Utilize `currentActivity` and `currentToolName`**
    - Display in `ThinkingIndicator.vue`
    - Show in step headers when available
    - Provide better UX during tool preparation

---

## Data Flow

### Input Data Structure

The components receive data from `ChatMessage.parts` where each part can be:

```typescript
type MessagePart =
  | { type: 'text', text: string }
  | {
      type: 'tool_call'
      toolCallId: string
      toolName: string
      status: 'preparing' | 'running' | 'success' | 'error'
      args?: Record<string, any>
      result?: any
      error?: string
      progressMessage?: string
      timestamp?: string
    }
```

### Step Type Detection

Determine step type from:
- `toolName` (e.g., `edit_section`, `read_content`, `source_ingest`)
- `result` structure (e.g., `result.fileEdits`, `result.analysis`)
- `args` content (e.g., `args.filePath`, `args.query`)

### Step Numbering

Steps are numbered sequentially based on order in `message.parts` array:
- Filter parts to only `tool_call` types
- Number them 1, 2, 3, etc.
- Maintain order even if some complete before others

---

## Component Props & Interfaces

### AgentProgressTracker.vue

```typescript
interface Props {
  message: ChatMessage  // The assistant message containing tool calls
  showControls?: boolean  // Show collapse/expand controls (default: true)
  defaultCollapsed?: boolean  // Start with all steps collapsed (default: false)
}
```

### ProgressStep.vue

```typescript
interface Step {
  stepNumber: number
  toolCallId: string
  toolName: string
  status: 'preparing' | 'running' | 'success' | 'error'
  args?: Record<string, any>
  result?: any
  error?: string
  progressMessage?: string
  timestamp?: string
}

interface Props {
  step: Step
  collapsed?: boolean  // Controlled collapse state
}
```

---

## Styling Guidelines

- Use existing design system tokens (muted colors, borders, etc.)
- Match `AgentStatus.vue` styling for consistency
- Use NuxtUI components (`UBadge`, `UIcon`, etc.) where possible
- Support dark mode (use `dark:` variants)
- Ensure responsive design (mobile-friendly)

---

## Testing Checklist

- [ ] Single tool call displays correctly
- [ ] Multiple tool calls show as numbered steps
- [ ] Collapse/expand works for individual steps
- [ ] "Collapse all" / "Expand all" works
- [ ] Thinking indicator shows when `currentActivity === 'thinking'`
- [ ] File diff displays correctly (if data available)
- [ ] Error states display properly
- [ ] Progress messages update in real-time
- [ ] Works with existing `UChatMessages` global status
- [ ] Backward compatible with simple `AgentStatus` usage

---

## Migration Path

### Phase 1: Build New Components (This PR)
- Create all component files with basic structure
- Implement basic step display
- Test with existing data structure

### Phase 2: Enhance Data Structure (Future PR)
- Extend `MessagePart` type to include more detailed step information
- Add file diff data to tool results
- Add thinking time tracking

### Phase 3: Full Integration (Future PR)
- Replace `AgentStatus` usage in `ChatMessageContent.vue`
- Utilize `currentActivity` and `currentToolName` state
- Add advanced features (filtering, search, etc.)

---

## Notes

- **Backward Compatibility**: Keep `AgentStatus.vue` for simple cases or until full migration
- **Performance**: Consider virtual scrolling if many steps
- **Accessibility**: Ensure keyboard navigation and screen reader support
- **Internationalization**: Use `useI18n()` for all user-facing text

---

## Questions to Resolve

1. **File Diff Data**: Where does file diff information come from? Is it in `tool_call.result`?
2. **Thinking Time**: How do we track "Thought for Xs"? Is it calculated from timestamps?
3. **Step Grouping**: Should related steps be grouped (e.g., all file edits together)?
4. **Real-time Updates**: How do we handle steps updating while others are still running?

---

## References

- Existing component: `app/components/chat/AgentStatus.vue`
- State management: `app/composables/useConversation.ts`
- Message rendering: `app/components/chat/ChatMessageContent.vue`
- Types: `shared/utils/types.ts`
