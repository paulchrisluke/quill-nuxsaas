<script setup lang="ts">
definePageMeta({
  layout: 'dashboard'
})

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const contentId = computed(() => route.params.id as string)
</script>

<template>
  <ChatDraftWorkspace
    :content-id="contentId"
    :organization-slug="slug"
  />
</template>
