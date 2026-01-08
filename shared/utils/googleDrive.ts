const DRIVE_FOLDER_LINK_PATTERN = /drive\.google\.com\/drive\/folders\/([\w-]{25,})/i
const DRIVE_COMMAND_PATTERN = /(?:--drive-folder|drive[-\s]+folder)(?:\s*[=:]\s*|\s+)(["']?)([\w-]{25,})\1/i

const cleanId = (value: string): string => {
  return value.replace(/^["']|["']$/g, '').trim()
}

export function extractGoogleDriveFolderId(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const note = value.trim()
  if (!note) {
    return null
  }

  const patterns: Array<{ pattern: RegExp, idGroup: number }> = [
    { pattern: DRIVE_FOLDER_LINK_PATTERN, idGroup: 1 },
    { pattern: DRIVE_COMMAND_PATTERN, idGroup: 2 }
  ]
  for (const entry of patterns) {
    const match = entry.pattern.exec(note)
    if (!match) {
      continue
    }
    const matchValue = match[entry.idGroup]
    if (matchValue) {
      return cleanId(matchValue)
    }
  }

  return null
}
