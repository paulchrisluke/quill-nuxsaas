import type {
  ChatCompletionToolCall,
  ChatCompletionToolDefinition
} from '~~/server/utils/aiGateway'

export type ToolKind = 'read' | 'write' | 'ingest'

export type ChatToolName = 'content_write' | 'edit_section' | 'source_ingest' | 'edit_metadata' | 'read_content' | 'read_section' | 'read_source' | 'read_content_list' | 'read_source_list' | 'read_workspace_summary' | 'analyze_content_images' | 'read_files' | 'insert_image'

export type ChatToolArguments<TName extends ChatToolName> =
  TName extends 'content_write'
    ? {
        action: 'create' | 'enrich'
        // For action='create':
        sourceContentId?: string | null
        sourceText?: string | null
        context?: string | null
        title?: string | null
        slug?: string | null
        status?: string | null
        primaryKeyword?: string | null
        targetLocale?: string | null
        contentType?: string | null
        systemPrompt?: string | null
        temperature?: number | null
        // For action='enrich':
        contentId?: string | null
        baseUrl?: string | null
      }
    : TName extends 'edit_section'
      ? {
          contentId: string
          sectionId?: string | null
          sectionTitle?: string | null
          instructions?: string | null
          temperature?: number | null
        }
      : TName extends 'source_ingest'
        ? {
            sourceType: 'youtube' | 'context'
            youtubeUrl?: string | null
            titleHint?: string | null
            context?: string | null
            title?: string | null
          }
        : TName extends 'edit_metadata'
          ? {
              contentId: string
              title?: string | null
              slug?: string | null
              status?: string | null
              primaryKeyword?: string | null
              targetLocale?: string | null
              contentType?: string | null
            }
          : TName extends 'read_content'
            ? {
                contentId: string
              }
            : TName extends 'read_section'
              ? {
                  contentId: string
                  sectionId: string
                }
              : TName extends 'read_source'
                ? {
                    sourceContentId: string
                  }
                : TName extends 'read_content_list'
                  ? {
                      status?: string | null
                      contentType?: string | null
                      limit?: number | null
                      offset?: number | null
                      orderBy?: 'updatedAt' | 'createdAt' | 'title' | null
                      orderDirection?: 'asc' | 'desc' | null
                    }
                  : TName extends 'read_source_list'
                    ? {
                        sourceType?: string | null
                        ingestStatus?: string | null
                        limit?: number | null
                        offset?: number | null
                        orderBy?: 'updatedAt' | 'createdAt' | 'title' | null
                        orderDirection?: 'asc' | 'desc' | null
                      }
                    : TName extends 'read_workspace_summary'
                      ? {
                          contentId: string
                        }
                      : TName extends 'analyze_content_images'
                        ? {
                            contentId: string
                          }
                        : TName extends 'read_files'
                          ? {
                              contentId?: string | null
                              fileType?: string | null
                              limit?: number | null
                            }
                          : TName extends 'insert_image'
                            ? {
                                contentId: string
                                fileId?: string | null
                                position?: string | number | null
                                altText?: string | null
                              }
                            : never

export interface ChatToolInvocation<TName extends ChatToolName = ChatToolName> {
  name: TName
  arguments: ChatToolArguments<TName>
}

type ParameterSchema = Record<string, any>

interface ToolDefinition {
  kind: ToolKind
  definition: ChatCompletionToolDefinition
}

