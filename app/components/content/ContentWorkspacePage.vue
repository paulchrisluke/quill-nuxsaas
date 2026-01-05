<script setup lang="ts">
import type { ContentStatus, ContentType, PublishContentResponse } from '~~/server/types/content'
import { Emoji, gitHubEmojis } from '@tiptap/extension-emoji'
import { nextTick } from 'vue'
import { getSiteConfigFromMetadata } from '~~/shared/utils/siteConfig'
import ImageSuggestionsPanel from '~/components/content/ImageSuggestionsPanel.vue'
import { useContentList } from '~/composables/useContentList'
import { useContentUpdates } from '~/composables/useContentUpdates'

const route = useRoute()
const setHeaderTitle = inject<(title: string | null) => void>('setHeaderTitle', () => {})

interface ContentEntry {
  id: string
  title: string
  slug: string
  status: string
  contentType: string
  bodyMarkdown: string
  schemaTypes: string[]
  schemaValidation: {
    errors: string[]
    warnings: string[]
  } | null
  imageSuggestions: ImageSuggestion[]
  videoId: string | null
  frontmatter: Record<string, any> | null
  structuredData: string | null
  structuredDataGraph: Record<string, any> | null
}

interface ImageSuggestion {
  sectionId: string
  position: number
  altText: string
  reason: string
  priority: 'high' | 'medium' | 'low'
  type?: 'generated' | 'screencap' | 'uploaded'
  videoId?: string
  estimatedTimestamp?: number
  thumbnailFileId?: string
  thumbnailUrl?: string
  fullSizeFileId?: string
  fullSizeUrl?: string
  status?: 'pending' | 'thumbnail_ready' | 'added' | 'failed'
}

interface ContentApiResponse {
  workspace?: {
    content?: {
      id?: string
      title?: string
      slug?: string
      status?: string
      contentType?: string
    }
    sourceContent?: {
      sourceType?: string
      externalId?: string
    } | null
    currentVersion?: {
      bodyMarkdown?: string
      imageSuggestions?: ImageSuggestion[]
      structuredData?: string | null
      structuredDataGraph?: Record<string, any> | null
      frontmatter?: {
        contentType?: string
      } & Record<string, any>
      seoSnapshot?: Record<string, any> | null
    }
  }
}

interface ContentVersionSummary {
  id: string
  version: number
  createdAt: string
  createdByUserId?: string | null
  title?: string | null
  diffStats?: { additions: number, deletions: number } | null
}

interface SaveContentBodyResponse {
  content: {
    id: string
    organizationId: string
    slug: string
    title: string
    status: ContentStatus
    contentType: ContentType
  }
  version: {
    id: string
    contentId: string
    version: number
    bodyMarkdown: string
    sections: Record<string, any>[] | null
  }
  markdown: string
}

const contentId = computed(() => {
  const param = route.params.id
  return Array.isArray(param) ? param[0] : param || ''
})

const { data: contentData, pending, error, refresh: refreshContent } = useFetch(() => `/api/content/${contentId.value}`, {
  key: computed(() => `content-${contentId.value}`),
  lazy: true,
  default: () => null,
  server: false
})

const { data: versionsData, pending: versionsPending, refresh: refreshVersions } = useFetch(() => `/api/content/${contentId.value}/versions`, {
  key: computed(() => `content-versions-${contentId.value}`),
  lazy: true,
  default: () => ({ versions: [], currentVersionId: null }),
  server: false
})

const previousVersionData = ref<{ bodyMarkdown?: string | null } | null>(null)
const previousVersionLoading = ref(false)

// Ensure pending state is consistent for hydration
const isPending = computed(() => {
  if (import.meta.server) {
    return false // On server, always render as not pending since server: false
  }
  return pending.value
})
const toast = useToast()
const { useActiveOrganization } = useAuth()
const activeOrg = useActiveOrganization()
const { remove: removeContent } = useContentList({ pageSize: 100, stateKey: 'workspace-file-tree' })
const { latestUpdate } = useContentUpdates()

const siteConfig = computed(() => getSiteConfigFromMetadata(activeOrg.value?.data?.metadata))
const categoryOptions = computed(() => siteConfig.value.categories ?? [])

const contentEntry = computed<ContentEntry | null>(() => {
  if (!contentData.value)
    return null

  const entry = contentData.value as ContentApiResponse
  const workspace = entry.workspace
  const content = workspace?.content
  const currentVersion = workspace?.currentVersion
  const sourceContent = workspace?.sourceContent

  if (!content)
    return null

  const frontmatter = (currentVersion?.frontmatter as Record<string, any> | undefined) ?? null
  const structuredData = typeof currentVersion?.structuredData === 'string'
    ? currentVersion.structuredData
    : null
  const structuredDataGraph = currentVersion?.structuredDataGraph && typeof currentVersion.structuredDataGraph === 'object'
    ? currentVersion.structuredDataGraph as Record<string, any>
    : null
  const schemaTypes = Array.isArray(frontmatter?.schemaTypes)
    ? frontmatter.schemaTypes.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  const schemaValidationRaw = currentVersion?.seoSnapshot && typeof currentVersion.seoSnapshot === 'object'
    ? (currentVersion.seoSnapshot as Record<string, any>).schemaValidation
    : null
  const schemaValidation = schemaValidationRaw && typeof schemaValidationRaw === 'object'
    ? {
        errors: Array.isArray(schemaValidationRaw.errors) ? schemaValidationRaw.errors.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        warnings: Array.isArray(schemaValidationRaw.warnings) ? schemaValidationRaw.warnings.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0) : []
      }
    : null

  const imageSuggestions = Array.isArray(currentVersion?.imageSuggestions)
    ? currentVersion.imageSuggestions as ImageSuggestion[]
    : []

  // Extract videoId from sourceContent for YouTube links
  const videoId = sourceContent?.sourceType === 'youtube' && sourceContent.externalId
    ? sourceContent.externalId
    : null

  return {
    id: content?.id || '',
    title: content?.title || 'Untitled content',
    slug: content?.slug || '',
    status: content?.status || 'draft',
    contentType: currentVersion?.frontmatter?.contentType || content?.contentType || 'content',
    bodyMarkdown: currentVersion?.bodyMarkdown || '',
    schemaTypes,
    schemaValidation,
    imageSuggestions,
    videoId,
    frontmatter,
    structuredData,
    structuredDataGraph
  }
})

