/**
 * SVG Sanitization Utility
 *
 * Sanitizes SVG files to prevent XSS attacks by:
 * - Removing <script> tags
 * - Removing inline event handlers (onclick, onload, etc.)
 * - Removing <foreignObject> elements
 * - Removing dangerous attributes
 * - Validating SVG structure
 */

export interface SanitizeResult {
  sanitized: string
  isValid: boolean
  warnings: string[]
}

/**
 * List of dangerous SVG attributes that can execute JavaScript
 * Note: href and xlink:href are handled separately to only remove dangerous protocols
 */
const DANGEROUS_ATTRIBUTES = [
  'onabort',
  'onactivate',
  'onbegin',
  'onclick',
  'onend',
  'onerror',
  'onfocusin',
  'onfocusout',
  'onload',
  'onmousedown',
  'onmousemove',
  'onmouseout',
  'onmouseover',
  'onmouseup',
  'onrepeat',
  'onresize',
  'onscroll',
  'onunload',
  'onzoom'
]

/**
 * List of dangerous SVG elements
 */
const DANGEROUS_ELEMENTS = [
  'script',
  'foreignobject',
  'foreignObject'
]

/**
 * Decodes URL-encoded (percent-encoded) sequences
 * Only decodes safe ranges and rejects malformed sequences
 *
 * @param str - String to decode
 * @returns Decoded string
 */
function percentDecode(str: string): string {
  try {
    // Use decodeURIComponent but catch errors for malformed sequences
    return decodeURIComponent(str)
  } catch {
    // If decoding fails, return original string (malformed sequence)
    return str
  }
}

/**
 * Decodes XML/HTML entities (numeric and named)
 * Only decodes safe ranges and rejects malformed entities
 *
 * @param str - String to decode
 * @returns Decoded string
 */
function decodeEntities(str: string): string {
  let decoded = str

  // Decode numeric entities (decimal: &#123; and hex: &#x7B;)
  // Only decode safe Unicode ranges (0x20-0x7E for ASCII printable, 0xA0-0x10FFFF for extended)
  decoded = decoded.replace(/&#(\d+);/g, (match, numStr) => {
    const num = parseInt(numStr, 10)
    // Reject malformed: out of range or invalid
    if (isNaN(num) || num < 0x20 || (num > 0x7E && num < 0xA0) || num > 0x10FFFF) {
      return match // Keep original if invalid
    }
    try {
      return String.fromCodePoint(num)
    } catch {
      return match // Keep original if conversion fails
    }
  })

  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (match, hexStr) => {
    const num = parseInt(hexStr, 16)
    // Reject malformed: out of range or invalid
    if (isNaN(num) || num < 0x20 || (num > 0x7E && num < 0xA0) || num > 0x10FFFF) {
      return match // Keep original if invalid
    }
    try {
      return String.fromCodePoint(num)
    } catch {
      return match // Keep original if conversion fails
    }
  })

  // Decode common named entities (only safe ones)
  const namedEntities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': '\'',
    '&#39;': '\''
  }

  for (const [entity, char] of Object.entries(namedEntities)) {
    decoded = decoded.replace(new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), char)
  }

  return decoded
}

/**
 * Canonicalizes a string by decoding URL-encoded sequences and XML/HTML entities
 * This helps prevent bypasses using encoding
 *
 * @param str - String to canonicalize
 * @returns Canonicalized string
 */
function canonicalizeForHrefCheck(str: string): string {
  // First decode entities, then percent-decode
  // This order handles cases like &#x6A;avascript: or %6Aavascript:
  let canonicalized = decodeEntities(str)
  canonicalized = percentDecode(canonicalized)
  return canonicalized
}

/**
 * Maximum allowed SVG content length to prevent ReDoS attacks
 * Reasonable limit for SVG files (10MB)
 */
const MAX_SVG_LENGTH = 10 * 1024 * 1024

/**
 * Maximum length for attribute values to prevent ReDoS in regex matching
 * Reasonable limit for attribute values (64KB)
 */
