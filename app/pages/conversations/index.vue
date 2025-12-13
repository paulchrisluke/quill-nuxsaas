<script setup lang="ts">
definePageMeta({
  auth: false, // Allow anonymous users
  renderChatWidget: false
})

const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', null)
setHeaderTitle?.('Conversations')

useHead({
  title: 'Conversations'
})
</script>

<template>
  <ConversationListLanding />
</template>
