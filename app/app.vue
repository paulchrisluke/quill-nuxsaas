<script lang="ts" setup>
const { t } = useI18n()

useHead({
  titleTemplate: (title) => {
    if (title) {
      if (title.includes(t('global.appName'))) {
        return title
      } else {
        return `${title} | ${t('global.appName')}`
      }
    } else {
      return t('global.appName')
    }
  }
})
useSeoMeta({
  ogSiteName: t('global.appName')
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
