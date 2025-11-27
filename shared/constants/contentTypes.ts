export const CONTENT_TYPES = [
  'blog_post',
  'recipe',
  'faq_page',
  'course',
  'how_to'
] as const

export type ContentType = typeof CONTENT_TYPES[number]

export const DEFAULT_CONTENT_TYPE: ContentType = 'blog_post'

export interface ContentTypeOption {
  value: ContentType
  label: string
  description: string
  icon: string
}

export const CONTENT_TYPE_OPTIONS: ContentTypeOption[] = [
  {
    value: 'blog_post',
    label: 'Standard blog',
    description: 'General blog article with SEO-ready structure.',
    icon: 'i-lucide-file-text'
  },
  {
    value: 'recipe',
    label: 'Recipe schema',
    description: 'Include ingredients, steps, cook times, and tips.',
    icon: 'i-lucide-cookie'
  },
  {
    value: 'faq_page',
    label: 'FAQ schema',
    description: 'Question-and-answer blocks for top customer asks.',
    icon: 'i-lucide-help-circle'
  },
  {
    value: 'course',
    label: 'Course schema',
    description: 'Module and lesson structure for educational content.',
    icon: 'i-lucide-graduation-cap'
  },
  {
    value: 'how_to',
    label: 'How-to schema',
    description: 'Step-by-step walkthroughs with required materials.',
    icon: 'i-lucide-list-checks'
  }
]