const normalizeLinesParam = (value: string | string[] | null | undefined) => {
  if (!value)
    return null
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || null
}

const parseLineRange = (value: string | null) => {
  if (!value)
    return null
  const match = value.match(/^(\d+)(?:-(\d+))?$/)
  if (!match)
    return null
  const start = Number.parseInt(match[1], 10)
  const end = match[2] ? Number.parseInt(match[2], 10) : start
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0)
    return null
  return {
    start: Math.min(start, end),
    end: Math.max(start, end)
  }
}

const focusLineRange = computed(() => parseLineRange(normalizeLinesParam(route.query.lines as string | string[] | null | undefined)))
const focusSectionParam = computed(() => {
  const raw = normalizeLinesParam(route.query.section as string | string[] | null | undefined)
  if (!raw)
    return null
  try {
    return decodeURIComponent(raw).trim() || null
  } catch {
    return raw.trim() || null
  }
})

const editorContent = ref('')

const markdownLines = computed(() => {
  const text = editorContent.value || ''
  return text.replace(/\r/g, '').split('\n')
})

const contentSections = computed(() => {
  const sections: Array<{ title: string, level: number, startLine: number, endLine: number }> = []
  const lines = markdownLines.value
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const match = /^(#{1,4})[ \t]+/.exec(line)
    if (!match)
      continue
    const level = match[1].length
    const title = line.slice(match[0].length).trim()
    if (!title)
      continue
    sections.push({
      title,
      level,
      startLine: i + 1,
      endLine: lines.length
    })
  }

  for (let i = 0; i < sections.length; i += 1) {
    const next = sections[i + 1]
    if (next) {
      sections[i].endLine = Math.max(sections[i].startLine, next.startLine - 1)
    }
  }

  return sections
})

const focusedSection = computed(() => {
  const range = focusLineRange.value
  if (!range)
    return null
  return contentSections.value.find(section => range.start >= section.startLine && range.start <= section.endLine) || null
})

const editorContainerRef = ref<HTMLElement | null>(null)

const scrollToSection = (title: string) => {
  if (!import.meta.client || !editorContainerRef.value)
    return
  const headings = editorContainerRef.value.querySelectorAll('h1, h2, h3, h4')
  const normalizedTarget = title.trim().toLowerCase()
  let targetElement: HTMLElement | null = null

  headings.forEach((heading) => {
    if (targetElement)
      return
    const text = heading.textContent?.trim().toLowerCase() || ''
    if (text === normalizedTarget) {
      targetElement = heading as HTMLElement
    }
  })

  if (!targetElement)
    return

  targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
  targetElement.classList.add('focus-highlight')
  window.setTimeout(() => {
    targetElement?.classList.remove('focus-highlight')
  }, 1400)
}

const loadPreviousVersionBody = async (versionId: string | null) => {
  if (!versionId || previousVersionLoading.value) {
    return
  }
  previousVersionLoading.value = true
  try {
    const data = await $fetch<{ bodyMarkdown?: string | null }>(`/api/content/version/${versionId}`)
    previousVersionData.value = data
  } catch (error) {
    console.error('[Content] Failed to load previous version body', error)
    previousVersionData.value = null
  } finally {
    previousVersionLoading.value = false
  }
}

const buildLineDiff = (beforeLines: string[], afterLines: string[]) => {
  const beforeCount = beforeLines.length
  const afterCount = afterLines.length
  const dp: number[][] = Array.from({ length: beforeCount + 1 }, () => Array(afterCount + 1).fill(0))

  for (let i = beforeCount - 1; i >= 0; i -= 1) {
    for (let j = afterCount - 1; j >= 0; j -= 1) {
      if (beforeLines[i] === afterLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const diff: Array<{ type: 'add' | 'remove' | 'same', text: string }> = []
  let i = 0
  let j = 0
  while (i < beforeCount && j < afterCount) {
    if (beforeLines[i] === afterLines[j]) {
      diff.push({ type: 'same', text: beforeLines[i] })
      i += 1
      j += 1
      continue
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'remove', text: beforeLines[i] })
      i += 1
    } else {
      diff.push({ type: 'add', text: afterLines[j] })
      j += 1
    }
  }
  while (i < beforeCount) {
    diff.push({ type: 'remove', text: beforeLines[i] })
    i += 1
  }
  while (j < afterCount) {
    diff.push({ type: 'add', text: afterLines[j] })
    j += 1
  }

  return diff
}

const focusDiffLines = computed(() => {
  const range = focusLineRange.value
  if (!range)
    return []
  const currentLines = markdownLines.value
  const start = Math.max(range.start - 1, 0)
  const end = Math.min(range.end, currentLines.length)
  const currentSlice = currentLines.slice(start, end)
  if (!previousVersionData.value?.bodyMarkdown) {
    return currentSlice.map(text => ({ type: 'same' as const, text }))
  }
  const beforeText = previousVersionData.value.bodyMarkdown || ''
  const beforeLines = beforeText.replace(/\r/g, '').split('\n')
  const beforeSlice = beforeLines.slice(start, end)
  return buildLineDiff(beforeSlice, currentSlice)
})

const contentVersions = computed<ContentVersionSummary[]>(() => {
  const payload = versionsData.value as { versions?: ContentVersionSummary[] } | null
  if (!payload || !Array.isArray(payload.versions)) {
    return []
  }
  return payload.versions
})

const currentVersionId = computed(() => {
  const payload = versionsData.value as { currentVersionId?: string | null } | null
  return payload?.currentVersionId || null
})

const currentVersionEntry = computed(() => {
  if (!currentVersionId.value) {
    return contentVersions.value[0] || null
  }
  return contentVersions.value.find(entry => entry.id === currentVersionId.value) || null
})

const previousVersionEntry = computed(() => {
  if (!currentVersionEntry.value) {
    return null
  }
  const index = contentVersions.value.findIndex(entry => entry.id === currentVersionEntry.value?.id)
  if (index === -1) {
    return null
  }
  return contentVersions.value[index + 1] || null
})

const currentVersionLabel = computed(() => {
  if (!currentVersionEntry.value) {
    return 'v—'
  }
  return `v${currentVersionEntry.value.version}`
})

const schemaErrors = computed(() => contentEntry.value?.schemaValidation?.errors || [])
const schemaWarnings = computed(() => contentEntry.value?.schemaValidation?.warnings || [])
const frontmatterPreview = computed(() => {
  if (!contentEntry.value?.frontmatter) {
    return ''
  }
  return JSON.stringify(contentEntry.value.frontmatter, null, 2)
})
const structuredDataPreview = computed(() => {
  if (contentEntry.value?.structuredDataGraph) {
    return JSON.stringify(contentEntry.value.structuredDataGraph, null, 2)
  }
  return contentEntry.value?.structuredData || ''
})

const schemaTypeOptions = [
  { value: 'FAQPage', label: 'FAQPage' },
  { value: 'HowTo', label: 'HowTo' },
  { value: 'Recipe', label: 'Recipe' },
  { value: 'Course', label: 'Course' }
]

const seoForm = reactive({
  title: '',
  seoTitle: '',
  description: '',
  slug: '',
  primaryKeyword: '',
  keywordsInput: '',
  categories: [] as string[],
  schemaTypes: [] as string[]
})

const recipeForm = reactive({
  yield: '',
  prepTime: '',
  cookTime: '',
  totalTime: '',
  calories: '',
  cuisine: '',
  ingredientsInput: '',
  instructionsInput: ''
})

const howToForm = reactive({
  estimatedCost: '',
  totalTime: '',
  difficulty: '',
  suppliesInput: '',
  toolsInput: '',
  stepsInput: ''
})

const faqForm = reactive({
  description: '',
  entriesInput: ''
})

const courseForm = reactive({
  providerName: '',
  providerUrl: '',
  courseCode: '',
  modulesInput: ''
})

const seoSaving = ref(false)

const normalizeKeywordInput = (value: string) => {
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
}

const normalizeListInput = (value: string) => {
  return value
    .split('\n')
    .map(entry => entry.trim())
    .filter(Boolean)
}

const normalizePairInput = (value: string) => {
  return value
    .split('\n')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('::')
      if (separatorIndex === -1) {
        return null
      }
      const left = line.slice(0, separatorIndex).trim()
      const right = line.slice(separatorIndex + 2).trim()
      if (!left || !right) {
        return null
      }
      return { left, right }
    })
    .filter(Boolean) as Array<{ left: string, right: string }>
}

