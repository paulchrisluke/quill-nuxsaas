import type { ContentFrontmatter, ContentSection } from './types'
import {
  buildCourseInstancesFromMetadata,
  buildCourseInstancesFromSections,
  buildFaqEntriesFromMetadata,
  buildFaqEntriesFromSections,
  buildManualSteps,
  buildStepEntries,
  collectListItemsFromSections,
  normalizeStringArray
} from './schemaMetadata'

export interface StructuredDataAuthor {
  name: string
  url?: string
  image?: string
  sameAs?: string[]
}

export interface StructuredDataPublisher {
  name: string
  url?: string
  logoUrl?: string
  sameAs?: string[]
}

export interface StructuredDataBreadcrumb {
  name: string
  item: string
}

export interface StructuredDataBlog {
  name?: string
  url?: string
}

export interface StructuredDataCategory {
  name: string
  slug?: string
}

export interface StructuredDataVideo {
  name?: string
  description?: string
  thumbnailUrl?: string
  uploadDate?: string
  contentUrl?: string
  embedUrl?: string
  duration?: string
}

export interface StructuredDataParams {
  frontmatter: ContentFrontmatter
  seoSnapshot: Record<string, any> | null
  baseUrl?: string
  sections?: ContentSection[] | null
  contentId?: string | null
  author?: StructuredDataAuthor | null
  publisher?: StructuredDataPublisher | null
  breadcrumbs?: StructuredDataBreadcrumb[] | null
  blog?: StructuredDataBlog | null
  categories?: StructuredDataCategory[] | null
  datePublished?: string | Date | null
  dateModified?: string | Date | null
  video?: StructuredDataVideo | null
}

const buildRecipeStructuredData = (params: {
  frontmatter: ContentFrontmatter
  sections?: ContentSection[] | null
}) => {
  const recipeMeta = params.frontmatter.recipe
  const manualIngredients = normalizeStringArray(recipeMeta?.ingredients)
  const manualInstructions = normalizeStringArray(recipeMeta?.instructions)
  const ingredients = manualIngredients.length
    ? manualIngredients
    : collectListItemsFromSections(params.sections ?? null, ['ingredient'])
  const instructions = manualInstructions.length
    ? buildManualSteps(manualInstructions)
    : buildStepEntries(params.sections ?? null, true)

  const data: Record<string, any> = {}
  if (ingredients.length) {
    data.recipeIngredient = ingredients
  }
  if (instructions.length) {
    data.recipeInstructions = instructions
  }
  if (recipeMeta?.yield) {
    data.recipeYield = recipeMeta.yield
  }
  if (recipeMeta?.prepTime) {
    data.prepTime = recipeMeta.prepTime
  }
  if (recipeMeta?.cookTime) {
    data.cookTime = recipeMeta.cookTime
  }
  if (recipeMeta?.totalTime) {
    data.totalTime = recipeMeta.totalTime
  }
  if (recipeMeta?.calories) {
    data.nutrition = {
      '@type': 'NutritionInformation',
      'calories': recipeMeta.calories
    }
  }
  if (recipeMeta?.cuisine) {
    data.recipeCuisine = recipeMeta.cuisine
  } else if (params.frontmatter.targetLocale) {
    data.recipeCuisine = params.frontmatter.targetLocale
  }
  if (!data.recipeCategory) {
    if (params.frontmatter.primaryKeyword) {
      data.recipeCategory = params.frontmatter.primaryKeyword
    } else if (Array.isArray(params.frontmatter.tags) && params.frontmatter.tags.length) {
      data.recipeCategory = params.frontmatter.tags[0]
    }
  }
  return data
}

const buildHowToStructuredData = (params: {
  frontmatter: ContentFrontmatter
  sections?: ContentSection[] | null
}) => {
  const howToMeta = params.frontmatter.howTo
  const manualSteps = normalizeStringArray(howToMeta?.steps)
  const manualSupplies = normalizeStringArray(howToMeta?.supplies)
  const manualTools = normalizeStringArray(howToMeta?.tools)
  const steps = manualSteps.length
    ? buildManualSteps(manualSteps)
    : buildStepEntries(params.sections ?? null, true)
  const supplies = manualSupplies.length
    ? manualSupplies
    : collectListItemsFromSections(params.sections ?? null, ['supply', 'material'])
  const tools = manualTools.length
    ? manualTools
    : collectListItemsFromSections(params.sections ?? null, ['tool', 'equipment'])

  const data: Record<string, any> = {}
  if (steps.length) {
    data.step = steps
  }
  if (supplies.length) {
    data.supply = supplies
  }
  if (tools.length) {
    data.tool = tools
  }
  if (howToMeta?.estimatedCost) {
    data.estimatedCost = {
      '@type': 'MonetaryAmount',
      'value': howToMeta.estimatedCost
    }
  }
  if (howToMeta?.totalTime) {
    data.totalTime = howToMeta.totalTime
  }
  if (howToMeta?.difficulty) {
    data.difficulty = howToMeta.difficulty
  }
  return data
}

