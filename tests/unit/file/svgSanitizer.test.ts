import { describe, it, expect } from 'vitest'
import { sanitizeSVG, isSVGSafe } from '~~/server/services/file/svgSanitizer'

describe('SVG Sanitizer', () => {
  describe('sanitizeSVG', () => {
    it('should accept a clean SVG without modifications', () => {
      const cleanSVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40"/></svg>'
      const result = sanitizeSVG(cleanSVG)

      expect(result.isValid).toBe(true)
      expect(result.warnings).toHaveLength(0)
      expect(result.sanitized).toContain('<svg')
      expect(result.sanitized).toContain('<circle')
    })

    it('should remove <script> tags', () => {
      const maliciousSVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script><circle cx="50" cy="50" r="40"/></svg>'
      const result = sanitizeSVG(maliciousSVG)

      expect(result.isValid).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some(w => w.includes('<script>'))).toBe(true)
      expect(result.sanitized).not.toContain('<script>')
      expect(result.sanitized).not.toContain('alert("XSS")')
      expect(result.sanitized).toContain('<circle')
    })

    it('should remove multiple <script> tags', () => {
      const maliciousSVG = '<svg><script>alert(1)</script><circle/><script>alert(2)</script></svg>'
      const result = sanitizeSVG(maliciousSVG)

      expect(result.isValid).toBe(true)
      expect(result.warnings.some(w => w.includes('2') && w.includes('<script>'))).toBe(true)
      expect(result.sanitized).not.toMatch(/<script/i)
    })

    it('should remove <foreignObject> elements', () => {
      const maliciousSVG = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject><circle cx="50" cy="50" r="40"/></svg>'
      const result = sanitizeSVG(maliciousSVG)

      expect(result.isValid).toBe(true)
      expect(result.warnings.some(w => w.includes('foreignObject'))).toBe(true)
      expect(result.sanitized).not.toContain('<foreignObject')
      expect(result.sanitized).not.toContain('<iframe')
      expect(result.sanitized).toContain('<circle')
    })

    it('should remove inline event handlers', () => {
      const maliciousSVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" onclick="alert(\'XSS\')" onload="evil()"/></svg>'
      const result = sanitizeSVG(maliciousSVG)

      expect(result.isValid).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.sanitized).not.toContain('onclick')
      expect(result.sanitized).not.toContain('onload')
      expect(result.sanitized).not.toContain('alert')
      expect(result.sanitized).toContain('<circle')
    })

    it('should remove dangerous attributes like href', () => {
      const maliciousSVG = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><circle cx="50" cy="50" r="40"/></a></svg>'
      const result = sanitizeSVG(maliciousSVG)

      expect(result.isValid).toBe(true)
      expect(result.warnings.some(w => w.includes('href'))).toBe(true)
      expect(result.sanitized).not.toContain('href=')
      expect(result.sanitized).not.toContain('javascript:')
    })

    it('should remove xlink:href attributes', () => {
      const maliciousSVG = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="javascript:alert(1)"/></svg>'
      const result = sanitizeSVG(maliciousSVG)

      expect(result.isValid).toBe(true)
      expect(result.warnings.some(w => w.includes('xlink:href'))).toBe(true)
      expect(result.sanitized).not.toContain('xlink:href')
    })

    it('should handle various quote styles in attributes', () => {
      const maliciousSVG1 = '<svg><circle onclick="alert(1)"/></svg>'
      const maliciousSVG2 = "<svg><circle onclick='alert(1)'/></svg>"
      const maliciousSVG3 = '<svg><circle onclick=alert(1)/></svg>'

      const result1 = sanitizeSVG(maliciousSVG1)
      const result2 = sanitizeSVG(maliciousSVG2)
      const result3 = sanitizeSVG(maliciousSVG3)

      expect(result1.isValid).toBe(true)
      expect(result2.isValid).toBe(true)
      expect(result3.isValid).toBe(true)

      expect(result1.sanitized).not.toContain('onclick')
      expect(result2.sanitized).not.toContain('onclick')
      expect(result3.sanitized).not.toContain('onclick')
    })

    it('should reject invalid SVG that does not contain <svg> tag', () => {
      const invalidSVG = '<div>Not an SVG</div>'
      const result = sanitizeSVG(invalidSVG)

      expect(result.isValid).toBe(false)
      expect(result.warnings.some(w => w.includes('valid SVG'))).toBe(true)
    })

    it('should reject SVG that becomes invalid after sanitization', () => {
      // This would be a case where sanitization removes everything except the script tag
      // After removing script, there's no <svg> tag left
      const maliciousSVG = '<script>alert(1)</script>'
      const result = sanitizeSVG(maliciousSVG)

      expect(result.isValid).toBe(false)
      expect(result.warnings.some(w => w.includes('structure invalid') || w.includes('valid SVG'))).toBe(true)
    })

    it('should handle case-insensitive dangerous elements', () => {
      const maliciousSVG1 = '<svg><SCRIPT>alert(1)</SCRIPT></svg>'
      const maliciousSVG2 = '<svg><ForeignObject>test</ForeignObject></svg>'
      const maliciousSVG3 = '<svg><FOREIGNOBJECT>test</FOREIGNOBJECT></svg>'

      const result1 = sanitizeSVG(maliciousSVG1)
      const result2 = sanitizeSVG(maliciousSVG2)
      const result3 = sanitizeSVG(maliciousSVG3)

      expect(result1.isValid).toBe(true)
      expect(result2.isValid).toBe(true)
      expect(result3.isValid).toBe(true)

      expect(result1.sanitized).not.toMatch(/<script/i)
      expect(result2.sanitized).not.toMatch(/foreignobject/i)
      expect(result3.sanitized).not.toMatch(/foreignobject/i)
    })

    it('should preserve safe SVG structure and attributes', () => {
      const safeSVG = `
        <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="red" stroke="black" stroke-width="2"/>
          <text x="50" y="50" text-anchor="middle" fill="white">Hello</text>
        </svg>
      `
      const result = sanitizeSVG(safeSVG)

      expect(result.isValid).toBe(true)
      expect(result.warnings).toHaveLength(0)
      expect(result.sanitized).toContain('<svg')
      expect(result.sanitized).toContain('<circle')
      expect(result.sanitized).toContain('<text')
      expect(result.sanitized).toContain('fill="red"')
      expect(result.sanitized).toContain('stroke="black"')
    })

    it('should handle complex malicious SVG with multiple attack vectors', () => {
      const complexMaliciousSVG = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <script>alert('XSS1')</script>
          <circle onclick="alert('XSS2')" onload="evil()"/>
          <foreignObject>
            <iframe src="javascript:alert('XSS3')"></iframe>
          </foreignObject>
          <a href="javascript:alert('XSS4')">Click me</a>
          <use xlink:href="javascript:alert('XSS5')"/>
        </svg>
      `
      const result = sanitizeSVG(complexMaliciousSVG)

      expect(result.isValid).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)

      // Check all attack vectors are removed
      expect(result.sanitized).not.toMatch(/<script/i)
      expect(result.sanitized).not.toMatch(/onclick/i)
      expect(result.sanitized).not.toMatch(/onload/i)
      expect(result.sanitized).not.toMatch(/foreignobject/i)
      expect(result.sanitized).not.toMatch(/href/i)
      expect(result.sanitized).not.toContain('javascript:')
      expect(result.sanitized).not.toContain('alert')
    })
  })

  describe('isSVGSafe', () => {
    it('should return true for clean SVG', () => {
      const cleanSVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40"/></svg>'
      expect(isSVGSafe(cleanSVG)).toBe(true)
    })

    it('should return false for SVG with script tag', () => {
      const maliciousSVG = '<svg><script>alert(1)</script></svg>'
      expect(isSVGSafe(maliciousSVG)).toBe(false)
    })

    it('should return false for SVG with event handlers', () => {
      const maliciousSVG = '<svg><circle onclick="alert(1)"/></svg>'
      expect(isSVGSafe(maliciousSVG)).toBe(false)
    })

    it('should return false for SVG with foreignObject', () => {
      const maliciousSVG = '<svg><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg>'
      expect(isSVGSafe(maliciousSVG)).toBe(false)
    })

    it('should return false for SVG with javascript: protocol', () => {
      const maliciousSVG = '<svg><a href="javascript:alert(1)">Link</a></svg>'
      expect(isSVGSafe(maliciousSVG)).toBe(false)
    })

    it('should return false for invalid SVG', () => {
      const invalidSVG = '<div>Not an SVG</div>'
      expect(isSVGSafe(invalidSVG)).toBe(false)
    })

    it('should return true for sanitized SVG that was originally malicious', () => {
      const maliciousSVG = '<svg><script>alert(1)</script><circle/></svg>'
      const sanitized = sanitizeSVG(maliciousSVG)

      // After sanitization, it should be safe
      expect(isSVGSafe(sanitized.sanitized)).toBe(true)
    })
  })
})
