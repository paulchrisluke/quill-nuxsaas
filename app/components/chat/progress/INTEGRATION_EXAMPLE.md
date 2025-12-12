# Integration Example

## How to Use AgentProgressTracker

### Basic Usage in ChatMessageContent.vue

Replace or enhance the existing `AgentStatus` usage:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '#shared/utils/types'
import AgentStatus from './AgentStatus.vue'  // Keep for simple cases
import AgentProgressTracker from './progress/AgentProgressTracker.vue'  // New component

const props = defineProps<{
  message: ChatMessage
}>()

// Determine if we should use the new tracker or simple AgentStatus
const hasMultipleToolCalls = computed(() => {
  const toolCalls = props.message.parts.filter(p => p.type === 'tool_call')
  return toolCalls.length > 1
})

const hasSingleToolCall = computed(() => {
  const toolCalls = props.message.parts.filter(p => p.type === 'tool_call')
  return toolCalls.length === 1
})
</script>

<template>
  <div>
    <!-- Use new tracker for messages with multiple tool calls -->
    <AgentProgressTracker
      v-if="hasMultipleToolCalls"
      :message="message"
    />

    <!-- Use simple AgentStatus for single tool calls (backward compat) -->
    <template v-else-if="hasSingleToolCall">
      <AgentStatus
        v-for="(part, index) in message.parts"
        v-if="part.type === 'tool_call'"
        :key="index"
        :part="part"
      />
    </template>

    <!-- Text parts -->
    <p
      v-for="(part, index) in message.parts"
      v-else-if="part.type === 'text' && part.text.trim()"
      :key="index"
      class="whitespace-pre-line"
    >
      {{ part.text }}
    </p>
  </div>
</template>
```

### Using with currentActivity State

To show thinking indicator using the tracked state:

```vue
<script setup lang="ts">
import { useConversation } from '~/composables/useConversation'

const { currentActivity, currentToolName } = useConversation()
</script>

<template>
  <AgentProgressTracker
    :message="message"
    :current-activity="currentActivity"
    :current-tool-name="currentToolName"
  />
</template>
```

Note: You may need to extend `AgentProgressTracker` props to accept these.

---

## Migration Checklist

- [ ] Test with existing single tool call messages
- [ ] Test with messages containing multiple tool calls
- [ ] Verify backward compatibility with `AgentStatus.vue`
- [ ] Test collapse/expand functionality
- [ ] Verify real-time updates work
- [ ] Test error states
- [ ] Verify dark mode styling
- [ ] Test on mobile devices