const normalizeDate = (value?: string | Date | null) => {
  if (!value) {
    return null
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  const trimmed = value.trim()
  return trimmed || null
}

const resolveContentUrl = (baseUrl?: string, slug?: string) => {
  if (!baseUrl || !slug) {
    return null
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const normalizedSlug = slug.replace(/^\/+/, '')
  return `${normalizedBase}/${normalizedSlug}`
}

const buildBreadcrumbList = (breadcrumbs?: StructuredDataBreadcrumb[] | null) => {
  if (!breadcrumbs || breadcrumbs.length === 0) {
    return null
  }
  const entries = breadcrumbs
    .map((crumb, index) => ({
      '@type': 'ListItem',
      'position': index + 1,
      'name': crumb.name,
      'item': crumb.item
    }))
    .filter(entry => entry.name && entry.item)
  if (!entries.length) {
    return null
  }
  return {
    '@type': 'BreadcrumbList',
    'itemListElement': entries
  }
}

const normalizeSlug = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const resolveCategoryMeta = (
  categoryName: string,
  categories?: StructuredDataCategory[] | null
) => {
  if (!categories?.length) {
    return null
  }
  const normalizedName = categoryName.trim().toLowerCase()
  const normalizedSlug = normalizeSlug(categoryName)
  return categories.find((category) => {
    const name = category.name?.trim().toLowerCase()
    const slug = category.slug?.trim().toLowerCase()
    return (name && name === normalizedName) || (slug && slug === normalizedSlug)
  }) ?? null
}

const buildAutoBreadcrumbs = (
  params: StructuredDataParams,
  pageUrl: string | null
): StructuredDataBreadcrumb[] | null => {
  const blogUrl = params.blog?.url?.trim()
  if (!blogUrl) {
    return null
  }

  const crumbs: StructuredDataBreadcrumb[] = []
  const blogName = params.blog?.name?.trim() || 'Blog'
  crumbs.push({ name: blogName, item: blogUrl })

  const categoryNames = normalizeStringArray(params.frontmatter.categories)
  if (categoryNames.length) {
    const categoryName = categoryNames[0]
    const categoryMeta = resolveCategoryMeta(categoryName, params.categories)
    const categorySlug = categoryMeta?.slug?.trim() || normalizeSlug(categoryName)
    if (categorySlug) {
      const categoryUrl = `${blogUrl.replace(/\/+$/, '')}/${categorySlug}`
      crumbs.push({ name: categoryMeta?.name ?? categoryName, item: categoryUrl })
    }
  }

  if (pageUrl && params.frontmatter.title) {
    crumbs.push({ name: params.frontmatter.title, item: pageUrl })
  }

  return crumbs.length ? crumbs : null
}

export const buildStructuredDataGraph = (params: StructuredDataParams) => {
  const { frontmatter, seoSnapshot, baseUrl, sections } = params
  const schemaTypes = Array.isArray(frontmatter.schemaTypes) ? frontmatter.schemaTypes : []
  const normalizedSchemaTypes = schemaTypes
    .map(type => (typeof type === 'string' ? type.trim() : ''))
    .filter((type): type is string => Boolean(type))

  if (!normalizedSchemaTypes.length) {
    return null
  }

  const pageUrl = resolveContentUrl(baseUrl, frontmatter.slug)
  const idBase = pageUrl || (params.contentId ? `urn:content:${params.contentId}` : null)
  const makeId = (suffix: string) => (idBase ? `${idBase}#${suffix}` : undefined)

  const imageMeta = frontmatter.featuredImage
  const imageId = imageMeta?.url ? makeId('primaryimage') : undefined
  const imageNode = imageMeta?.url
    ? {
        '@type': 'ImageObject',
        ...(imageId ? { '@id': imageId } : {}),
        'url': imageMeta.url,
        ...(imageMeta.width ? { width: imageMeta.width } : {}),
        ...(imageMeta.height ? { height: imageMeta.height } : {}),
        ...(imageMeta.alt ? { caption: imageMeta.alt } : {})
      }
    : null

  const author = params.author && params.author.name
    ? {
        '@type': 'Person',
        ...(makeId('author') ? { '@id': makeId('author') } : {}),
        'name': params.author.name,
        ...(params.author.url ? { url: params.author.url } : {}),
        ...(params.author.image ? { image: params.author.image } : {}),
        ...(params.author.sameAs?.length ? { sameAs: params.author.sameAs } : {})
      }
    : null

  const publisher = params.publisher && params.publisher.name
    ? {
        '@type': 'Organization',
        ...(makeId('publisher') ? { '@id': makeId('publisher') } : {}),
        'name': params.publisher.name,
        ...(params.publisher.url ? { url: params.publisher.url } : {}),
        ...(params.publisher.logoUrl
          ? {
              logo: {
                '@type': 'ImageObject',
                'url': params.publisher.logoUrl
              }
            }
          : {}),
        ...(params.publisher.sameAs?.length ? { sameAs: params.publisher.sameAs } : {})
      }
    : null

  const seoPlan = seoSnapshot && typeof seoSnapshot === 'object' ? seoSnapshot.plan : null
  const resolvedPublished = normalizeDate(seoPlan?.datePublished)
    || normalizeDate(params.datePublished)
    || null
  const resolvedModified = normalizeDate(params.dateModified) || null

  const blogPostingId = makeId('blogposting')
  const structuredData: Record<string, any> = {
    '@type': normalizedSchemaTypes.length === 1 ? normalizedSchemaTypes[0] : normalizedSchemaTypes,
    ...(blogPostingId ? { '@id': blogPostingId } : {})
  }

  // Basic article properties
  if (frontmatter.title) {
    structuredData.headline = frontmatter.title
  }
  if (frontmatter.description) {
    structuredData.description = frontmatter.description
  }
  if (frontmatter.primaryKeyword) {
    structuredData.keywords = frontmatter.primaryKeyword
  }
  if (Array.isArray(frontmatter.keywords) && frontmatter.keywords.length > 0) {
    const keywordEntries = frontmatter.keywords
      .map(keyword => typeof keyword === 'string' ? keyword.trim() : '')
      .filter((keyword): keyword is string => Boolean(keyword))
    const normalizedPrimary = typeof frontmatter.primaryKeyword === 'string'
      ? frontmatter.primaryKeyword.trim()
      : ''
    const hasPrimary = normalizedPrimary
      ? keywordEntries.includes(normalizedPrimary)
      : false
    const keywordsList = normalizedPrimary && !hasPrimary
      ? [normalizedPrimary, ...keywordEntries]
      : keywordEntries
    if (keywordsList.length) {
      structuredData.keywords = keywordsList.join(', ')
    }
  }

  const categoryNames = normalizeStringArray(frontmatter.categories)
  if (categoryNames.length) {
    structuredData.articleSection = categoryNames
  }

  if (resolvedPublished) {
    structuredData.datePublished = resolvedPublished
  }
  if (resolvedModified) {
    structuredData.dateModified = resolvedModified
  }

  if (pageUrl) {
    structuredData.url = pageUrl
  }

  const webPageId = makeId('webpage')
  if (webPageId || pageUrl) {
    structuredData.mainEntityOfPage = webPageId
      ? { '@id': webPageId }
      : { '@type': 'WebPage', '@id': pageUrl, 'url': pageUrl }
  }

  if (author) {
    structuredData.author = author['@id']
      ? { '@id': author['@id'] }
      : author
  }

  if (publisher) {
    structuredData.publisher = publisher['@id']
      ? { '@id': publisher['@id'] }
      : publisher
  }

  if (imageNode) {
    structuredData.image = imageNode['@id'] ? { '@id': imageNode['@id'] } : imageNode.url
  }

  const hasType = (typeName: string) => normalizedSchemaTypes.includes(typeName)

  if (hasType('Recipe')) {
    Object.assign(structuredData, buildRecipeStructuredData({ frontmatter, sections }))
  }

  if (hasType('HowTo')) {
    Object.assign(structuredData, buildHowToStructuredData({ frontmatter, sections }))
  }

  if (hasType('FAQPage')) {
    const manualFaqEntries = buildFaqEntriesFromMetadata(frontmatter.faq?.entries)
    const fallbackFaqEntries = buildFaqEntriesFromSections(sections)
    const faqEntries = manualFaqEntries.length ? manualFaqEntries : fallbackFaqEntries
    if (faqEntries.length) {
      structuredData.mainEntity = faqEntries
      if (frontmatter.faq?.description && !structuredData.description) {
        structuredData.description = frontmatter.faq.description
      }
    }
  }

  if (hasType('Course')) {
    const manualInstances = buildCourseInstancesFromMetadata(frontmatter.course?.modules)
    const fallbackInstances = buildCourseInstancesFromSections(sections)
    const courseInstances = manualInstances.length ? manualInstances : fallbackInstances
    if (courseInstances.length) {
      structuredData.hasCourseInstance = courseInstances
    }
    if (frontmatter.course?.courseCode) {
      structuredData.courseCode = frontmatter.course.courseCode
    }
    if (frontmatter.course?.providerName) {
      structuredData.provider = {
        '@type': 'Organization',
        'name': frontmatter.course.providerName,
        ...(frontmatter.course.providerUrl ? { sameAs: frontmatter.course.providerUrl } : {})
      }
    }
  }

  if (params.video && (params.video.thumbnailUrl || params.video.contentUrl || params.video.embedUrl)) {
    structuredData.video = {
      '@type': 'VideoObject',
      ...(params.video.name ? { name: params.video.name } : {}),
      ...(params.video.description ? { description: params.video.description } : {}),
      ...(params.video.thumbnailUrl ? { thumbnailUrl: params.video.thumbnailUrl } : {}),
      ...(params.video.uploadDate ? { uploadDate: params.video.uploadDate } : {}),
      ...(params.video.contentUrl ? { contentUrl: params.video.contentUrl } : {}),
      ...(params.video.embedUrl ? { embedUrl: params.video.embedUrl } : {}),
      ...(params.video.duration ? { duration: params.video.duration } : {})
    }
  }

  const resolvedBreadcrumbs = params.breadcrumbs && params.breadcrumbs.length
    ? params.breadcrumbs
    : buildAutoBreadcrumbs(params, pageUrl)
  const breadcrumbList = buildBreadcrumbList(resolvedBreadcrumbs)
  const graph: Record<string, any>[] = [structuredData]

  if (author && author['@id']) {
    graph.push(author)
  }
  if (publisher && publisher['@id']) {
    graph.push(publisher)
  }
  if (imageNode) {
    graph.push(imageNode)
  }

  if (webPageId || pageUrl) {
    const webPage: Record<string, any> = {
      '@type': 'WebPage',
      ...(webPageId ? { '@id': webPageId } : {}),
      ...(pageUrl ? { url: pageUrl } : {}),
      ...(frontmatter.title ? { name: frontmatter.title } : {}),
      ...(blogPostingId ? { mainEntity: { '@id': blogPostingId } } : {})
    }
    if (imageNode) {
      webPage.primaryImageOfPage = imageNode['@id'] ? { '@id': imageNode['@id'] } : imageNode.url
    }
    if (breadcrumbList) {
      webPage.breadcrumb = breadcrumbList
    }
    graph.push(webPage)
  } else if (breadcrumbList) {
    structuredData.breadcrumb = breadcrumbList
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph
  }
}

export const renderStructuredDataJsonLd = (structuredData: Record<string, any> | null) => {
  if (!structuredData) {
    return ''
  }
  const jsonLd = JSON.stringify(structuredData, null, 2)
  const escapedJsonLd = jsonLd.replace(/<\/script/gi, '<\\/script')
  return `<script type="application/ld+json">\n${escapedJsonLd}\n</script>`
}

export const generateStructuredDataJsonLd = (params: StructuredDataParams): string => {
  const structuredData = buildStructuredDataGraph({
    frontmatter: params.frontmatter,
    seoSnapshot: params.seoSnapshot,
    baseUrl: params.baseUrl,
    sections: params.sections,
    contentId: params.contentId ?? null,
    author: params.author ?? null,
    publisher: params.publisher ?? null,
    breadcrumbs: params.breadcrumbs ?? null,
    blog: params.blog ?? null,
    categories: params.categories ?? null,
    datePublished: params.datePublished ?? null,
    dateModified: params.dateModified ?? null,
    video: params.video ?? null
  })
  return renderStructuredDataJsonLd(structuredData)
}
