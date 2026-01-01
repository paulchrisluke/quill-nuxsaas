export interface ContentUpdateSignal {
  contentId: string
  updatedAt: number
}

export function useContentUpdates() {
  const latestUpdate = useState<ContentUpdateSignal | null>('content/latest-update', () => null)
  const latestCreated = useState<ContentUpdateSignal | null>('content/latest-created', () => null)

  const notifyUpdated = (contentId: string) => {
    latestUpdate.value = {
      contentId,
      updatedAt: Date.now()
    }
  }

  const notifyCreated = (contentId: string) => {
    const payload = {
      contentId,
      updatedAt: Date.now()
    }
    latestCreated.value = payload
    latestUpdate.value = payload
  }

  return {
    latestUpdate,
    latestCreated,
    notifyUpdated,
    notifyCreated
  }
}
