import { describe, expect, it } from 'vitest'
import { _testing } from '~~/server/services/chat/references/resolver'

describe('resolveReferences matching', () => {
  const candidates = [
    { id: '1', slug: 'classic-gingerbread-cookies' },
    { id: '2', slug: 'classic-chocolate-cake' },
    { id: '3', slug: 'gingerbread-basics' }
  ]

  it('prefers exact matches', () => {
    const result = _testing.selectBestMatch('gingerbread-basics', candidates, item => [item.slug])
    expect(result.match?.id).toBe('3')
    expect(result.ambiguous).toHaveLength(0)
  })

  it('reports ambiguity for prefix matches', () => {
    const result = _testing.selectBestMatch('classic', candidates, item => [item.slug])
    expect(result.match).toBeNull()
    expect(result.ambiguous.map(item => item.id)).toEqual(['1', '2'])
  })

  it('falls back to substring matches', () => {
    const result = _testing.selectBestMatch('gingerbread', candidates, item => [item.slug])
    expect(result.match?.id).toBe('3')
  })
})
