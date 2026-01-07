<script setup lang="ts">
import ContentWorkspacePage from '~/components/content/ContentWorkspacePage.vue'

const route = useRoute()

definePageMeta({
  ssr: false
})
</script>

<template>
  <ContentWorkspacePage :key="route.params.id" />
</template>
