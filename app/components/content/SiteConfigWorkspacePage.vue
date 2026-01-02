<script setup lang="ts">
import { nextTick } from 'vue'
import { getSiteConfigFromMetadata, mergeSiteConfigIntoMetadata, normalizeSiteConfig } from '~~/shared/utils/siteConfig'

const { organization, useActiveOrganization, refreshActiveOrg, user } = useAuth()
const activeOrg = useActiveOrganization()
const runtimeConfig = useRuntimeConfig()
const toast = useToast()

const isSaving = ref(false)
const isHydrating = ref(false)
const isDirty = ref(false)
const fieldProps = { orientation: 'vertical' as const, class: 'w-full' }

const formState = reactive({
  publisher: {
    name: '',
    url: '',
    logoUrl: '',
    sameAsInput: ''
  },
  author: {
    name: '',
    url: '',
    image: '',
    sameAsInput: ''
  },
  blog: {
    name: '',
    url: ''
  },
  categories: [] as Array<{ name: string, slug: string }>
})

const warningMessages = computed(() => {
  const warnings: string[] = []

  const publisherHasFields = Boolean(
    formState.publisher.url
    || formState.publisher.logoUrl
    || formState.publisher.sameAsInput.trim()
  )
  if (publisherHasFields && !formState.publisher.name.trim()) {
    warnings.push('Publisher name is missing.')
  }

  const authorHasFields = Boolean(
    formState.author.url
    || formState.author.image
    || formState.author.sameAsInput.trim()
  )
  if (authorHasFields && !formState.author.name.trim()) {
    warnings.push('Author name is missing.')
  }

  if (formState.blog.url.trim() && !formState.blog.name.trim()) {
    warnings.push('Blog section name is missing.')
  }

  const hasCategories = formState.categories.some(entry => entry.name.trim())
  if (hasCategories && !formState.blog.url.trim()) {
    warnings.push('Add a blog URL to auto-fill breadcrumbs for categories.')
  }

  return warnings
})

const metadataValue = computed(() => activeOrg.value?.data?.metadata ?? null)

const buildDefaults = () => {
  const org = activeOrg.value?.data
  const defaults: Record<string, any> = {}
  const baseUrl = runtimeConfig.public.baseURL || ''
  if (org?.name) {
    defaults.publisher = {
      name: org.name,
      url: org.slug && baseUrl ? `${baseUrl.replace(/\/+$/, '')}/${org.slug}` : undefined,
      logoUrl: org.logo ?? undefined
    }
  }
  if (user.value?.name) {
    defaults.author = {
      name: user.value.name,
      image: user.value.image ?? undefined
    }
  }
  return defaults
}

const normalizeSameAs = (value: string) => {
  const items = value
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
  return items.length ? items : undefined
}

const normalizeSlug = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const loadFromOrganization = () => {
  const siteConfig = getSiteConfigFromMetadata(metadataValue.value)
  const defaults = buildDefaults()
  const merged = normalizeSiteConfig({
    ...defaults,
    ...siteConfig,
    publisher: {
      ...(defaults.publisher || {}),
      ...(siteConfig.publisher || {})
    },
    author: {
      ...(defaults.author || {}),
      ...(siteConfig.author || {})
    }
  })

  isHydrating.value = true
  const publisher = { ...(merged.publisher || {}) }
  if (!publisher.name && defaults.publisher?.name) {
    publisher.name = defaults.publisher.name
  }
  if (!publisher.url && defaults.publisher?.url) {
    publisher.url = defaults.publisher.url
  }
  if (!publisher.logoUrl && defaults.publisher?.logoUrl) {
    publisher.logoUrl = defaults.publisher.logoUrl
  }

  const author = { ...(merged.author || {}) }
  if (!author.name && defaults.author?.name) {
    author.name = defaults.author.name
  }
  if (!author.image && defaults.author?.image) {
    author.image = defaults.author.image
  }

  formState.publisher.name = publisher.name ?? ''
  formState.publisher.url = publisher.url ?? ''
  formState.publisher.logoUrl = publisher.logoUrl ?? ''
  formState.publisher.sameAsInput = (publisher.sameAs ?? []).join('\n')
  formState.author.name = author.name ?? ''
  formState.author.url = author.url ?? ''
  formState.author.image = author.image ?? ''
  formState.author.sameAsInput = (author.sameAs ?? []).join('\n')
  formState.blog.name = merged.blog?.name ?? ''
  formState.blog.url = merged.blog?.url ?? ''
  formState.categories = (merged.categories ?? []).map(item => ({
    name: item.name,
    slug: item.slug ?? ''
  }))
  isDirty.value = false
  nextTick(() => {
    isHydrating.value = false
  })
}

const addCategory = () => {
  formState.categories.push({ name: '', slug: '' })
}

const removeCategory = (index: number) => {
  formState.categories.splice(index, 1)
}