const normalizeModuleInput = (value: string) => {
  return value
    .split('\n')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('::')
      if (separatorIndex === -1) {
        return { title: line, description: '' }
      }
      const title = line.slice(0, separatorIndex).trim()
      const description = line.slice(separatorIndex + 2).trim()
      if (!title) {
        return null
      }
      return { title, description }
    })
    .filter(Boolean) as Array<{ title: string, description: string }>
}

const syncSeoForm = () => {
  const frontmatter = contentEntry.value?.frontmatter || {}
  seoForm.title = typeof frontmatter.title === 'string' ? frontmatter.title : contentEntry.value?.title || ''
  seoForm.seoTitle = typeof frontmatter.seoTitle === 'string' ? frontmatter.seoTitle : ''
  seoForm.description = typeof frontmatter.description === 'string' ? frontmatter.description : ''
  seoForm.slug = typeof frontmatter.slug === 'string' ? frontmatter.slug : contentEntry.value?.slug || ''
  seoForm.primaryKeyword = typeof frontmatter.primaryKeyword === 'string' ? frontmatter.primaryKeyword : ''
  const keywords = Array.isArray(frontmatter.keywords) ? frontmatter.keywords : []
  seoForm.keywordsInput = keywords.filter((entry: any) => typeof entry === 'string').join(', ')
  const categories = Array.isArray(frontmatter.categories) ? frontmatter.categories : []
  seoForm.categories = categories
    .filter((entry: any) => typeof entry === 'string')
    .map((entry: string) => entry.trim())
    .filter(Boolean)
  seoForm.schemaTypes = Array.isArray(frontmatter.schemaTypes)
    ? frontmatter.schemaTypes.filter((entry: unknown): entry is string => typeof entry === 'string' && entry !== 'BlogPosting')
    : []

  const recipe = typeof frontmatter.recipe === 'object' && frontmatter.recipe ? frontmatter.recipe : {}
  recipeForm.yield = typeof recipe.yield === 'string' ? recipe.yield : ''
  recipeForm.prepTime = typeof recipe.prepTime === 'string' ? recipe.prepTime : ''
  recipeForm.cookTime = typeof recipe.cookTime === 'string' ? recipe.cookTime : ''
  recipeForm.totalTime = typeof recipe.totalTime === 'string' ? recipe.totalTime : ''
  recipeForm.calories = typeof recipe.calories === 'string' ? recipe.calories : ''
  recipeForm.cuisine = typeof recipe.cuisine === 'string' ? recipe.cuisine : ''
  recipeForm.ingredientsInput = Array.isArray(recipe.ingredients) ? recipe.ingredients.join('\n') : ''
  recipeForm.instructionsInput = Array.isArray(recipe.instructions) ? recipe.instructions.join('\n') : ''

  const howTo = typeof frontmatter.howTo === 'object' && frontmatter.howTo ? frontmatter.howTo : {}
  howToForm.estimatedCost = typeof howTo.estimatedCost === 'string' ? howTo.estimatedCost : ''
  howToForm.totalTime = typeof howTo.totalTime === 'string' ? howTo.totalTime : ''
  howToForm.difficulty = typeof howTo.difficulty === 'string' ? howTo.difficulty : ''
  howToForm.suppliesInput = Array.isArray(howTo.supplies) ? howTo.supplies.join('\n') : ''
  howToForm.toolsInput = Array.isArray(howTo.tools) ? howTo.tools.join('\n') : ''
  howToForm.stepsInput = Array.isArray(howTo.steps) ? howTo.steps.join('\n') : ''

  const faq = typeof frontmatter.faq === 'object' && frontmatter.faq ? frontmatter.faq : {}
  faqForm.description = typeof faq.description === 'string' ? faq.description : ''
  faqForm.entriesInput = Array.isArray(faq.entries)
    ? faq.entries
        .map((entry: any) => {
          if (!entry || typeof entry !== 'object') {
            return null
          }
          const question = typeof entry.question === 'string' ? entry.question.trim() : ''
          const answer = typeof entry.answer === 'string' ? entry.answer.trim() : ''
          if (!question || !answer) {
            return null
          }
          return `${question} :: ${answer}`
        })
        .filter(Boolean)
        .join('\n')
    : ''

  const course = typeof frontmatter.course === 'object' && frontmatter.course ? frontmatter.course : {}
  courseForm.providerName = typeof course.providerName === 'string' ? course.providerName : ''
  courseForm.providerUrl = typeof course.providerUrl === 'string' ? course.providerUrl : ''
  courseForm.courseCode = typeof course.courseCode === 'string' ? course.courseCode : ''
  courseForm.modulesInput = Array.isArray(course.modules)
    ? course.modules
        .map((entry: any) => {
          if (!entry || typeof entry !== 'object') {
            return null
          }
          const title = typeof entry.title === 'string' ? entry.title.trim() : ''
          const description = typeof entry.description === 'string' ? entry.description.trim() : ''
          if (!title) {
            return null
          }
          return description ? `${title} :: ${description}` : title
        })
        .filter(Boolean)
        .join('\n')
    : ''
}

