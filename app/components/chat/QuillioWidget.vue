<script setup lang="ts">
import { defineAsyncComponent, defineComponent, h } from 'vue'

const ChatShellError = defineComponent({
  name: 'ChatShellError',
  setup() {
    return () => h('div', { class: 'text-sm text-red-500' }, 'Failed to load chat. Please refresh.')
  }
})

const ChatShell = defineAsyncComponent({
  loader: () => import('./ChatShell.vue'),
  delay: 200,
  timeout: 10000,
  suspensible: true,
  errorComponent: ChatShellError,
  onError(error, retry, fail, attempts) {
    console.error('[ChatShell] Failed to load', error)
    if (attempts <= 2) {
      retry()
    } else {
      fail()
    }
  }
})
</script>

<template>
  <ClientOnly>
    <Suspense>
      <template #fallback>
        <div class="text-sm text-muted-foreground">
          Loading chat...
        </div>
      </template>
      <ChatShell />
    </Suspense>
  </ClientOnly>
</template>