const MAX_ATTR_VALUE_LENGTH = 64 * 1024

/**
 * Sanitizes an SVG string by removing dangerous elements and attributes
 *
 * @param svgContent - The SVG content as a string
 * @returns Sanitization result with sanitized content, validity, and warnings
 */
export function sanitizeSVG(svgContent: string): SanitizeResult {
  const warnings: string[] = []

  // Reject overly large inputs to prevent ReDoS attacks
  if (svgContent.length > MAX_SVG_LENGTH) {
    return {
      sanitized: '',
      isValid: false,
      warnings: ['SVG content exceeds maximum allowed length']
    }
  }

  let sanitized = svgContent

  // Validate that it's actually an SVG with robust regex
  // Match optional XML declaration, comments, whitespace, then <svg tag start
  // Allows namespaces and attributes in the opening tag
  const trimmed = sanitized.trim()
  const svgTagPattern = /^(?:\s*<\?xml[^>]*\?>)?(?:\s*<!--[\s\S]*?-->)*\s*<svg[\s>]/i
  if (!svgTagPattern.test(trimmed)) {
    return {
      sanitized: '',
      isValid: false,
      warnings: ['File does not appear to be a valid SVG']
    }
  }

  // Remove CDATA blocks first (they can wrap script content)
  // Use bounded quantifier to prevent ReDoS
  const cdataPattern = new RegExp(`<!\\[CDATA\\[[\\s\\S]{0,${MAX_SVG_LENGTH}}?\\]\\]>`, 'gi')
  const cdataMatches = sanitized.match(cdataPattern)
  if (cdataMatches && cdataMatches.length > 0) {
    warnings.push(`Removed ${cdataMatches.length} CDATA block(s)`)
    sanitized = sanitized.replace(cdataPattern, '')
  }

  // Remove <script> tags and their content (including self-closing tags)
  // Use bounded quantifiers to prevent ReDoS
  const scriptSelfClosingPattern = new RegExp(`<script\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}\\/>`, 'gi')
  const scriptPairedPattern = new RegExp(`<script\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}>[\\s\\S]{0,${MAX_SVG_LENGTH}}?<\\/script>`, 'gi')
  let scriptCount = 0
  sanitized = sanitized.replace(scriptSelfClosingPattern, () => {
    scriptCount++
    return ''
  })
  sanitized = sanitized.replace(scriptPairedPattern, () => {
    scriptCount++
    return ''
  })
  if (scriptCount > 0) {
    warnings.push(`Removed ${scriptCount} <script> tag(s)`)
  }

  // Remove <foreignObject> and <foreignobject> tags and their content (case-insensitive, including self-closing)
  // Use bounded quantifiers to prevent ReDoS
  const foreignObjectSelfClosingPattern = new RegExp(`<foreignobject\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}\\/>`, 'gi')
  const foreignObjectPairedPattern = new RegExp(`<foreignobject\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}>[\\s\\S]{0,${MAX_SVG_LENGTH}}?<\\/foreignobject>`, 'gi')
  let foreignObjectCount = 0
  sanitized = sanitized.replace(foreignObjectSelfClosingPattern, () => {
    foreignObjectCount++
    return ''
  })
  sanitized = sanitized.replace(foreignObjectPairedPattern, () => {
    foreignObjectCount++
    return ''
  })
  if (foreignObjectCount > 0) {
    warnings.push(`Removed ${foreignObjectCount} <foreignObject> tag(s)`)
  }

  // Remove dangerous attributes from all elements
  // Match attributes with optional whitespace and quotes
  // Use bounded quantifiers and simpler patterns to prevent ReDoS
  for (const attr of DANGEROUS_ATTRIBUTES) {
    // Match quoted attributes: attr="value" or attr='value'
    // Use bounded quantifier to prevent catastrophic backtracking
    // Pattern: match quote, then up to MAX_ATTR_VALUE_LENGTH chars (non-quote/non-backslash or escaped), then closing quote
    const escapedAttr = attr.replace(':', '\\:')
    const attrPattern = new RegExp(
      `\\b${escapedAttr}\\s*=\\s*(["'])(?:[^"\\\\]|\\\\.){0,${MAX_ATTR_VALUE_LENGTH}}?\\1`,
      'gi'
    )
    const attrMatches = sanitized.match(attrPattern)
    if (attrMatches && attrMatches.length > 0) {
      warnings.push(`Removed ${attrMatches.length} instance(s) of dangerous attribute: ${attr}`)
      sanitized = sanitized.replace(attrPattern, '')
    }

    // Also match unquoted attributes: attr=value
    // Use word boundary and bounded quantifier to prevent ReDoS
    const unquotedPattern = new RegExp(
      `\\b${escapedAttr}\\s*=\\s*[^\\s>]{0,${MAX_ATTR_VALUE_LENGTH}}`,
      'gi'
    )
    const unquotedMatches = sanitized.match(unquotedPattern)
    if (unquotedMatches && unquotedMatches.length > 0) {
      warnings.push(`Removed ${unquotedMatches.length} instance(s) of unquoted dangerous attribute: ${attr}`)
      sanitized = sanitized.replace(unquotedPattern, '')
    }
  }

  // Remove href and xlink:href attributes only if they contain dangerous protocols
  // Preserve safe protocols (http:, https:, #) and relative URLs
  // We canonicalize (decode) each href attribute value before checking to prevent encoding bypasses

  const dangerousHrefPatterns = [
    // Match quoted href/xlink:href with dangerous protocols (complete attribute)
    // Captures opening quote and matches until closing quote
    /\b(href|xlink:href)\s*=\s*(["'])\s*(?:javascript|vbscript)\s*:.*?\2/gi,
    // Match quoted href/xlink:href with dangerous data: URLs (complete attribute)
    // Includes all dangerous data: types: text/html, image/svg+xml, application/xml, application/xhtml+xml, text/xml
    /\b(href|xlink:href)\s*=\s*(["'])\s*data\s*:\s*(?:text\/html|image\/svg\+xml|application\/x?html\+xml|text\/xml).*?\2/gi,
    // Match unquoted href/xlink:href with dangerous protocols (up to whitespace or >)
    /\b(href|xlink:href)\s*=\s*(?:javascript|vbscript)\s*:[^\s>]*/gi,
    // Match unquoted href/xlink:href with dangerous data: URLs (up to whitespace or >)
    // Includes all dangerous data: types: text/html, image/svg+xml, application/xml, application/xhtml+xml, text/xml
    // Note: This may alter self-closing tag structure (e.g., <use href=data:text/html/> becomes <use >)
    // This is acceptable as it's safer than leaving the dangerous href
    /\b(href|xlink:href)\s*=\s*data\s*:\s*(?:text\/html|image\/svg\+xml|application\/x?html\+xml|text\/xml)[^\s>]*/gi
  ]

  // Defensive regex to catch interleaved-encoded characters as a fallback
  // Matches patterns where critical letters in "javascript" or "vbscript" are encoded
  // Examples: j%61vascript, j&#x61;vascript, v%62script, etc.
  // Note: Removed j%[0-9a-f]{2}vascript to avoid overlap with j(?:%61|&#x?61;|&#97;)vascript
  // Canonicalization should handle most cases, this is a defensive fallback
  const interleavedEncodedPattern = /\b(?:href|xlink:href)\s*=\s*(?:j(?:%61|&#x?61;|&#97;)vascript|javascript(?:%3A|&#x?3A;|&#58;)|v(?:%62|&#x?62;|&#98;)script|vbscript(?:%3A|&#x?3A;|&#58;))[^\s>]*/gi

  // Process quoted href attributes: find them, canonicalize the value, check against patterns
  // Use bounded quantifier to prevent ReDoS
  sanitized = sanitized.replace(
    new RegExp(`\\b(href|xlink:href)\\s*=\\s*(["'])([^"']{0,${MAX_ATTR_VALUE_LENGTH}})\\2`, 'gi'),
    (match, attr, quote, value) => {
      // Skip processing if value is too long (shouldn't happen due to regex limit, but defensive)
      if (value.length > MAX_ATTR_VALUE_LENGTH) {
        return match
      }

      const canonicalizedValue = canonicalizeForHrefCheck(value)
      const fullCanonicalized = `${attr}=${quote}${canonicalizedValue}${quote}`

      // Check against dangerous patterns (create new regex instances to avoid state issues)
      // Remove 'g' flag since we only use .test() once per instance
      for (const pattern of dangerousHrefPatterns) {
        const testPattern = new RegExp(pattern.source, pattern.flags.replace('g', ''))
        if (testPattern.test(fullCanonicalized)) {
          warnings.push(`Removed href/xlink:href with dangerous protocol (detected after canonicalization)`)
          return '' // Remove the attribute
        }
      }

      // Check against interleaved-encoded pattern as fallback
      const testInterleavedPattern = new RegExp(interleavedEncodedPattern.source, interleavedEncodedPattern.flags.replace('g', ''))
      if (testInterleavedPattern.test(fullCanonicalized)) {
        warnings.push(`Removed href/xlink:href with encoded dangerous protocol`)
        return '' // Remove the attribute
      }

      return match // Keep safe attributes
    }
  )

  // Process unquoted href attributes: find them, canonicalize the value, check against patterns
  // Use bounded quantifier to prevent ReDoS
  sanitized = sanitized.replace(
    new RegExp(`\\b(href|xlink:href)\\s*=\\s*([^\\s>]{0,${MAX_ATTR_VALUE_LENGTH}})`, 'gi'),
    (match, attr, value) => {
      // Skip processing if value is too long (shouldn't happen due to regex limit, but defensive)
      if (value.length > MAX_ATTR_VALUE_LENGTH) {
        return match
      }

      const canonicalizedValue = canonicalizeForHrefCheck(value)
      const fullCanonicalized = `${attr}=${canonicalizedValue}`

      // Check against dangerous patterns (create new regex instances to avoid state issues)
      // Remove 'g' flag since we only use .test() once per instance
      for (const pattern of dangerousHrefPatterns) {
        const testPattern = new RegExp(pattern.source, pattern.flags.replace('g', ''))
        if (testPattern.test(fullCanonicalized)) {
          warnings.push(`Removed href/xlink:href with dangerous protocol (detected after canonicalization)`)
          return '' // Remove the attribute
        }
      }

      // Check against interleaved-encoded pattern as fallback
      const testInterleavedPattern = new RegExp(interleavedEncodedPattern.source, interleavedEncodedPattern.flags.replace('g', ''))
      if (testInterleavedPattern.test(fullCanonicalized)) {
        warnings.push(`Removed href/xlink:href with encoded dangerous protocol`)
        return '' // Remove the attribute
      }

      return match // Keep safe attributes
    }
  )

  // Remove dangerous elements (case-insensitive)
  // Use bounded quantifiers to prevent ReDoS attacks
  for (const element of DANGEROUS_ELEMENTS) {
    // Match self-closing tags: <element ... />
    const selfClosingPattern = new RegExp(
      `<${element}\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}\\/>`,
      'gi'
    )
    let matchCount = 0
    sanitized = sanitized.replace(selfClosingPattern, () => {
      matchCount++
      return ''
    })

    // Match paired tags with content: <element ...>content</element>
    // Use bounded quantifier for content to prevent ReDoS
    const pairedTagPattern = new RegExp(
      `<${element}\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}>[\\s\\S]{0,${MAX_SVG_LENGTH}}?<\\/${element}\\s*>`,
      'gi'
    )
    sanitized = sanitized.replace(pairedTagPattern, () => {
      matchCount++
      return ''
    })

    if (matchCount > 0) {
      warnings.push(`Removed ${matchCount} <${element}> tag(s)`)
    }
  }

  // Validate that the SVG still has a valid structure after sanitization
  const hasSvgTag = /<svg[\s>]/i.test(sanitized)
  if (!hasSvgTag) {
    return {
      sanitized: '',
      isValid: false,
      warnings: [...warnings, 'SVG structure invalid after sanitization']
    }
  }

  // Check for any remaining suspicious patterns
  const suspiciousPatterns = [
    /javascript:/i,
    /data:text\/html/i,
    /data:application\/xhtml\+xml/i,
    /vbscript:/i,
    /\s+on\w+\s*=/i
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      warnings.push(`Found suspicious pattern: ${pattern.toString()}`)
    }
  }

  // If suspicious patterns remain, the sanitization failed
  const hasSuspiciousPatterns = suspiciousPatterns.some(p => p.test(sanitized))
  if (hasSuspiciousPatterns) {
    return {
      sanitized: '',
      isValid: false,
      warnings: [...warnings, 'Suspicious patterns remain after sanitization']
    }
  }

  return {
    sanitized,
    isValid: true,
    warnings
  }
}

/**
 * Validates if an SVG file is safe to serve
 *
 * An SVG is considered unsafe if it contains dangerous content that would need sanitization.
 * This function checks the original content for dangerous patterns.
 *
 * @param svgContent - The SVG content as a string
 * @returns true if the SVG is safe (no dangerous content), false otherwise
 */
export function isSVGSafe(svgContent: string): boolean {
  // Reject overly large inputs to prevent ReDoS attacks
  if (svgContent.length > MAX_SVG_LENGTH) {
    return false
  }

  // First check if it's a valid SVG
  if (!svgContent.trim().toLowerCase().includes('<svg')) {
    return false
  }

  // Check for dangerous patterns in the original content
  // Use bounded quantifiers to prevent ReDoS attacks
  const dangerousPatterns = [
    /<!\[CDATA\[/i, // CDATA blocks
    new RegExp(`<script\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}>[\\s\\S]{0,${MAX_SVG_LENGTH}}?<\\/script>|<script\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}\\/>`, 'i'), // Script tags (including self-closing)
    new RegExp(`<foreignobject\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}>[\\s\\S]{0,${MAX_SVG_LENGTH}}?<\\/foreignobject>|<foreignobject\\b[^>]{0,${MAX_ATTR_VALUE_LENGTH}}\\/>`, 'i'), // ForeignObject tags (including self-closing)
    /\s+on\w+\s*=\s*["']/i, // Event handlers with quotes
    new RegExp(`\\s+on\\w+\\s*=\\s*[^\\s>]{0,${MAX_ATTR_VALUE_LENGTH}}`, 'i'), // Event handlers without quotes
    /javascript:/i, // JavaScript protocol
    /data:text\/html/i, // Data URLs with HTML
    /vbscript:/i, // VBScript protocol
    /\s+href\s*=\s*["']?javascript:/i, // href with javascript:
    /\s+xlink:href\s*=\s*["']?javascript:/i, // xlink:href with javascript:
    new RegExp(`\\s+href\\s*=\\s*["']?data:(image\\/svg\\+xml|application\\/x?html\\+xml|text\\/xml)(;[^"' >]{0,${MAX_ATTR_VALUE_LENGTH}})?`, 'i'), // href with data: SVG/XML/XHTML
    new RegExp(`\\s+xlink:href\\s*=\\s*["']?data:(image\\/svg\\+xml|application\\/x?html\\+xml|text\\/xml)(;[^"' >]{0,${MAX_ATTR_VALUE_LENGTH}})?`, 'i'), // xlink:href with data: SVG/XML/XHTML
    new RegExp(`data:(image\\/svg\\+xml|application\\/x?html\\+xml|text\\/xml)(;[^"' >]{0,${MAX_ATTR_VALUE_LENGTH}})?`, 'i') // General data: SVG/XML/XHTML URLs
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(svgContent)) {
      return false
    }
  }

  // Also check for dangerous attributes (case-insensitive)
  const dangerousAttrPattern = new RegExp(
    `\\s+(${DANGEROUS_ATTRIBUTES.join('|').replace(':', '\\:')})\\s*=`,
    'i'
  )
  if (dangerousAttrPattern.test(svgContent)) {
    return false
  }

  return true
}