watch(contentEntry, () => {
  syncSeoForm()
}, { immediate: true })

const seoWarnings = computed(() => {
  const warnings: string[] = []
  if (!seoForm.title.trim()) {
    warnings.push('Title is missing.')
  }
  if (!seoForm.description.trim()) {
    warnings.push('Description is missing.')
  }
  if (!seoForm.primaryKeyword.trim()) {
    warnings.push('Primary keyword is missing.')
  }
  if (!seoForm.slug.trim()) {
    warnings.push('Slug is missing.')
  }

  if (seoForm.schemaTypes.includes('Recipe')) {
    if (!normalizeListInput(recipeForm.ingredientsInput).length) {
      warnings.push('Recipe schema needs at least one ingredient.')
    }
    if (!normalizeListInput(recipeForm.instructionsInput).length) {
      warnings.push('Recipe schema needs step-by-step instructions.')
    }
  }

  if (seoForm.schemaTypes.includes('HowTo')) {
    if (!normalizeListInput(howToForm.stepsInput).length) {
      warnings.push('HowTo schema needs at least one step.')
    }
  }

  if (seoForm.schemaTypes.includes('FAQPage')) {
    if (!normalizePairInput(faqForm.entriesInput).length) {
      warnings.push('FAQPage schema needs at least one Q/A entry.')
    }
  }

  if (seoForm.schemaTypes.includes('Course')) {
    if (!normalizeModuleInput(courseForm.modulesInput).length) {
      warnings.push('Course schema needs at least one module.')
    }
  }

  return warnings
})

const saveSeoForm = async () => {
  if (!contentEntry.value?.id) {
    return
  }
  seoSaving.value = true
  try {
    const recipeEnabled = seoForm.schemaTypes.includes('Recipe')
    const howToEnabled = seoForm.schemaTypes.includes('HowTo')
    const faqEnabled = seoForm.schemaTypes.includes('FAQPage')
    const courseEnabled = seoForm.schemaTypes.includes('Course')

    const recipe = recipeEnabled
      ? {
          yield: recipeForm.yield || null,
          prepTime: recipeForm.prepTime || null,
          cookTime: recipeForm.cookTime || null,
          totalTime: recipeForm.totalTime || null,
          calories: recipeForm.calories || null,
          cuisine: recipeForm.cuisine || null,
          ingredients: normalizeListInput(recipeForm.ingredientsInput),
          instructions: normalizeListInput(recipeForm.instructionsInput)
        }
      : null

    const howTo = howToEnabled
      ? {
          estimatedCost: howToForm.estimatedCost || null,
          totalTime: howToForm.totalTime || null,
          difficulty: howToForm.difficulty || null,
          supplies: normalizeListInput(howToForm.suppliesInput),
          tools: normalizeListInput(howToForm.toolsInput),
          steps: normalizeListInput(howToForm.stepsInput)
        }
      : null

    const faqEntries = faqEnabled
      ? normalizePairInput(faqForm.entriesInput).map(entry => ({
          question: entry.left,
          answer: entry.right
        }))
      : []

    const faq = faqEnabled
      ? {
          description: faqForm.description || null,
          entries: faqEntries
        }
      : null

    const courseModules = courseEnabled
      ? normalizeModuleInput(courseForm.modulesInput)
      : []

    const course = courseEnabled
      ? {
          providerName: courseForm.providerName || null,
          providerUrl: courseForm.providerUrl || null,
          courseCode: courseForm.courseCode || null,
          modules: courseModules
        }
      : null

    const body = {
      title: seoForm.title || null,
      seoTitle: seoForm.seoTitle || null,
      description: seoForm.description || null,
      slug: seoForm.slug || null,
      primaryKeyword: seoForm.primaryKeyword || null,
      keywords: normalizeKeywordInput(seoForm.keywordsInput),
      categories: seoForm.categories,
      schemaTypes: ['BlogPosting', ...seoForm.schemaTypes],
      recipe,
      howTo,
      faq,
      course
    }
    await $fetch(`/api/content/${contentEntry.value.id}/frontmatter`, {
      method: 'PUT',
      body
    })
    toast.add({ title: 'SEO settings saved', color: 'success' })
    await refreshContent()
  } catch (error: any) {
    toast.add({
      title: 'Failed to save SEO settings',
      description: error?.message || 'Please try again.',
      color: 'error'
    })
  } finally {
    seoSaving.value = false
  }
}

