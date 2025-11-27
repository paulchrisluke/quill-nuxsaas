<script setup lang="ts">
import type { ChatMessage } from '#shared/utils/types'
import { useClipboard } from '@vueuse/core'

const props = withDefaults(defineProps<{
  messages: ChatMessage[]
}>(), {})

const emit = defineEmits<{ (e: 'regenerate', message: ChatMessage): void }>()

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const { copy } = useClipboard()
const toast = useToast()

function formatTimestamp(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return ''
  }
  return formatter.format(date)
}

function handleCopy(message: ChatMessage) {
  copy(message.content)
  toast.add({
    title: 'Copied to clipboard',
    description: 'Message copied successfully.',
    color: 'primary'
  })
}

function handleRegenerate(message: ChatMessage) {
  emit('regenerate', message)
}

function badgeLabels(payload: Record<string, any> | null | undefined) {
  const labels: string[] = []
  if (!payload) {
    return labels
  }
  if (payload.sourceContentId) {
    labels.push('Source link')
  }
  if (payload.sectionId) {
    labels.push('Section patch')
  }
  if (payload.type && typeof payload.type === 'string') {
    labels.push(payload.type.replace(/_/g, ' '))
  }
  return labels
}

function roleLabel(role: ChatMessage['role']) {
  return role === 'assistant' ? 'Quillio' : 'You'
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-for="message in messages"
      :key="message.id"
      class="rounded-2xl border border-muted-200/70 bg-background/90 p-4 shadow-sm"
      :class="message.role === 'assistant' ? 'border-primary/30' : ''"
    >
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-500">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold text-muted-800">
            {{ roleLabel(message.role) }}
          </span>
          <UBadge
            v-for="label in badgeLabels(message.payload)"
            :key="label"
            size="xs"
            color="primary"
            variant="soft"
            class="capitalize"
          >
            {{ label }}
          </UBadge>
        </div>
        <div class="flex items-center gap-2">
          <span>{{ formatTimestamp(message.createdAt) }}</span>
          <UDropdown
            :items="[[
              {
                label: 'Copy message',
                icon: 'i-lucide-copy',
                click: () => handleCopy(message)
              },
              message.role === 'user'
                ? {
                    label: 'Send again',
                    icon: 'i-lucide-rotate-ccw',
                    click: () => handleRegenerate(message)
                  }
                : null
            ].filter(Boolean) as any]"
          >
            <UButton
              variant="ghost"
              size="xs"
              icon="i-lucide-more-horizontal"
            />
          </UDropdown>
        </div>
      </div>

      <div class="mt-3 text-sm text-muted-800 whitespace-pre-line leading-relaxed">
        {{ message.content }}
      </div>
    </div>
  </div>
</template>
