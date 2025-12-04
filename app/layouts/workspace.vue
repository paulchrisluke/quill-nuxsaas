<script setup lang="ts">
import type { WorkspaceHeaderState } from '../components/chat/workspaceHeader'

const workspaceHeader = useState<WorkspaceHeaderState | null>('workspace/header', () => null)
const i18nHead = useLocaleHead()

useHead(() => ({
  link: [...(i18nHead.value.link || [])]
}))
</script>

<template>
  <div class="min-h-screen flex flex-col bg-background">
    <header class="sticky top-0 z-40 border-b border-muted-300/60 bg-background/80 backdrop-blur">
      <UContainer class="py-3 sm:py-4">
        <div
          v-if="workspaceHeader"
          class="flex flex-wrap items-center gap-3 sm:gap-4"
        >
          <div class="flex items-stretch gap-3 min-w-0 flex-1">
            <div class="flex items-center">
              <UButton
                v-if="workspaceHeader.showBackButton"
                icon="i-lucide-arrow-left"
                variant="ghost"
                size="sm"
                class="h-10 w-10 sm:h-12 sm:w-12 rounded-full"
                @click="workspaceHeader.onBack?.()"
              />
            </div>
            <div class="min-w-0 flex flex-col gap-1">
              <p class="text-base sm:text-lg font-semibold truncate">
                {{ workspaceHeader.title }}
              </p>
              <div class="hidden sm:flex text-sm text-muted-500 flex-wrap items-center gap-2">
                <span>{{ workspaceHeader.updatedAtLabel || '—' }}</span>
                <span>·</span>
                <span class="capitalize">{{ workspaceHeader.contentType || 'content' }}</span>
                <span>·</span>
                <span class="font-mono text-[11px] text-muted-600 dark:text-muted-300 break-all">
                  {{ workspaceHeader.versionId || '—' }}
                </span>
                <span>·</span>
                <span class="text-emerald-500 dark:text-emerald-400 font-semibold">+{{ workspaceHeader.additions ?? 0 }}</span>
                <span class="text-rose-500 dark:text-rose-400 font-semibold">-{{ workspaceHeader.deletions ?? 0 }}</span>
              </div>
            </div>
          </div>
          <div class="hidden sm:flex items-center gap-2">
            <UButton
              icon="i-lucide-archive"
              variant="ghost"
              size="sm"
              @click="workspaceHeader.onArchive?.()"
            >
              Archive
            </UButton>
            <UButton
              icon="i-lucide-share-2"
              variant="ghost"
              size="sm"
              @click="workspaceHeader.onShare?.()"
            >
              Share
            </UButton>
            <UButton
              :color="workspaceHeader.primaryActionColor"
              size="sm"
              :disabled="workspaceHeader.primaryActionDisabled"
              @click="workspaceHeader.onPrimaryAction?.()"
            >
              {{ workspaceHeader.primaryActionLabel }}
            </UButton>
          </div>
        </div>
      </UContainer>
    </header>

    <main class="flex-1 w-full pt-4 pb-4">
      <slot />
    </main>
  </div>
</template>
