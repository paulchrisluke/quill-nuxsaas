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

## Known Issues & Technical Debt

The following issues were identified in the scaffolded components and should be addressed during implementation:

### AgentProgressTracker.vue

1. **Set Reactivity Issue** (Lines 42-50, 56-62)
   - **Problem**: Direct mutations to `Set` may not trigger Vue reactivity
   - **Solution**: Use `reactive()` wrapper or replace `Set` with reactive array/object
   - **Impact**: Collapse/expand state may not update UI correctly
   - **Priority**: High - affects core functionality

2. **Toggle Logic with Global Collapse** (Lines 52-62)
   - **Problem**: `toggleStep()` doesn't account for `allCollapsed` state properly
   - **Solution**: When `allCollapsed` is true, individual toggles should override global state
   - **Impact**: Confusing UX when toggling individual steps while "Collapse all" is active
   - **Priority**: Medium - UX improvement

### AnalysisStep.vue

3. **Type Safety** (Lines 12-22)
   - **Problem**: `analysisData` is typed as `any` (implicitly from `step.result`)
   - **Solution**: Define proper interface for analysis result structure:
     ```typescript
     interface AnalysisResult {
       query?: string
       results?: number
       items?: Array<{ path: string; lines?: string }>
       content?: string
     }
     ```
   - **Impact**: Type safety and better IDE support
   - **Priority**: Medium - code quality

### FileDiffView.vue

4. **SSR & Security Concerns** (Lines 61-69)
   - **Problem**: `window.open()` is not SSR-safe and has security implications
   - **Solution**:
     - Use `process.client` check: `if (process.client) window.open(...)`
     - Or use Nuxt's `navigateTo()` with `external: true` option
     - Consider `rel="noopener noreferrer"` for security
   - **Impact**: SSR errors and potential security vulnerabilities
   - **Priority**: High - breaks SSR builds

### StepHeader.vue & ToolExecutionStep.vue

5. **Code Duplication** (StepHeader lines 16-28, ToolExecutionStep lines 11-23)
   - **Problem**: `toolDisplayNames` mapping is duplicated in both components
   - **Solution**: Extract to shared constant file (e.g., `constants/toolNames.ts`) or composable
   - **Impact**: Maintenance burden, potential inconsistencies
   - **Priority**: Low - refactoring opportunity

### ThinkingIndicator.vue

6. **Placeholder Text** (Lines 11-17)
   - **Problem**: "Calculating..." placeholder is not user-friendly
   - **Solution**:
     - Show "Thinking..." or "Processing..." while calculating
     - Or hide time display until calculation is complete
     - Implement actual timestamp-based calculation
   - **Impact**: Better UX during thinking phase
   - **Priority**: Low - UX polish

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

**Note**: The current `MessagePart` type in `shared/utils/types.ts` may need to be extended in Phase 2 to include:
- `thinkingContent?: string` - For thinking step content
- `fileEdits?: FileEdit[]` - Structured file diff data
- `thinkingDuration?: number` - Calculated thinking time in seconds
- `stepType?: 'file_edit' | 'analysis' | 'search' | 'tool_execution' | 'thinking'` - Explicit step type classification

These extensions will be added in Phase 2 after validating actual tool response structures.

### Step Type Detection

Determine step type from:
- `toolName` (e.g., `edit_section`, `read_content`, `source_ingest`)
- `result` structure (e.g., `result.fileEdits`, `result.analysis`)
- `args` content (e.g., `args.filePath`, `args.query`)

**Important**: Thinking steps are not separate from `tool_call` steps. A thinking step is a `tool_call` step where:
- The `toolName` indicates a thinking/analysis operation, OR
- The `result` contains thinking content, OR
- The step is in a "preparing" state and represents agent thinking time

All steps are `tool_call` type parts from the message - we classify them by their content and purpose.

### Step Numbering

Steps are numbered sequentially based on order in `message.parts` array:
- Filter parts to only `tool_call` types
- Number them 1, 2, 3, etc. (all `tool_call` parts, regardless of their step type classification)
- Maintain order even if some complete before others
- Thinking steps (if detected as separate) would be numbered alongside other tool calls in chronological order

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
  stepType?: 'file_edit' | 'analysis' | 'search' | 'tool_execution' | 'thinking'  // Detected step type
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

**Note**: The `stepType` field is computed/detected from `toolName` and `result` structure. It's optional in the interface to allow for cases where step type cannot be determined.

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

### Phase 1 (Can Proceed Without Full Answers)

For Phase 1 implementation, use these interim approaches:

1. **File Diff Data**:
   - **Interim**: Check `tool_call.result.fileEdits` or `tool_call.result` for file-related data
   - **Phase 2**: Validate actual tool response structure and extend types accordingly
   - **Action**: Inspect real tool responses during Phase 1 testing

2. **Thinking Time**:
   - **Interim**: Calculate from `timestamp` field if available, or use placeholder "Calculating..."
   - **Phase 2**: Implement proper duration tracking if timestamps are insufficient
   - **Action**: Test with real messages to see what timestamp data is available

3. **Step Grouping**:
   - **Interim**: Defer to Phase 3 - display steps in chronological order for now
   - **Phase 2**: Evaluate UX need for grouping after Phase 1 feedback
   - **Action**: No blocking action for Phase 1

4. **Real-time Updates**:
   - **Interim**: Steps update reactively as `message.parts` update (Vue reactivity)
   - **Phase 2**: Optimize if performance issues arise with many concurrent steps
   - **Action**: Test with real streaming data in Phase 1

### Phase 2+ (Requires Investigation)

These questions should be resolved before Phase 2 enhancements:
- Exact structure of file diff data in tool responses
- Best approach for thinking time calculation (timestamps vs. separate tracking)
- Whether step grouping is needed based on Phase 1 user feedback
- Performance implications of real-time updates with many steps

---

## References

- Existing component: `app/components/chat/AgentStatus.vue`
- State management: `app/composables/useConversation.ts`
- Message rendering: `app/components/chat/ChatMessageContent.vue`
- Types: `shared/utils/types.ts`

---

## Quick Reference: Known Issues Checklist

When implementing, ensure these issues are addressed:

- [ ] **AgentProgressTracker.vue** - Fix Set reactivity (HIGH)
- [ ] **AgentProgressTracker.vue** - Fix toggle logic with global collapse (MEDIUM)
- [ ] **FileDiffView.vue** - Fix SSR compatibility for window.open (HIGH)
- [ ] **AnalysisStep.vue** - Add proper type definition (MEDIUM)
- [ ] **StepHeader.vue & ToolExecutionStep.vue** - Extract shared constant (LOW)
- [ ] **ThinkingIndicator.vue** - Improve placeholder text (LOW)

See "Known Issues & Technical Debt" section above for detailed solutions.
