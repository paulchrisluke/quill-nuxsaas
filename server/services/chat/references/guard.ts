/* eslint-disable perfectionist/sort-imports */
import type { ReferenceScope, ResolvedReference } from './types'
import type { ChatToolInvocation } from '../tools'
import { getModeEnforcementError, isToolAllowedInMode } from '../tools'

const NO_REFERENCE_ERROR = 'I can\'t edit that because it wasn\'t referenced. Add @<thing> to scope this edit.'

export const buildReferenceScope = (resolved: ResolvedReference[]): ReferenceScope => {
  const allowedContentIds = new Set<string>()
  const allowedSectionIds = new Set<string>()
  const allowedFileIds = new Set<string>()

  for (const reference of resolved) {
    if (reference.type === 'content') {
      allowedContentIds.add(reference.id)
    } else if (reference.type === 'section') {
      allowedSectionIds.add(reference.id)
    } else if (reference.type === 'file') {
      allowedFileIds.add(reference.id)
    }
  }

  return { allowedContentIds, allowedSectionIds, allowedFileIds }
}

export const getReferenceScopeError = (
  toolInvocation: ChatToolInvocation,
  params: { mode: 'chat' | 'agent', scope?: ReferenceScope }
): string | null => {
  const { mode, scope } = params

  if (!isToolAllowedInMode(toolInvocation.name, mode)) {
    return getModeEnforcementError(toolInvocation.name)
  }

  if (mode === 'chat') {
    return null
  }

  const allowedContentIds = scope?.allowedContentIds ?? new Set()
  const allowedSectionIds = scope?.allowedSectionIds ?? new Set()
  const allowedFileIds = scope?.allowedFileIds ?? new Set()

  if (toolInvocation.name === 'edit_section') {
    const args = toolInvocation.arguments as ChatToolInvocation<'edit_section'>['arguments']
    if (!args.sectionId || !allowedSectionIds.has(args.sectionId)) {
      return NO_REFERENCE_ERROR
    }
    return null
  }

  if (toolInvocation.name === 'edit_metadata') {
    const args = toolInvocation.arguments as ChatToolInvocation<'edit_metadata'>['arguments']
    if (!allowedContentIds.has(args.contentId)) {
      return NO_REFERENCE_ERROR
    }
    return null
  }

  if (toolInvocation.name === 'content_write') {
    const args = toolInvocation.arguments as ChatToolInvocation<'content_write'>['arguments']
    if (!args.contentId || !allowedContentIds.has(args.contentId)) {
      return NO_REFERENCE_ERROR
    }
    return null
  }

  if (toolInvocation.name === 'insert_image') {
    const args = toolInvocation.arguments as ChatToolInvocation<'insert_image'>['arguments']
    if (!allowedContentIds.has(args.contentId) || !allowedFileIds.has(args.fileId)) {
      return NO_REFERENCE_ERROR
    }
    return null
  }

  return null
}
