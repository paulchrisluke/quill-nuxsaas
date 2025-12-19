<script setup lang="ts">
import WhatsNewRow from '~/components/WhatsNewRow.vue'

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Conversations')

useHead({
  title: 'Conversations'
})
</script>

<template>
  <div class="w-full h-full flex items-center justify-center">
    <div class="max-w-2xl mx-auto px-4 text-center space-y-6">
      <div class="space-y-2">
        <h1 class="text-3xl font-semibold">
          What would you like to write today?
        </h1>
        <p class="text-muted-foreground">
          Start a conversation in the chat panel to begin creating content.
        </p>
      </div>
      <WhatsNewRow />
    </div>
  </div>
</template>
