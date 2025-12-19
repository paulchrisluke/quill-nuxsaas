import { describe, expect, it } from 'vitest'
import { parseReferences } from '~~/server/services/chat/references/parser'

describe('parseReferences', () => {
  it('parses references with punctuation and anchors', () => {
    const message = 'Add @image.jpg, then update @classic-gingerbread-cookies:conclusion.'
    const tokens = parseReferences(message)

    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({
      raw: '@image.jpg',
      identifier: 'image.jpg'
    })
    expect(tokens[1]).toMatchObject({
      raw: '@classic-gingerbread-cookies:conclusion',
      identifier: 'classic-gingerbread-cookies',
      anchor: { kind: 'colon', value: 'conclusion' }
    })

    const firstIndex = message.indexOf('@image.jpg')
    expect(tokens[0].startIndex).toBe(firstIndex)
    expect(tokens[0].endIndex).toBe(firstIndex + '@image.jpg'.length)
  })

  it('ignores email addresses', () => {
    const message = 'Contact me at name@example.com for details.'
    const tokens = parseReferences(message)
    expect(tokens).toHaveLength(0)
  })

  it('parses multiple references with hashes', () => {
    const message = 'Rewrite @post-slug#section-123 and @source:manual-transcript.'
    const tokens = parseReferences(message)

    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({
      raw: '@post-slug#section-123',
      identifier: 'post-slug',
      anchor: { kind: 'hash', value: 'section-123' }
    })
    expect(tokens[1]).toMatchObject({
      raw: '@source:manual-transcript',
      identifier: 'source:manual-transcript'
    })
  })
})
