<script setup lang="ts">
const ChatShell = defineAsyncComponent(() => import('./ChatShell.vue'))
</script>

<template>
  <ClientOnly>
    <Suspense>
      <ChatShell />
    </Suspense>
  </ClientOnly>
</template>
