<script setup lang="ts">
import AppNavbar from './components/AppNavbar.vue'

interface ChatLayoutHeroState {
  title: string
  contentType?: string | null
  updatedAtLabel?: string | null
  status?: string | null
  additions?: number
  deletions?: number
}

const i18nHead = useLocaleHead()
const chatHero = useState<ChatLayoutHeroState | null>('chat/layoutHero', () => null)

useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))
</script>

<template>
  <div class="min-h-screen flex flex-col bg-background">
    <AppNavbar>
      <template #center>
        <slot name="nav-center" />
        <div
          v-if="chatHero"
          class="hidden sm:flex flex-col"
        >
          <div class="text-xs uppercase tracking-wide text-muted-500">
            {{ chatHero.contentType || 'content' }} • {{ chatHero.status }}
          </div>
          <div class="flex items-center gap-3">
            <p class="text-sm font-semibold">
              {{ chatHero.title }}
            </p>
            <div class="flex items-center gap-2 text-xs text-muted-500">
              <span>{{ chatHero.updatedAtLabel }}</span>
              <span class="text-success-500 font-semibold">+{{ chatHero.additions ?? 0 }}</span>
              <span class="text-error-500 font-semibold">-{{ chatHero.deletions ?? 0 }}</span>
            </div>
          </div>
        </div>
      </template>
      <template #right>
        <UserNavigation />
        <slot name="nav-right" />
      </template>
    </AppNavbar>

    <main class="flex-1 w-full pt-14">
      <slot />
    </main>
  </div>
</template>
