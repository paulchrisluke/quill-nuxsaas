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
  'onzoom',
  'href',
  'xlink:href'
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
 * Sanitizes an SVG string by removing dangerous elements and attributes
 *
 * @param svgContent - The SVG content as a string
 * @returns Sanitization result with sanitized content, validity, and warnings
 */
export function sanitizeSVG(svgContent: string): SanitizeResult {
  const warnings: string[] = []
  let sanitized = svgContent

  // Validate that it's actually an SVG
  if (!sanitized.trim().toLowerCase().includes('<svg')) {
    return {
      sanitized: '',
      isValid: false,
      warnings: ['File does not appear to be a valid SVG']
    }
  }

  // Remove CDATA blocks first (they can wrap script content)
  const cdataPattern = /<!\[CDATA\[[\s\S]*?\]\]>/gi
  const cdataMatches = sanitized.match(cdataPattern)
  if (cdataMatches && cdataMatches.length > 0) {
    warnings.push(`Removed ${cdataMatches.length} CDATA block(s)`)
    sanitized = sanitized.replace(cdataPattern, '')
  }

  // Remove <script> tags and their content (including self-closing tags)
  // Match <script\b ...> with either closing </script> or self-closing />
  const scriptPattern = /<script\b[^>]*>[\s\S]*?<\/script>|<script\b[^>]*\/>/gi
  const scriptMatches = sanitized.match(scriptPattern)
  if (scriptMatches && scriptMatches.length > 0) {
    warnings.push(`Removed ${scriptMatches.length} <script> tag(s)`)
    sanitized = sanitized.replace(scriptPattern, '')
  }

  // Remove <foreignObject> and <foreignobject> tags and their content (case-insensitive, including self-closing)
  // Use word boundary and case-insensitive matching
  const foreignObjectPattern = /<foreignobject\b[^>]*>[\s\S]*?<\/foreignobject>|<foreignobject\b[^>]*\/>/gi
  const foreignObjectMatches = sanitized.match(foreignObjectPattern)
  if (foreignObjectMatches && foreignObjectMatches.length > 0) {
    warnings.push(`Removed ${foreignObjectMatches.length} <foreignObject> tag(s)`)
    sanitized = sanitized.replace(foreignObjectPattern, '')
  }

  // Remove dangerous attributes from all elements
  // Match attributes with optional whitespace and quotes
  for (const attr of DANGEROUS_ATTRIBUTES) {
    // Match attribute with various quote styles: attr="value", attr='value', attr=value
    const attrPattern = new RegExp(
      `\\s+${attr.replace(':', '\\:')}\\s*=\\s*(["'])(?:[^"']|\\\\["'])*\\1`,
      'gi'
    )
    const attrMatches = sanitized.match(attrPattern)
    if (attrMatches && attrMatches.length > 0) {
      warnings.push(`Removed ${attrMatches.length} instance(s) of dangerous attribute: ${attr}`)
      sanitized = sanitized.replace(attrPattern, '')
    }

    // Also match unquoted attributes: attr=value
    const unquotedPattern = new RegExp(
      `\\s+${attr.replace(':', '\\:')}\\s*=\\s*[^\\s>]+`,
      'gi'
    )
    const unquotedMatches = sanitized.match(unquotedPattern)
    if (unquotedMatches && unquotedMatches.length > 0) {
      warnings.push(`Removed ${unquotedMatches.length} instance(s) of unquoted dangerous attribute: ${attr}`)
      sanitized = sanitized.replace(unquotedPattern, '')
    }
  }

  // Remove dangerous elements (case-insensitive)
  for (const element of DANGEROUS_ELEMENTS) {
    // Match both opening and self-closing tags
    const elementPattern = new RegExp(
      `<${element}[^>]*>.*?</${element}>|<${element}[^>]*/>`,
      'gis'
    )
    const elementMatches = sanitized.match(elementPattern)
    if (elementMatches && elementMatches.length > 0) {
      warnings.push(`Removed ${elementMatches.length} <${element}> tag(s)`)
      sanitized = sanitized.replace(elementPattern, '')
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
    /vbscript:/i,
    /\s+on\w+\s*=/i
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      warnings.push(`Found suspicious pattern: ${pattern.toString()}`)
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
  // First check if it's a valid SVG
  if (!svgContent.trim().toLowerCase().includes('<svg')) {
    return false
  }

  // Check for dangerous patterns in the original content
  const dangerousPatterns = [
    /<!\[CDATA\[/i, // CDATA blocks
    /<script\b[^>]*>[\s\S]*?<\/script>|<script\b[^>]*\/>/i, // Script tags (including self-closing)
    /<foreignobject\b[^>]*>[\s\S]*?<\/foreignobject>|<foreignobject\b[^>]*\/>/i, // ForeignObject tags (including self-closing)
    /\s+on\w+\s*=\s*["']/i, // Event handlers with quotes
    /\s+on\w+\s*=\s*[^\s>]/i, // Event handlers without quotes
    /javascript:/i, // JavaScript protocol
    /data:text\/html/i, // Data URLs with HTML
    /vbscript:/i, // VBScript protocol
    /\s+href\s*=\s*["']?javascript:/i, // href with javascript:
    /\s+xlink:href\s*=\s*["']?javascript:/i, // xlink:href with javascript:
    /\s+href\s*=\s*["']?data:(image\/svg\+xml|application\/xml|text\/xml)(;[^"' >]*)?/i, // href with data: SVG/XML
    /\s+xlink:href\s*=\s*["']?data:(image\/svg\+xml|application\/xml|text\/xml)(;[^"' >]*)?/i, // xlink:href with data: SVG/XML
    /data:(image\/svg\+xml|application\/xml|text\/xml)(;[^"' >]*)?/i // General data: SVG/XML URLs
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
