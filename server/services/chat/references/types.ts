export interface ReferenceAnchor {
  kind: 'hash' | 'colon'
  value: string
}

export interface ReferenceToken {
  raw: string
  identifier: string
  anchor?: ReferenceAnchor
  startIndex: number
  endIndex: number
}

export type ReferenceResolutionReason = 'not_found' | 'section_not_found' | 'permission' | 'invalid'

export interface ReferenceCandidate {
  type: 'file' | 'content' | 'section' | 'source'
  id: string
  label: string
  subtitle?: string
  reference: string
}

export interface AmbiguousReference {
  token: ReferenceToken
  candidates: ReferenceCandidate[]
}

export interface UnresolvedReference {
  token: ReferenceToken
  reason: ReferenceResolutionReason
  suggestions?: ReferenceCandidate[]
}

export interface ResolvedFileMetadata {
  id: string
  originalName: string
  fileName: string
  fileType: string
  mimeType: string
  size: number
  url: string
}

export interface ResolvedContentMetadata {
  id: string
  slug: string
  title: string
  status: string
}

export interface ResolvedSectionMetadata {
  sectionId: string
  title?: string | null
  type?: string | null
  index?: number | null
  contentId: string
  contentSlug: string
  contentTitle: string
}

export interface ResolvedSourceMetadata {
  id: string
  title?: string | null
  sourceType?: string | null
}

export type ResolvedReference =
  | {
    type: 'file'
    id: string
    token: ReferenceToken
    metadata: ResolvedFileMetadata
  }
  | {
    type: 'content'
    id: string
    token: ReferenceToken
    metadata: ResolvedContentMetadata
  }
  | {
    type: 'section'
    id: string
    contentId: string
    token: ReferenceToken
    metadata: ResolvedSectionMetadata
  }
  | {
    type: 'source'
    id: string
    token: ReferenceToken
    metadata: ResolvedSourceMetadata
  }

export type ReferenceContent =
  | {
    type: 'file'
    token: ReferenceToken
    metadata: ResolvedFileMetadata
    textContent?: string
    truncated?: boolean
  }
  | {
    type: 'content'
    token: ReferenceToken
    metadata: ResolvedContentMetadata
    frontmatterSummary?: Record<string, any> | null
    sectionsSummary: Array<{
      id: string
      title?: string | null
      type?: string | null
      index?: number | null
    }>
  }
  | {
    type: 'section'
    token: ReferenceToken
    metadata: ResolvedSectionMetadata
    body: string
  }
  | {
    type: 'source'
    token: ReferenceToken
    metadata: ResolvedSourceMetadata
    textContent?: string
    truncated?: boolean
  }

export interface ReferenceResolutionResult {
  tokens: ReferenceToken[]
  resolved: ResolvedReference[]
  unresolved: UnresolvedReference[]
  ambiguous: AmbiguousReference[]
}

export interface ReferenceScope {
  allowedContentIds: Set<string>
  allowedSectionIds: Set<string>
  allowedFileIds: Set<string>
}

export interface ReferenceSelection {
  type: 'file' | 'content' | 'section' | 'source'
  id: string
  label?: string
  identifier?: string
  contentId?: string | null
}

export interface ContentSection {
  id?: string
  section_id?: string
  title?: string
  type?: string
  index?: number
}
