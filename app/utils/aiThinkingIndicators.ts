export interface AiThinkingLogEntry {
  type?: string | null
  message?: string | null
  createdAt?: string | Date | null
}

interface IndicatorPreset {
  label: string
  message: string
}

const PRESETS = {
  thinking: {
    label: 'Thinking',
    message: 'Thinking...'
  },
  generating: {
    label: 'Generating',
    message: 'Generating response...'
  }
} as const satisfies Record<string, IndicatorPreset>

export function resolveAiThinkingIndicator(input: {
  status?: string | null
  logs?: AiThinkingLogEntry[] | null
  fallbackMessage?: string
  activeSince?: Date | string | number | null
  currentActivity?: 'llm_thinking' | 'tool_executing' | 'streaming_message' | null
  currentToolName?: string | null
}): IndicatorPreset {
  // Priority 1: Use currentActivity state (most accurate for streaming)
  if (input.currentActivity === 'streaming_message') {
    return PRESETS.generating
  }

  if (input.currentActivity === 'llm_thinking' || input.currentActivity === 'tool_executing') {
    return PRESETS.thinking
  }

  // Priority 2: Use status
  const status = (input.status || '').toLowerCase()
  if (status === 'streaming') {
    return PRESETS.generating
  }

  if (status === 'submitted') {
    return PRESETS.thinking
  }

  // Fallback
  if (input.fallbackMessage) {
    return {
      label: 'Working',
      message: input.fallbackMessage
    }
  }

  return PRESETS.thinking
}
