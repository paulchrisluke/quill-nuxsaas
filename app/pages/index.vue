<script setup lang="ts">
import QuillioWidget from '~/components/chat/QuillioWidget.vue'

definePageMeta({
  auth: false
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
