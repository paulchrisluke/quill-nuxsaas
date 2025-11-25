<script setup lang="ts">
import type { ChatActionSuggestion } from '~/shared/utils/types'
import { computed, ref } from 'vue'

const {
  messages,
  status,
  actions,
  errorMessage,
  generation,
  sendMessage,
  executeAction,
  isBusy
} = useChatSession()

const isPaletteOpen = ref(false)
const prompt = ref('')

const promptStatus = computed(() => {
  if (status.value === 'submitted' || status.value === 'streaming' || status.value === 'error') {
    return status.value as 'submitted' | 'streaming' | 'error'
  }
  return 'ready'
})

async function handleSubmit(prompt: string) {
  await sendMessage(prompt)
}

async function handlePromptSubmit() {
  const trimmed = prompt.value.trim()
  if (!trimmed) {
    return
  }
  await handleSubmit(trimmed)
  prompt.value = ''
}

async function handleAction(action: ChatActionSuggestion) {
  await executeAction(action)
}
</script>

<template>
  <div>
    <UContainer class="flex flex-col gap-6 py-10">
      <div class="space-y-2">
        <h1 class="text-3xl font-semibold">
          Chat Playground
        </h1>
        <p class="text-muted-foreground">
          Front-end preview of the upcoming Codex chat. Messages live only in local state for now.
        </p>
      </div>

      <UDashboardPanel>
        <template #body>
          <UContainer>
            <div class="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <h2 class="text-lg font-semibold">
                  Codex Chat
                </h2>
                <p class="text-sm text-muted-foreground">
                  Connected to your backend endpoint.
                </p>
              </div>
              <UButton
                icon="i-lucide-refresh-ccw"
                variant="ghost"
                :disabled="isBusy"
                @click="sendMessage('Hello Codex!')"
              >
                Send sample
              </UButton>
            </div>

            <div class="flex h-[60vh] flex-col gap-3">
              <div class="flex-1 overflow-y-auto rounded-lg border border-border px-2 py-4">
                <ChatMessagesList
                  :messages="messages"
                  :status="status"
                  class="h-full"
                />
              </div>

              <div v-if="errorMessage">
                <UAlert
                  color="error"
                  variant="soft"
                  icon="i-lucide-alert-triangle"
                  :description="errorMessage"
                />
              </div>

              <div
                v-if="actions.length"
                class="space-y-2"
              >
                <UAlert
                  title="Suggested actions"
                  description="Codex spotted something you can run."
                  icon="i-lucide-bolt"
                  variant="soft"
                />
                <div class="flex flex-wrap gap-2">
                  <UButton
                    v-for="action in actions"
                    :key="`${action.type}-${action.sourceContentId}`"
                    size="sm"
                    variant="outline"
                    icon="i-lucide-wand-sparkles"
                    :disabled="isBusy"
                    :loading="isBusy"
                    @click="handleAction(action)"
                  >
                    {{ action.label || 'Start a draft' }}
                  </UButton>
                </div>
              </div>

              <div v-if="generation">
                <UAlert
                  color="primary"
                  icon="i-lucide-file-text"
                  title="Draft ready"
                  description="Check the Content section to review the latest version."
                />
              </div>
            </div>
          </UContainer>
        </template>

        <template #footer>
          <UContainer class="pb-4 sm:pb-6">
            <UChatPrompt
              v-model="prompt"
              placeholder="Ask anything…"
              :disabled="isBusy"
              @submit="handlePromptSubmit"
            >
              <UChatPromptSubmit :status="promptStatus" />
            </UChatPrompt>
          </UContainer>
        </template>
      </UDashboardPanel>

      <div class="flex justify-end">
        <UButton
          icon="i-lucide-message-circle"
          variant="soft"
          label="Open Palette"
          @click="isPaletteOpen = true"
        />
      </div>

      <ClientOnly>
        <ChatPaletteShell
          :messages="messages"
          :status="status"
          :open="isPaletteOpen"
          :actions="actions"
          :disabled="isBusy"
          placeholder="Try the palette version…"
          @update:open="value => { isPaletteOpen = value }"
          @submit="handleSubmit"
          @action="handleAction"
        />
      </ClientOnly>
    </UContainer>
  </div>
</template>
