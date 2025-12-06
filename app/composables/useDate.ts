import { format, formatDistanceToNow, isThisWeek, isThisYear, isToday, isYesterday } from 'date-fns'

export const useDate = () => {
  const { useActiveOrganization } = useAuth()
  const activeOrg = useActiveOrganization()

  const activeTimezone = computed(() => {
    const data = activeOrg.value?.data
    if (!data?.metadata)
      return 'America/Detroit' // Default

    const meta = data.metadata
    try {
      const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta
      if (parsed.timezone) {
        const tz = parsed.timezone
        return (typeof tz === 'object' && tz !== null) ? tz.value : tz.trim()
      }
    } catch {
      // Ignore parse error
    }
    return 'America/Detroit'
  })

  /**
   * Convert a date to the active timezone
   */
  const toTimezoneDate = (date: string | Date, timezoneOverride?: string): Date => {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    if (!dateObj || Number.isNaN(dateObj.getTime()))
      return new Date()

    const tz = timezoneOverride || activeTimezone.value
    try {
      // Convert to timezone by formatting and parsing
      const localString = dateObj.toLocaleString('en-US', { timeZone: tz })
      return new Date(localString)
    } catch {
      return dateObj
    }
  }

  /**
   * Format date with absolute formatting (original behavior)
   */
  const formatDate = (date: string | Date, options?: Intl.DateTimeFormatOptions, timezoneOverride?: string) => {
    if (!date)
      return 'Never'

    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    }

    const tz = timezoneOverride || activeTimezone.value

    try {
      return new Date(date).toLocaleString('en-US', {
        ...(options || defaultOptions),
        timeZone: tz
      })
    } catch {
      // Fallback if timezone is invalid
      return new Date(date).toLocaleString('en-US', options || defaultOptions)
    }
  }

  /**
   * Format date as relative time (e.g., "3m ago", "2 hours ago", "yesterday")
   */
  const formatRelativeTime = (date: string | Date | null | undefined, options?: { addSuffix?: boolean, timezoneOverride?: string }): string => {
    if (!date)
      return '—'

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date
      if (!dateObj || Number.isNaN(dateObj.getTime()))
        return '—'

      // Use timezone-aware date for relative formatting
      const tzDate = toTimezoneDate(dateObj, options?.timezoneOverride)

      return formatDistanceToNow(tzDate, {
        addSuffix: options?.addSuffix !== false // Default to true
      })
    } catch {
      return '—'
    }
  }

  /**
   * Format date with smart switching between relative and absolute formats
   * Recent dates use relative time, older dates use absolute format
   */
  const formatDateRelative = (
    date: string | Date | null | undefined,
    options?: {
      mode?: 'auto' | 'relative' | 'absolute'
      timezoneOverride?: string
      includeTime?: boolean
    }
  ): string => {
    if (!date)
      return '—'

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date
      if (!dateObj || Number.isNaN(dateObj.getTime()))
        return '—'

      const mode = options?.mode || 'auto'
      const tz = options?.timezoneOverride || activeTimezone.value
      const tzDate = toTimezoneDate(dateObj, tz)
      const now = new Date()

      // Force modes
      if (mode === 'relative') {
        return formatRelativeTime(date, { timezoneOverride: tz })
      }
      if (mode === 'absolute') {
        if (options?.includeTime) {
          return formatDate(date, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          }, tz)
        }
        return formatDate(date, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }, tz)
      }

      // Auto mode: smart switching
      const hoursDiff = Math.abs(now.getTime() - tzDate.getTime()) / (1000 * 60 * 60)

      // Less than 24 hours: use relative time
      if (hoursDiff < 24) {
        return formatRelativeTime(date, { timezoneOverride: tz })
      }

      // Today: "Today at 3:45 PM"
      if (isToday(tzDate)) {
        const timeStr = formatDate(date, {
          hour: 'numeric',
          minute: '2-digit'
        }, tz)
        return `Today at ${timeStr}`
      }

      // Yesterday: "Yesterday at 3:45 PM"
      if (isYesterday(tzDate)) {
        const timeStr = formatDate(date, {
          hour: 'numeric',
          minute: '2-digit'
        }, tz)
        return `Yesterday at ${timeStr}`
      }

      // This week: "Monday at 3:45 PM" or "Dec 9 at 3:45 PM"
      if (isThisWeek(tzDate)) {
        const dayStr = format(tzDate, 'EEEE') // Day name
        const timeStr = formatDate(date, {
          hour: 'numeric',
          minute: '2-digit'
        }, tz)
        return `${dayStr} at ${timeStr}`
      }

      // This year: "Dec 9" or "Dec 9, 3:45 PM"
      if (isThisYear(tzDate)) {
        if (options?.includeTime) {
          return format(tzDate, 'MMM d, h:mm a')
        }
        return format(tzDate, 'MMM d')
      }

      // Older: Full date "Dec 9, 2024" or "Dec 9, 2024 at 3:45 PM"
      if (options?.includeTime) {
        return formatDate(date, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        }, tz)
      }
      return formatDate(date, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }, tz)
    } catch {
      return '—'
    }
  }

  /**
   * Format date in short, compact format (e.g., "Dec 9" for current year, "Dec 9, 2024" for older)
   */
  const formatDateShort = (
    date: string | Date | null | undefined,
    options?: {
      timezoneOverride?: string
      includeTime?: boolean
    }
  ): string => {
    if (!date)
      return '—'

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date
      if (!dateObj || Number.isNaN(dateObj.getTime()))
        return '—'

      const tz = options?.timezoneOverride || activeTimezone.value
      const tzDate = toTimezoneDate(dateObj, tz)

      if (isThisYear(tzDate)) {
        if (options?.includeTime) {
          return format(tzDate, 'MMM d, h:mm a')
        }
        return format(tzDate, 'MMM d')
      }

      // Older dates include year
      if (options?.includeTime) {
        return format(tzDate, 'MMM d, yyyy, h:mm a')
      }
      return format(tzDate, 'MMM d, yyyy')
    } catch {
      return '—'
    }
  }

  return {
    formatDate,
    formatRelativeTime,
    formatDateRelative,
    formatDateShort,
    activeTimezone
  }
}
