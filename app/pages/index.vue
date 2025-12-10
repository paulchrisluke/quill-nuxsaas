<script setup lang="ts">
definePageMeta({
  middleware: defineNuxtRouteMiddleware((_to) => {
    const localePath = useLocalePath()
    return navigateTo(localePath('/conversations'))
  })
})
</script>

<template>
  <div />
</template>
