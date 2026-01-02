const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const normalizeContentId = (value?: string | null) => {
  if (!value) {
    return null
  }
  return UUID_REGEX.test(value) ? value : null
}
