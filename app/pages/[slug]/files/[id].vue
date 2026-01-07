<script setup lang="ts">
import FileWorkspacePage from '~/components/file/FileWorkspacePage.vue'

const route = useRoute()

definePageMeta({
  ssr: false
})
</script>

<template>
  <FileWorkspacePage :key="route.params.id" />
</template>