const isSaving = ref(false)
const isPublishing = ref(false)
const isReverting = ref(false)
const lastPublishedPrUrl = ref<string | null>(null)
const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved')
const lastContentId = ref<string | null>(null)
const autoSaveTimeout = ref<ReturnType<typeof setTimeout> | null>(null)
const isContentLoading = ref(false)
const editorToolbarItems = [
  [
    {
      icon: 'i-lucide-heading',
      tooltip: { text: 'Headings' },
      content: { align: 'start' },
      items: [
        { kind: 'heading', level: 1, icon: 'i-lucide-heading-1', label: 'Heading 1' },
        { kind: 'heading', level: 2, icon: 'i-lucide-heading-2', label: 'Heading 2' },
        { kind: 'heading', level: 3, icon: 'i-lucide-heading-3', label: 'Heading 3' },
        { kind: 'heading', level: 4, icon: 'i-lucide-heading-4', label: 'Heading 4' }
      ]
    }
  ],
  [
    { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
    { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
    { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strike' } },
    { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Code' } }
  ],
  [
    { kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Bullet list' } },
    { kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Numbered list' } },
    { kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: 'Quote' } },
    { kind: 'horizontalRule', icon: 'i-lucide-separator-horizontal', tooltip: { text: 'Divider' } }
  ],
  [
    { kind: 'link', icon: 'i-lucide-link', tooltip: { text: 'Link' } },
    { kind: 'image', icon: 'i-lucide-image', tooltip: { text: 'Image' } }
  ],
  [
    { kind: 'undo', icon: 'i-lucide-undo-2', tooltip: { text: 'Undo' } },
    { kind: 'redo', icon: 'i-lucide-redo-2', tooltip: { text: 'Redo' } },
    { kind: 'clearFormatting', icon: 'i-lucide-eraser', tooltip: { text: 'Clear formatting' } }
  ]
]

const editorSuggestionItems = [
  [
    { type: 'label', label: 'Text' },
    { kind: 'paragraph', label: 'Paragraph', icon: 'i-lucide-type' },
    { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
    { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
    { kind: 'heading', level: 3, label: 'Heading 3', icon: 'i-lucide-heading-3' }
  ],
  [
    { type: 'label', label: 'Lists' },
    { kind: 'bulletList', label: 'Bullet list', icon: 'i-lucide-list' },
    { kind: 'orderedList', label: 'Numbered list', icon: 'i-lucide-list-ordered' }
  ],
  [
    { type: 'label', label: 'Insert' },
    { kind: 'blockquote', label: 'Blockquote', icon: 'i-lucide-text-quote' },
    { kind: 'codeBlock', label: 'Code block', icon: 'i-lucide-square-code' },
    { kind: 'horizontalRule', label: 'Divider', icon: 'i-lucide-separator-horizontal' }
  ]
]

const editorMentionItems = [
  { label: 'team', description: 'Team mention' },
  { label: 'editorial', description: 'Editorial group' },
  { label: 'reviewer', description: 'Content review' }
]

const editorEmojiItems = gitHubEmojis.filter(
  emoji => !emoji.name.startsWith('regional_indicator_')
)

const saveContentBody = async () => {
  if (!contentEntry.value || isSaving.value) {
    return
  }

  // Clear timeout if it exists
  if (autoSaveTimeout.value) {
    clearTimeout(autoSaveTimeout.value)
    autoSaveTimeout.value = null
  }

  isSaving.value = true
  saveStatus.value = 'saving'
  try {
    const response = await $fetch<SaveContentBodyResponse>(`/api/content/${contentEntry.value.id}/body`, {
      method: 'POST',
      body: {
        markdown: editorContent.value
      }
    })

    const updated = response?.markdown ?? editorContent.value
    editorContent.value = updated
    saveStatus.value = 'saved'
    // No need to refresh - we already have the updated markdown from the response
  } catch (err) {
    console.error('Failed to save content body', err)
    saveStatus.value = 'unsaved'
    toast.add({
      title: 'Failed to save content',
      description: err instanceof Error ? err.message : 'Please try again.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

watch(contentEntry, (entry) => {
  if (!entry) {
    isContentLoading.value = true
    editorContent.value = ''
    lastContentId.value = null
    lastPublishedPrUrl.value = null
    saveStatus.value = 'saved'
    previousVersionData.value = null
    isContentLoading.value = false
    return
  }
  if (entry.id && entry.id !== lastContentId.value) {
    isContentLoading.value = true
    lastContentId.value = entry.id
    lastPublishedPrUrl.value = null
    editorContent.value = entry.bodyMarkdown || ''
    saveStatus.value = 'saved'
    previousVersionData.value = null
    nextTick(() => {
      isContentLoading.value = false
    })
    return
  }
  // Only update if we haven't made local edits
  if (saveStatus.value === 'saved') {
    isContentLoading.value = true
    editorContent.value = entry.bodyMarkdown || ''
    nextTick(() => {
      isContentLoading.value = false
    })
  }
})

watch([focusLineRange, previousVersionEntry], ([range, previous]) => {
  if (range && previous?.id) {
    loadPreviousVersionBody(previous.id).catch(() => {})
  }
})

watch([focusedSection, () => editorContent.value], ([section]) => {
  if (!section) {
    return
  }
  nextTick(() => {
    scrollToSection(section.title)
  })
})

watch(focusSectionParam, (section) => {
  if (!section) {
    return
  }
  nextTick(() => {
    scrollToSection(section)
  })
})

// Auto-save with debouncing
watch(editorContent, () => {
  if (!contentEntry.value || saveStatus.value === 'saving' || isContentLoading.value) {
    return
  }

  saveStatus.value = 'unsaved'

  // Clear existing timeout
  if (autoSaveTimeout.value) {
    clearTimeout(autoSaveTimeout.value)
  }

  // Debounce auto-save (2 seconds after user stops typing)
  autoSaveTimeout.value = setTimeout(() => {
    saveContentBody()
  }, 2000)
})

// Cleanup timeout on unmount
onBeforeUnmount(() => {
  if (autoSaveTimeout.value) {
    clearTimeout(autoSaveTimeout.value)
  }
})

const archiveContent = async () => {
  if (!contentEntry.value)
    return

  try {
    await $fetch(`/api/content/${contentEntry.value.id}/archive`, { method: 'POST' })
    removeContent(contentEntry.value.id)
    // Navigate to content list after successful archive
    await navigateTo('/content')
    toast.add({
      title: 'Content archived',
      color: 'success'
    })
  } catch (err) {
    console.error('Failed to archive content', err)
    toast.add({
      title: 'Failed to archive content',
      description: err instanceof Error ? err.message : 'Please try again.',
      color: 'error'
    })
  }
}

const publishButtonLabel = computed(() => {
  if (lastPublishedPrUrl.value) {
    if (saveStatus.value === 'unsaved') {
      return 'Update PR'
    }
    if (saveStatus.value === 'saving') {
      return 'Saving...'
    }
    return 'View PR'
  }
  return 'Open PR'
})

const publishContent = async () => {
  if (!contentEntry.value || isPublishing.value || isSaving.value) {
    return
  }
  if (lastPublishedPrUrl.value && saveStatus.value === 'saved') {
    window.open(lastPublishedPrUrl.value, '_blank', 'noopener,noreferrer')
    return
  }
  try {
    isPublishing.value = true
    const response = await $fetch<PublishContentResponse>(`/api/content/${contentEntry.value.id}/publish`, {
      method: 'POST',
      body: { versionId: null }
    })
    lastPublishedPrUrl.value = response?.external?.github?.prUrl ?? null
    toast.add({
      title: lastPublishedPrUrl.value ? 'PR created' : 'Content published',
      description: lastPublishedPrUrl.value
        ? 'Open the pull request to review changes.'
        : response?.file?.url
          ? `Available at ${response.file.url}`
          : 'The latest version has been saved to your content storage.',
      color: 'primary'
    })
    await refreshContent()
  } catch (err) {
    console.error('Failed to publish content', err)
    toast.add({
      title: 'Publish failed',
      description: err instanceof Error ? err.message : 'Please try again.',
      color: 'error'
    })
  } finally {
    isPublishing.value = false
  }
}

const formatVersionLabel = (entry: ContentVersionSummary) => {
  const base = `v${entry.version}`
  if (!entry.createdAt) {
    return base
  }
  const createdAt = new Date(entry.createdAt)
  if (Number.isNaN(createdAt.getTime())) {
    return base
  }
  return `${base} • ${createdAt.toLocaleString()}`
}

const revertToVersion = async (versionId: string) => {
  if (!contentEntry.value || !versionId || isReverting.value) {
    return
  }
  isReverting.value = true
  try {
    await $fetch(`/api/content/${contentEntry.value.id}/revert`, {
      method: 'POST',
      body: { versionId }
    })
    toast.add({
      title: 'Changes reverted',
      description: 'The content has been restored to the selected version.',
      color: 'success'
    })
    saveStatus.value = 'saved'
    await refreshContent()
    await refreshVersions()
  } catch (error: any) {
    toast.add({
      title: 'Revert failed',
      description: error?.message || 'Please try again.',
      color: 'error'
    })
  } finally {
    isReverting.value = false
  }
}

const versionMenuItems = computed(() => contentVersions.value.map(entry => ({
  label: formatVersionLabel(entry),
  icon: entry.id === currentVersionId.value ? 'i-lucide-check' : 'i-lucide-rotate-ccw',
  disabled: entry.id === currentVersionId.value || isReverting.value,
  onSelect: () => revertToVersion(entry.id)
})))

// Don't set header title - we want no header for content pages
watch([contentEntry, error], () => {
  setHeaderTitle?.(null)
}, { immediate: true })

watch(latestUpdate, (update) => {
  if (!update) {
    return
  }
  if (update.contentId === contentId.value && saveStatus.value === 'saved') {
    refreshContent()
    refreshVersions()
  }
})
</script>

<template>
  <div class="space-y-4 sm:space-y-6 px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
    <ClientOnly>
      <div
        v-if="isPending"
        class="space-y-4"
      >
        <USkeleton class="h-20 w-full" />
        <USkeleton class="h-32 w-3/4" />
        <USkeleton class="h-24 w-full" />
      </div>
    </ClientOnly>

    <UAlert
      v-if="!isPending && error"
      color="error"
      variant="soft"
      icon="i-lucide-alert-triangle"
      :description="error?.message || 'Failed to load content'"
    />

    <template v-if="!isPending && contentEntry">
      <UCard
        v-if="focusLineRange"
        class="mb-4"
      >
        <template #header>
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p class="text-sm font-semibold">
                Focused changes
              </p>
              <p class="text-xs text-muted-500">
                Lines {{ focusLineRange.start }}-{{ focusLineRange.end }}
                <span v-if="focusedSection"> • {{ focusedSection.title }}</span>
              </p>
            </div>
            <UButton
              v-if="focusedSection"
              size="xs"
              variant="ghost"
              icon="i-lucide-locate"
              @click="scrollToSection(focusedSection.title)"
            >
              Jump to section
            </UButton>
          </div>
        </template>
        <div class="space-y-1 font-mono text-xs">
          <div
            v-if="previousVersionLoading"
            class="text-muted-500"
          >
            Loading diff preview...
          </div>
          <div v-else>
            <div
              v-for="(line, index) in focusDiffLines"
              :key="`focus-line-${index}`"
              class="flex items-start gap-2 rounded px-2 py-1"
              :class="line.type === 'add' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' : line.type === 'remove' ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200 line-through' : 'text-muted-700'"
            >
              <span class="w-4 text-right text-muted-400">
                {{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ' }}
              </span>
              <span class="whitespace-pre-wrap break-words flex-1">
                {{ line.text }}
              </span>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Body Markdown Editor - moved to top -->
      <UCard class="mb-4">
        <template #header>
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
            <p class="text-sm sm:text-base font-semibold truncate min-w-0 flex-1">
              {{ contentEntry.title }}
            </p>
            <div class="flex items-center gap-2 flex-shrink-0">
              <span
                v-if="saveStatus === 'saving'"
                class="text-xs text-muted-500 whitespace-nowrap"
              >
                Saving...
              </span>
              <span
                v-else-if="saveStatus === 'saved'"
                class="text-xs text-emerald-600 dark:text-emerald-400 whitespace-nowrap"
              >
                Saved
              </span>
              <span
                v-else
                class="text-xs text-warning-600 dark:text-warning-400 whitespace-nowrap"
              >
                Unsaved
              </span>
              <UDropdownMenu
                v-if="contentVersions.length"
                :items="versionMenuItems"
              >
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-history"
                  :loading="versionsPending"
                  class="flex-shrink-0"
                >
                  {{ currentVersionLabel }}
                </UButton>
              </UDropdownMenu>
              <UButton
                v-if="previousVersionEntry"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-undo-2"
                :loading="isReverting"
                class="flex-shrink-0"
                @click="revertToVersion(previousVersionEntry.id)"
              >
                Undo
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-archive"
                class="flex-shrink-0"
                @click="archiveContent"
              >
                <span class="hidden sm:inline">Archive</span>
              </UButton>
              <UButton
                size="xs"
                color="primary"
                variant="soft"
                :loading="isPublishing || isSaving"
                class="flex-shrink-0"
                @click="publishContent"
              >
                {{ publishButtonLabel }}
              </UButton>
            </div>
          </div>
        </template>
        <div ref="editorContainerRef">
          <ClientOnly>
            <UEditor
              v-model="editorContent"
              placeholder="Start writing..."
              content-type="markdown"
              :extensions="[Emoji]"
              :starter-kit="{
                headings: { levels: [1, 2, 3, 4] },
                link: { openOnClick: false },
                dropcursor: { color: 'var(--ui-primary)', width: 2 }
              }"
              class="w-full"
            >
              <template #default="slotProps">
                <UEditorToolbar
                  v-if="slotProps?.editor"
                  :editor="slotProps.editor"
                  :items="editorToolbarItems"
                  layout="fixed"
                  class="mb-2 overflow-x-auto"
                />
                <UEditorSuggestionMenu
                  v-if="slotProps?.editor"
                  :editor="slotProps.editor"
                  :items="editorSuggestionItems"
                />
                <UEditorMentionMenu
                  v-if="slotProps?.editor"
                  :editor="slotProps.editor"
                  :items="editorMentionItems"
                />
                <UEditorEmojiMenu
                  v-if="slotProps?.editor"
                  :editor="slotProps.editor"
                  :items="editorEmojiItems"
                />
                <UEditorDragHandle
                  v-if="slotProps?.editor"
                  :editor="slotProps.editor"
                />
              </template>
            </UEditor>
            <template #fallback>
              <UTextarea
                :model-value="editorContent"
                placeholder="Loading editor..."
                :rows="20"
                autoresize
                class="w-full"
                @update:model-value="editorContent = $event ?? ''"
              />
            </template>
          </ClientOnly>
        </div>
      </UCard>

      <UCard
        v-if="contentSections.length"
        class="mb-4"
      >
        <template #header>
          <p class="text-sm font-semibold">
            Sections
          </p>
        </template>
        <div class="space-y-1">
          <UButton
            v-for="section in contentSections"
            :key="`${section.title}-${section.startLine}`"
            variant="ghost"
            size="sm"
            class="w-full justify-start"
            :class="section.level >= 3 ? 'pl-6' : section.level === 2 ? 'pl-4' : ''"
            @click="scrollToSection(section.title)"
          >
            <span class="truncate">
              {{ section.title }}
            </span>
            <span class="ml-auto text-xs text-muted-400">
              {{ section.startLine }}-{{ section.endLine }}
            </span>
          </UButton>
        </div>
      </UCard>

      <!-- Schema validation alerts -->
      <div class="space-y-3 sm:space-y-4 mb-4">
        <UAlert
          v-if="schemaErrors.length"
          color="error"
          variant="soft"
          icon="i-lucide-alert-circle"
          title="Schema requirements missing"
        >
          <template #description>
            <ul class="list-disc list-inside space-y-1 text-sm">
              <li
                v-for="(issue, i) in schemaErrors"
                :key="`schema-error-${issue}-${i}`"
              >
                {{ issue }}
              </li>
            </ul>
          </template>
        </UAlert>
        <UAlert
          v-if="schemaWarnings.length"
          color="warning"
          variant="soft"
          icon="i-lucide-alert-triangle"
          title="Schema improvements suggested"
        >
          <template #description>
            <ul class="list-disc list-inside space-y-1 text-sm">
              <li
                v-for="(issue, i) in schemaWarnings"
                :key="`schema-warning-${issue}-${i}`"
              >
                {{ issue }}
              </li>
            </ul>
          </template>
        </UAlert>
      </div>

      <div class="grid gap-4 md:grid-cols-2 mb-4">
        <UCard>
          <template #header>
            <p class="text-sm font-medium">
              Frontmatter
            </p>
          </template>
          <pre
            v-if="frontmatterPreview"
            class="text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto rounded bg-muted/30 dark:bg-muted-700/30 p-3"
          >{{ frontmatterPreview }}</pre>
          <p
            v-else
            class="text-sm text-muted-500"
          >
            No frontmatter captured yet.
          </p>
        </UCard>

        <UCard>
          <template #header>
            <p class="text-sm font-medium">
              Structured Data
            </p>
          </template>
          <div
            v-if="contentEntry?.schemaTypes?.length"
            class="flex flex-wrap gap-2 mb-3"
          >
            <UBadge
              v-for="type in contentEntry.schemaTypes"
              :key="type"
              color="primary"
              variant="soft"
            >
              {{ type }}
            </UBadge>
          </div>
          <pre
            v-if="structuredDataPreview"
            class="text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto rounded bg-muted/30 dark:bg-muted-700/30 p-3"
          >{{ structuredDataPreview }}</pre>
          <p
            v-else
            class="text-sm text-muted-500"
          >
            Structured data has not been generated yet.
          </p>
        </UCard>
      </div>

      <UCard class="mb-4">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm font-medium">
              SEO & Schema
            </p>
            <UButton
              color="primary"
              size="sm"
              icon="i-lucide-save"
              :loading="seoSaving"
              @click="saveSeoForm"
            >
              Save
            </UButton>
          </div>
        </template>

        <UAlert
          v-if="seoWarnings.length"
          color="warning"
          variant="soft"
          title="Suggestions"
          class="mb-4"
        >
          <template #description>
            <ul class="list-disc list-inside space-y-1 text-sm">
              <li
                v-for="message in seoWarnings"
                :key="message"
              >
                {{ message }}
              </li>
            </ul>
          </template>
        </UAlert>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <UFormField label="Title">
            <UInput v-model="seoForm.title" />
          </UFormField>
          <UFormField label="SEO title (optional)">
            <UInput
              v-model="seoForm.seoTitle"
              placeholder="Custom title for SERP"
            />
          </UFormField>
          <UFormField label="Description">
            <UTextarea
              v-model="seoForm.description"
              :rows="3"
            />
          </UFormField>
          <UFormField label="Slug">
            <UInput v-model="seoForm.slug" />
          </UFormField>
          <UFormField label="Primary keyword">
            <UInput
              v-model="seoForm.primaryKeyword"
              placeholder="e.g. remote team onboarding"
            />
          </UFormField>
          <UFormField label="Keywords (comma separated)">
            <UInput
              v-model="seoForm.keywordsInput"
              placeholder="keyword 1, keyword 2, keyword 3"
            />
          </UFormField>
        </div>

        <div class="mt-4 space-y-2">
          <p class="text-xs uppercase tracking-wide text-muted-500">
            Categories
          </p>
          <div
            v-if="categoryOptions.length"
            class="flex flex-wrap gap-2"
          >
            <UCheckbox
              v-for="category in categoryOptions"
              :key="category.slug || category.name"
              v-model="seoForm.categories"
              :value="category.name"
              :label="category.name"
            />
          </div>
          <p
            v-else
            class="text-sm text-muted-500"
          >
            No categories yet. Add them in Site settings.
          </p>
        </div>

        <div class="mt-4 space-y-2">
          <p class="text-xs uppercase tracking-wide text-muted-500">
            Schema types
          </p>
          <div class="flex flex-wrap gap-2">
            <UBadge
              color="primary"
              variant="soft"
            >
              BlogPosting
            </UBadge>
            <UCheckbox
              v-for="option in schemaTypeOptions"
              :key="option.value"
              v-model="seoForm.schemaTypes"
              :value="option.value"
              :label="option.label"
            />
          </div>
        </div>

        <div
          v-if="seoForm.schemaTypes.includes('Recipe')"
          class="mt-6 space-y-4"
        >
          <p class="text-xs uppercase tracking-wide text-muted-500">
            Recipe schema
          </p>
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <UFormField label="Recipe yield">
              <UInput
                v-model="recipeForm.yield"
                placeholder="e.g. 4 servings"
              />
            </UFormField>
            <UFormField label="Cuisine">
              <UInput
                v-model="recipeForm.cuisine"
                placeholder="e.g. Italian"
              />
            </UFormField>
            <UFormField label="Prep time (ISO 8601)">
              <UInput
                v-model="recipeForm.prepTime"
                placeholder="PT20M"
              />
            </UFormField>
            <UFormField label="Cook time (ISO 8601)">
              <UInput
                v-model="recipeForm.cookTime"
                placeholder="PT45M"
              />
            </UFormField>
            <UFormField label="Total time (ISO 8601)">
              <UInput
                v-model="recipeForm.totalTime"
                placeholder="PT1H"
              />
            </UFormField>
            <UFormField label="Calories">
              <UInput
                v-model="recipeForm.calories"
                placeholder="e.g. 220 calories"
              />
            </UFormField>
          </div>
          <UFormField label="Ingredients (one per line)">
            <UTextarea
              v-model="recipeForm.ingredientsInput"
              :rows="4"
            />
          </UFormField>
          <UFormField label="Instructions (one step per line)">
            <UTextarea
              v-model="recipeForm.instructionsInput"
              :rows="4"
            />
          </UFormField>
        </div>

        <div
          v-if="seoForm.schemaTypes.includes('HowTo')"
          class="mt-6 space-y-4"
        >
          <p class="text-xs uppercase tracking-wide text-muted-500">
            HowTo schema
          </p>
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <UFormField label="Estimated cost">
              <UInput
                v-model="howToForm.estimatedCost"
                placeholder="e.g. $45"
              />
            </UFormField>
            <UFormField label="Total time (ISO 8601)">
              <UInput
                v-model="howToForm.totalTime"
                placeholder="PT2H"
              />
            </UFormField>
            <UFormField label="Difficulty">
              <UInput
                v-model="howToForm.difficulty"
                placeholder="e.g. Easy"
              />
            </UFormField>
          </div>
          <UFormField label="Supplies (one per line)">
            <UTextarea
              v-model="howToForm.suppliesInput"
              :rows="3"
            />
          </UFormField>
          <UFormField label="Tools (one per line)">
            <UTextarea
              v-model="howToForm.toolsInput"
              :rows="3"
            />
          </UFormField>
          <UFormField label="Steps (one per line)">
            <UTextarea
              v-model="howToForm.stepsInput"
              :rows="4"
            />
          </UFormField>
        </div>

        <div
          v-if="seoForm.schemaTypes.includes('FAQPage')"
          class="mt-6 space-y-4"
        >
          <p class="text-xs uppercase tracking-wide text-muted-500">
            FAQ schema
          </p>
          <UFormField label="FAQ description">
            <UTextarea
              v-model="faqForm.description"
              :rows="2"
            />
          </UFormField>
          <UFormField label="FAQ entries (one per line: Question :: Answer)">
            <UTextarea
              v-model="faqForm.entriesInput"
              :rows="5"
            />
          </UFormField>
        </div>

        <div
          v-if="seoForm.schemaTypes.includes('Course')"
          class="mt-6 space-y-4"
        >
          <p class="text-xs uppercase tracking-wide text-muted-500">
            Course schema
          </p>
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <UFormField label="Provider name">
              <UInput
                v-model="courseForm.providerName"
                placeholder="Organization or instructor"
              />
            </UFormField>
            <UFormField label="Provider URL">
              <UInput
                v-model="courseForm.providerUrl"
                placeholder="https://example.com"
              />
            </UFormField>
            <UFormField label="Course code">
              <UInput v-model="courseForm.courseCode" />
            </UFormField>
          </div>
          <UFormField label="Modules (one per line: Title :: Description, description optional)">
            <UTextarea
              v-model="courseForm.modulesInput"
              :rows="5"
            />
          </UFormField>
        </div>
      </UCard>

      <ImageSuggestionsPanel
        v-if="contentEntry.imageSuggestions && contentEntry.imageSuggestions.length > 0"
        :suggestions="contentEntry.imageSuggestions"
        :content-id="contentEntry.id"
        :video-id="contentEntry.videoId || undefined"
        class="mb-4"
      />
    </template>

    <UAlert
      v-else
      color="neutral"
      variant="soft"
      icon="i-lucide-file-text"
      title="No content available"
      description="This content item could not be found or loaded."
    />
  </div>
</template>