const chatToolDefinitions: Record<ChatToolName, ToolDefinition> = {
  content_write: {
    kind: 'write',
    definition: {
      type: 'function',
      function: {
        name: 'content_write',
        description: 'Write or enrich content metadata. IMPORTANT: Use action="create" to create NEW content from source. Use action="enrich" ONLY to refresh frontmatter and JSON-LD structured data metadata (NOT for editing content sections). To edit content sections, use edit_section instead. To update metadata fields (title, slug, status), use edit_metadata instead.',
        parameters: buildContentWriteParameters()
      }
    }
  },
  edit_section: {
    kind: 'write',
    definition: {
      type: 'function',
      function: {
        name: 'edit_section',
        description: 'Edit a specific section of an existing content item using the user\'s instructions. This is the PRIMARY tool for modifying content sections. Requires a valid UUID contentId (use read_content_list to find content IDs). You can specify either sectionId or sectionTitle to identify which section to edit.',
        parameters: buildEditSectionParameters()
      }
    }
  },
  source_ingest: {
    kind: 'ingest',
    definition: {
      type: 'function',
      function: {
        name: 'source_ingest',
        description: 'Ingest source content from either a YouTube video or arbitrary context text. Use sourceType="youtube" to fetch captions from a YouTube video, or sourceType="context" to save pasted text as source content for content generation.',
        parameters: buildSourceIngestParameters()
      }
    }
  },
  edit_metadata: {
    kind: 'write',
    definition: {
      type: 'function',
      function: {
        name: 'edit_metadata',
        description: 'Update metadata fields (title, slug, status, primaryKeyword, targetLocale, contentType) for an existing content item. Use this for simple edits like "make the title shorter", "change the status", or "update the slug". This tool patches the existing content without creating a new version.',
        parameters: buildEditMetadataParameters()
      }
    }
  },
  read_content: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_content',
        description: 'Fetch a content item and its current version for inspection. Returns content metadata, version info, and sections. This is a read-only operation.',
        parameters: buildReadContentParameters()
      }
    }
  },
  read_section: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_section',
        description: 'Fetch a specific section of a content item for inspection. Returns section text and metadata. This is a read-only operation.',
        parameters: buildReadSectionParameters()
      }
    }
  },
  read_source: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_source',
        description: 'Fetch a source content item (e.g. context) for inspection. Returns source content info including context text and chunk metadata. This is a read-only operation.',
        parameters: buildReadSourceParameters()
      }
    }
  },
  read_content_list: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_content_list',
        description: 'List content items with optional filtering. Returns a paginated list of content items with metadata. This is a read-only operation.',
        parameters: buildReadContentListParameters()
      }
    }
  },
  read_source_list: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_source_list',
        description: 'List source content items (YouTube videos, manual context, etc.) with optional filtering. Returns a paginated list of source content. This is a read-only operation.',
        parameters: buildReadSourceListParameters()
      }
    }
  },
  read_workspace_summary: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_workspace_summary',
        description: 'Get a formatted summary of a content workspace. Returns a human-readable summary of the content, its version, sections, and source. This is a read-only operation.',
        parameters: buildReadWorkspaceSummaryParameters()
      }
    }
  },
  analyze_content_images: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'analyze_content_images',
        description: 'Analyze a content item to propose where images would improve clarity and engagement. Returns suggestions with sectionId, line position, alt text, reason, and priority without modifying content.',
        parameters: buildAnalyzeContentImagesParameters()
      }
    }
  },
  read_files: {
    kind: 'read',
    definition: {
      type: 'function',
      function: {
        name: 'read_files',
        description: 'List uploaded files for the current organization so you can reference user-provided assets. Use this to find file IDs by filename or filter by contentId or fileType.',
        parameters: buildReadFilesParameters()
      }
    }
  },
  insert_image: {
    kind: 'write',
    definition: {
      type: 'function',
      function: {
        name: 'insert_image',
        description: 'Insert an uploaded image into a content item at a specified position. Provide the contentId, fileId, and optionally a position (line number, sectionId, or natural language like "above the conclusion") plus alt text.',
        parameters: buildInsertImageParameters()
      }
    }
  }
}

function buildContentWriteParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'enrich'],
        description: 'Action to perform: "create" to create new content from source, or "enrich" to refresh existing content\'s frontmatter and JSON-LD metadata ONLY. Note: "enrich" does NOT edit content sections - use edit_section for that.'
      },
      // For action='create':
      sourceContentId: {
        type: 'string',
        description: 'Source content ID to generate from (required for action="create" if no sourceText/context).'
      },
      sourceText: {
        type: 'string',
        description: 'Inline source text to use directly for generation (for action="create"). If provided without sourceContentId, will create source content first.'
      },
      context: {
        type: 'string',
        description: 'Alias for sourceText (for action="create"). Raw context text to use for generating content. If both sourceText and context are provided, sourceText takes precedence.'
      },
      title: {
        type: 'string',
        description: 'Optional working title for the content item (for action="create").'
      },
      slug: {
        type: 'string',
        description: 'Optional slug for the content item (for action="create").'
      },
      status: {
        type: 'string',
        description: 'Desired content status (draft, review, published, etc.) (for action="create").'
      },
      primaryKeyword: {
        type: 'string',
        description: 'Primary keyword for SEO (for action="create").'
      },
      targetLocale: {
        type: 'string',
        description: 'Target locale (e.g., en-US) (for action="create").'
      },
      contentType: {
        type: 'string',
        description: 'Content type identifier (blog_post, newsletter, etc.) (for action="create").'
      },
      systemPrompt: {
        type: 'string',
        description: 'Custom system prompt overrides when the user provides style guidance (for action="create").'
      },
      temperature: {
        type: 'number',
        minimum: 0,
        maximum: 2,
        description: 'Sampling temperature for creative control (default 1) (for action="create").'
      },
      // For action='enrich':
      contentId: {
        type: 'string',
        description: 'Content ID (UUID format) of the content item (required for action="enrich"). Must be a valid UUID - use read_content_list to find content IDs.'
      },
      baseUrl: {
        type: 'string',
        description: 'Optional base URL for generating absolute URLs in JSON-LD structured data (for action="enrich").'
      }
    },
    required: ['action']
  }
}

function buildEditSectionParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID (UUID format) of the content item to edit. Must be a valid UUID - use read_content_list to find content IDs.'
      },
      sectionId: {
        type: 'string',
        description: 'Unique identifier of the section to patch.'
      },
      sectionTitle: {
        type: 'string',
        description: 'Human readable section title when no sectionId is present.'
      },
      instructions: {
        type: 'string',
        description: 'User instructions describing the requested edits.'
      },
      temperature: {
        type: 'number',
        minimum: 0,
        maximum: 2
      }
    },
    required: ['contentId']
  }
}

function buildSourceIngestParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      sourceType: {
        type: 'string',
        enum: ['youtube', 'context'],
        description: 'Type of source to ingest. Use "youtube" to fetch captions from a YouTube video, or "context" to save pasted text as source content.'
      },
      youtubeUrl: {
        type: 'string',
        description: 'YouTube video URL to ingest (required if sourceType="youtube"). Example: https://www.youtube.com/watch?v=VIDEO_ID or https://youtu.be/VIDEO_ID.'
      },
      titleHint: {
        type: 'string',
        description: 'Optional title hint for YouTube source content (only used when sourceType="youtube").'
      },
      context: {
        type: 'string',
        description: 'Raw context text to save as source content (required if sourceType="context").'
      },
      title: {
        type: 'string',
        description: 'Optional title for context source content (only used when sourceType="context").'
      }
    },
    required: ['sourceType']
  }
}

function buildEditMetadataParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID (UUID format) of the content item to update. Must be a valid UUID - use read_content_list to find content IDs.'
      },
      title: {
        type: 'string',
        description: 'New title for the content item.'
      },
      slug: {
        type: 'string',
        description: 'New slug for the content item (will be auto-slugified).'
      },
      status: {
        type: 'string',
        description: 'New status (draft, in_review, ready_for_publish, published, archived).'
      },
      primaryKeyword: {
        type: 'string',
        description: 'New primary keyword for SEO.'
      },
      targetLocale: {
        type: 'string',
        description: 'New target locale (e.g., en-US, es-ES).'
      },
      contentType: {
        type: 'string',
        description: 'New content type (blog_post, newsletter, etc.).'
      }
    },
    required: ['contentId']
  }
}

function buildReadContentParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID (UUID format) of the content item to read. Must be a valid UUID - use read_content_list to find content IDs.'
      }
    },
    required: ['contentId']
  }
}

function buildReadSectionParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID (UUID format) of the content item to read. Must be a valid UUID - use read_content_list to find content IDs.'
      },
      sectionId: {
        type: 'string',
        description: 'ID of the section to read.'
      }
    },
    required: ['contentId', 'sectionId']
  }
}

function buildReadSourceParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      sourceContentId: {
        type: 'string',
        description: 'ID of the source content to read.'
      }
    },
    required: ['sourceContentId']
  }
}

function buildReadContentListParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by content status (draft, in_review, ready_for_publish, published, archived).'
      },
      contentType: {
        type: 'string',
        description: 'Filter by content type (blog_post, newsletter, etc.).'
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of items to return (default: 20, max: 100).'
      },
      offset: {
        type: 'number',
        minimum: 0,
        description: 'Number of items to skip for pagination (default: 0).'
      },
      orderBy: {
        type: 'string',
        enum: ['updatedAt', 'createdAt', 'title'],
        description: 'Field to sort by (default: updatedAt).'
      },
      orderDirection: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction (default: desc).'
      }
    }
  }
}

function buildReadSourceListParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      sourceType: {
        type: 'string',
        description: 'Filter by source type (youtube, context, etc.).'
      },
      ingestStatus: {
        type: 'string',
        description: 'Filter by ingest status (ingested, ingesting, failed, etc.).'
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of items to return (default: 20, max: 100).'
      },
      offset: {
        type: 'number',
        minimum: 0,
        description: 'Number of items to skip for pagination (default: 0).'
      },
      orderBy: {
        type: 'string',
        enum: ['updatedAt', 'createdAt', 'title'],
        description: 'Field to sort by (default: updatedAt).'
      },
      orderDirection: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort direction (default: desc).'
      }
    }
  }
}

function buildReadWorkspaceSummaryParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID (UUID format) of the content item to summarize. Must be a valid UUID - use read_content_list to find content IDs.'
      }
    },
    required: ['contentId']
  }
}

function buildAnalyzeContentImagesParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID (UUID format) of the content item to analyze for image opportunities. Use read_content_list to find IDs.'
      }
    },
    required: ['contentId']
  }
}

function buildReadFilesParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Optional content ID (UUID) to filter files linked to a specific content item.'
      },
      fileType: {
        type: 'string',
        description: 'Optional file type filter (e.g., "image").'
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of files to return (default: 20, max: 100).'
      }
    }
  }
}

function buildInsertImageParameters(): ParameterSchema {
  return {
    type: 'object',
    properties: {
      contentId: {
        type: 'string',
        description: 'Content ID (UUID format) where the image should be inserted.'
      },
      fileId: {
        type: 'string',
        description: 'Optional file ID of the uploaded image to insert. If omitted, the latest image attached to the content will be used.'
      },
      position: {
        type: ['string', 'number'],
        description: 'Where to insert the image: a line number, a sectionId, or natural language like "above the conclusion" or "as the featured image".'
      },
      altText: {
        type: 'string',
        description: 'Optional alt text for the image.'
      }
    },
    required: ['contentId']
  }
}

function safeParseArguments(input: string): Record<string, any> | null {
  try {
    return input ? JSON.parse(input) : {}
  } catch (error) {
    console.warn('Failed to parse tool call arguments', error)
    return null
  }
}

export function getChatToolDefinitions(): ChatCompletionToolDefinition[] {
  return Object.values(chatToolDefinitions).map(tool => tool.definition)
}

export function getToolKind(toolName: ChatToolName): ToolKind {
  return chatToolDefinitions[toolName]?.kind ?? 'write'
}

export function getToolsByKind(kind: ToolKind): ChatCompletionToolDefinition[] {
  return Object.entries(chatToolDefinitions)
    .filter(([_, tool]) => tool.kind === kind)
    .map(([_, tool]) => tool.definition)
}

/**
 * Checks if a tool is allowed in the given mode.
 * Chat mode only allows read tools; agent mode allows all tools.
 */
