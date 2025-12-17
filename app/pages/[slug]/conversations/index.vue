<script setup lang="ts">
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Conversations')

useHead({
  title: 'Conversations'
})
</script>

<template>
  <div class="w-full h-full">
    <ClientOnly>
      <KeepAlive :max="5">
        <QuillioWidget />
      </KeepAlive>
    </ClientOnly>
  </div>
</template>
