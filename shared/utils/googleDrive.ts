const DRIVE_FOLDER_LINK_PATTERN = /drive\.google\.com\/drive\/folders\/([\w-]{25,})/i
// eslint-disable-next-line regexp/no-useless-non-capturing-group, regexp/no-super-linear-backtracking
const DRIVE_COMMAND_PATTERN = /(?:--drive-folder|drive(?:[-\s]+)folder)\s*[:=]?\s*["']?([\w-]{25,})["']?/i

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

  const patterns = [DRIVE_FOLDER_LINK_PATTERN, DRIVE_COMMAND_PATTERN]
  for (const pattern of patterns) {
    const match = pattern.exec(note)
    if (match && match[1]) {
      return cleanId(match[1])
    }
  }

  return null
}