const saveConfig = async () => {
  if (!activeOrg.value?.data?.id) {
    return
  }
  isSaving.value = true
  try {
    const categories = formState.categories
      .map((category) => {
        const name = category.name.trim()
        if (!name) {
          return null
        }
        const resolvedSlug = (category.slug || '').trim() || normalizeSlug(name)
        return {
          name,
          ...(resolvedSlug ? { slug: resolvedSlug } : {})
        }
      })
      .filter(Boolean) as Array<{ name: string, slug?: string }>

    const nextConfig = normalizeSiteConfig({
      publisher: {
        name: formState.publisher.name,
        url: formState.publisher.url,
        logoUrl: formState.publisher.logoUrl,
        sameAs: normalizeSameAs(formState.publisher.sameAsInput)
      },
      author: {
        name: formState.author.name,
        url: formState.author.url,
        image: formState.author.image,
        sameAs: normalizeSameAs(formState.author.sameAsInput)
      },
      blog: {
        name: formState.blog.name,
        url: formState.blog.url
      },
      categories
    })
    const nextMetadata = mergeSiteConfigIntoMetadata(metadataValue.value, nextConfig)
    const { error } = await organization.update({
      organizationId: activeOrg.value.data.id,
      data: {
        metadata: nextMetadata
      }
    })
    if (error) {
      throw error
    }
    await refreshActiveOrg()
    toast.add({ title: 'Site config saved', color: 'success' })
    isDirty.value = false
  } catch (error: any) {
    toast.add({
      title: 'Failed to save site config',
      description: error?.message || 'Please try again.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

watch(metadataValue, () => {
  if (!isDirty.value) {
    loadFromOrganization()
  }
}, { immediate: true })

watch([() => activeOrg.value?.data?.id, () => user.value?.id], () => {
  if (!isDirty.value) {
    loadFromOrganization()
  }
})

watch(formState, () => {
  if (!isHydrating.value) {
    isDirty.value = true
  }
}, { deep: true })
</script>

<template>
  <div class="w-full max-w-none p-4 sm:p-6 space-y-6">
    <header class="space-y-2">
      <p class="text-xs uppercase tracking-wide text-muted-foreground">
        Org Config
      </p>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-1">
          <h1 class="text-xl font-semibold">
            Site settings
          </h1>
          <p class="text-sm text-muted-500">
            Default publisher, author, and blog settings used across structured data exports.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            color="primary"
            :loading="isSaving"
            icon="i-lucide-save"
            loading-icon="i-lucide-save"
            @click="saveConfig"
          >
            Save
          </UButton>
        </div>
      </div>
    </header>

    <UAlert
      v-if="warningMessages.length"
      color="warning"
      variant="soft"
      title="Config suggestions"
    >
      <template #description>
        <ul class="list-disc list-inside space-y-1 text-sm">
          <li
            v-for="message in warningMessages"
            :key="message"
          >
            {{ message }}
          </li>
        </ul>
      </template>
    </UAlert>

    <UCard class="w-full">
      <template #header>
        <p class="text-sm font-medium">
          Publisher profile
        </p>
      </template>
      <div class="space-y-4">
        <UFormField v-bind="fieldProps" label="Publisher name">
          <UInput v-model="formState.publisher.name" placeholder="Organization name" class="w-full" />
        </UFormField>
        <UFormField v-bind="fieldProps" label="Publisher URL">
          <UInput v-model="formState.publisher.url" placeholder="https://example.com" class="w-full" />
        </UFormField>
        <UFormField v-bind="fieldProps" label="Publisher logo URL">
          <UInput v-model="formState.publisher.logoUrl" placeholder="https://example.com/logo.png" class="w-full" />
        </UFormField>
        <UFormField v-bind="fieldProps" label="Publisher social links (one per line)">
          <UTextarea v-model="formState.publisher.sameAsInput" :rows="3" class="w-full" />
        </UFormField>
      </div>
    </UCard>

    <UCard class="w-full">
      <template #header>
        <p class="text-sm font-medium">
          Author defaults
        </p>
      </template>
      <div class="space-y-4">
        <UFormField v-bind="fieldProps" label="Author name">
          <UInput v-model="formState.author.name" placeholder="Primary editor" class="w-full" />
        </UFormField>
        <UFormField v-bind="fieldProps" label="Author URL">
          <UInput v-model="formState.author.url" placeholder="https://example.com/about" class="w-full" />
        </UFormField>
        <UFormField v-bind="fieldProps" label="Author image URL">
          <UInput v-model="formState.author.image" placeholder="https://example.com/author.png" class="w-full" />
        </UFormField>
        <UFormField v-bind="fieldProps" label="Author social links (one per line)">
          <UTextarea v-model="formState.author.sameAsInput" :rows="3" class="w-full" />
        </UFormField>
      </div>
    </UCard>

    <UCard class="w-full">
      <template #header>
          <p class="text-sm font-medium">
            Blog defaults
          </p>
      </template>
      <div class="space-y-4">
        <UFormField v-bind="fieldProps" label="Blog name">
          <UInput v-model="formState.blog.name" placeholder="Blog" class="w-full" />
        </UFormField>
        <UFormField v-bind="fieldProps" label="Blog URL">
          <UInput v-model="formState.blog.url" placeholder="https://example.com/blog" class="w-full" />
        </UFormField>
      </div>
    </UCard>

    <UCard class="w-full">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-medium">
            Categories
          </p>
          <UButton
            variant="ghost"
            icon="i-lucide-plus"
            @click="addCategory"
          >
            Add category
          </UButton>
        </div>
      </template>
      <div class="space-y-4">
        <div
          v-for="(category, index) in formState.categories"
          :key="index"
          class="space-y-3 rounded-lg border border-surface-200/60 dark:border-surface-800/60 p-3"
        >
          <UFormField v-bind="fieldProps" label="Category name">
            <UInput v-model="category.name" placeholder="News" class="w-full" />
          </UFormField>
          <UFormField v-bind="fieldProps" label="Slug (optional)">
            <UInput v-model="category.slug" placeholder="news" class="w-full" />
          </UFormField>
          <div class="flex items-center justify-end">
            <UButton
              variant="ghost"
              color="red"
              icon="i-lucide-trash"
              @click="removeCategory(index)"
            >
              Remove
            </UButton>
          </div>
        </div>
        <p
          v-if="!formState.categories.length"
          class="text-sm text-muted-500"
        >
          Add categories so writers can pick them on each post.
        </p>
      </div>
    </UCard>

    <p class="text-xs text-muted-500">
      Tip: leave fields empty to fall back to organization + content creator defaults.
    </p>
  </div>
</template>
