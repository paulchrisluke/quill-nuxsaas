import type { ChatToolInvocation } from '~~/server/services/chat/tools'
import { describe, expect, it } from 'vitest'
import { buildReferenceScope, getReferenceScopeError } from '~~/server/services/chat/references/guard'

describe('reference scope enforcement', () => {
  it('blocks write tools in chat mode', () => {
    const toolInvocation: ChatToolInvocation<'edit_metadata'> = {
      name: 'edit_metadata',
      arguments: { contentId: 'content-123', title: 'New title' }
    }

    const error = getReferenceScopeError(toolInvocation, { mode: 'chat', scope: buildReferenceScope([]) })
    expect(error).toContain('not available in chat mode')
  })

  it('blocks edits when content is not referenced in agent mode', () => {
    const toolInvocation: ChatToolInvocation<'edit_metadata'> = {
      name: 'edit_metadata',
      arguments: { contentId: 'content-123', title: 'New title' }
    }

    const error = getReferenceScopeError(toolInvocation, { mode: 'agent', scope: buildReferenceScope([]) })
    expect(error).toContain('wasn\'t referenced')
  })

  it('allows scoped edits in agent mode', () => {
    const toolInvocation: ChatToolInvocation<'edit_metadata'> = {
      name: 'edit_metadata',
      arguments: { contentId: 'content-123', title: 'New title' }
    }

    const scope = buildReferenceScope([
      {
        type: 'content',
        id: 'content-123',
        token: { raw: '@post', identifier: 'post', startIndex: 0, endIndex: 5 },
        metadata: { slug: 'post', title: 'Post', status: 'draft' }
      }
    ])

    const error = getReferenceScopeError(toolInvocation, { mode: 'agent', scope })
    expect(error).toBeNull()
  })

  it('requires section references for edit_section', () => {
    const toolInvocation: ChatToolInvocation<'edit_section'> = {
      name: 'edit_section',
      arguments: { contentId: 'content-123', sectionId: 'section-1', instructions: 'Rewrite' }
    }

    const scope = buildReferenceScope([
      {
        type: 'content',
        id: 'content-123',
        token: { raw: '@post', identifier: 'post', startIndex: 0, endIndex: 5 },
        metadata: { slug: 'post', title: 'Post', status: 'draft' }
      }
    ])

    const error = getReferenceScopeError(toolInvocation, { mode: 'agent', scope })
    expect(error).toContain('wasn\'t referenced')
  })
})