export function isToolAllowedInMode(toolName: ChatToolName, mode: 'chat' | 'agent'): boolean {
  const toolKind = getToolKind(toolName)

  // Enforce read-only in chat mode
  if (mode === 'chat' && (toolKind === 'write' || toolKind === 'ingest')) {
    return false
  }

  return true
}

/**
 * Generates the error message for when a tool is not available in chat mode.
 */
export function getModeEnforcementError(toolName: ChatToolName): string {
  return `Tool "${toolName}" is not available in chat mode (it can modify content or ingest new data). Switch to agent mode.`
}

export function parseChatToolCall(toolCall: ChatCompletionToolCall): ChatToolInvocation | null {
  const args = safeParseArguments(toolCall.function.arguments || '{}')
  if (!args) {
    return null
  }

  if (toolCall.function.name === 'content_write') {
    const { type: _omit, ...rest } = args
    const invocation = rest as ChatToolInvocation<'content_write'>['arguments']

    // Runtime validation for conditional requirements
    if (invocation.action === 'create') {
      const hasSource = !!(invocation.sourceContentId || invocation.sourceText || invocation.context)
      if (!hasSource) {
        console.error('[Tool Validation] content_write with action="create" requires at least one of: sourceContentId, sourceText, or context')
        return null
      }
    } else if (invocation.action === 'enrich') {
      if (!invocation.contentId) {
        console.error('[Tool Validation] content_write with action="enrich" requires contentId')
        return null
      }
    }

    return {
      name: 'content_write',
      arguments: invocation
    }
  }

  if (toolCall.function.name === 'edit_section') {
    const { type: _omit, ...rest } = args
    return {
      name: 'edit_section',
      arguments: rest as ChatToolInvocation<'edit_section'>['arguments']
    }
  }

  if (toolCall.function.name === 'source_ingest') {
    const { type: _omit, ...rest } = args
    const invocation = rest as ChatToolInvocation<'source_ingest'>['arguments']

    // Runtime validation for conditional requirements
    if (invocation.sourceType === 'youtube') {
      if (!invocation.youtubeUrl) {
        console.error('[Tool Validation] source_ingest with sourceType="youtube" requires youtubeUrl')
        return null
      }
    } else if (invocation.sourceType === 'context') {
      if (!invocation.context) {
        console.error('[Tool Validation] source_ingest with sourceType="context" requires context')
        return null
      }
    }

    return {
      name: 'source_ingest',
      arguments: invocation
    }
  }

  if (toolCall.function.name === 'edit_metadata') {
    const { type: _omit, ...rest } = args
    return {
      name: 'edit_metadata',
      arguments: rest as ChatToolInvocation<'edit_metadata'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_content') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_content',
      arguments: rest as ChatToolInvocation<'read_content'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_section') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_section',
      arguments: rest as ChatToolInvocation<'read_section'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_source') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_source',
      arguments: rest as ChatToolInvocation<'read_source'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_content_list') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_content_list',
      arguments: rest as ChatToolInvocation<'read_content_list'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_source_list') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_source_list',
      arguments: rest as ChatToolInvocation<'read_source_list'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_workspace_summary') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_workspace_summary',
      arguments: rest as ChatToolInvocation<'read_workspace_summary'>['arguments']
    }
  }

  if (toolCall.function.name === 'analyze_content_images') {
    const { type: _omit, ...rest } = args
    return {
      name: 'analyze_content_images',
      arguments: rest as ChatToolInvocation<'analyze_content_images'>['arguments']
    }
  }

  if (toolCall.function.name === 'read_files') {
    const { type: _omit, ...rest } = args
    return {
      name: 'read_files',
      arguments: rest as ChatToolInvocation<'read_files'>['arguments']
    }
  }

  if (toolCall.function.name === 'insert_image') {
    const { type: _omit, ...rest } = args
    const invocation = rest as ChatToolInvocation<'insert_image'>['arguments']
    if (!invocation.fileId) {
      console.warn('[Tool Validation] insert_image called without fileId; falling back to latest image linked to content.')
    }
    return {
      name: 'insert_image',
      arguments: invocation
    }
  }

  return null
}
