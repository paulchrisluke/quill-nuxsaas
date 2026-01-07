export interface FileManagerConfig {
  maxSize?: number
  allowedTypes?: string[]
  contentId?: string | null
  onSuccess?: (file: any) => void
  onError?: (error: Error) => void
  parallelUploads?: boolean
}

export function useFileManager(config: FileManagerConfig = {}) {
  const uploading = ref(false)
  const progress = ref(0)
  const error = ref<string | null>(null)

  const uploadFile = async (file: File, options?: { manageState?: boolean }): Promise<any> => {
    const manageState = options?.manageState !== false
    if (config.maxSize && file.size > config.maxSize) {
      const errorMsg = `File size exceeds ${formatFileSize(config.maxSize)}`
      error.value = errorMsg
      config.onError?.(new Error(errorMsg))
      throw new Error(errorMsg)
    }

    if (config.allowedTypes && config.allowedTypes.length > 0) {
      const fileMime = (file.type || '').toLowerCase()
      const fileExtension = file.name?.split('.').pop()?.toLowerCase()

      const matchesAllowedType = config.allowedTypes.some((allowed) => {
        if (!allowed)
          return false

        const normalizedAllowed = allowed.toLowerCase()
        if (normalizedAllowed === '*/*')
          return true

        if (normalizedAllowed === fileMime && fileMime)
          return true

        if (normalizedAllowed.endsWith('/*')) {
          const baseType = normalizedAllowed.slice(0, -1) // keep trailing slash
          if (fileMime && fileMime.startsWith(baseType))
            return true
          if (!fileMime && baseType === 'image/' && fileExtension) {
            return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'heif'].includes(fileExtension)
          }
          return false
        }

        return false
      })

      if (!matchesAllowedType) {
        const errorMsg = 'File type not allowed'
        error.value = errorMsg
        config.onError?.(new Error(errorMsg))
        throw new Error(errorMsg)
      }
    }

    const formData = new FormData()
    formData.append('file', file)

    if (manageState) {
      uploading.value = true
      progress.value = 0
      error.value = null
    }

    try {
      const queryParams: Record<string, string> = {}
      if (config.contentId) {
        queryParams.contentId = config.contentId
      }

      const url = queryParams.contentId
        ? `/api/file/upload?${new URLSearchParams(queryParams).toString()}`
        : '/api/file/upload'

      const response = await $fetch<{ file: any }>(url, {
        method: 'POST',
        body: formData
      })

      if (!response?.file) {
        const errorMsg = 'Invalid server response: missing file data'
        error.value = errorMsg
        config.onError?.(new Error(errorMsg))
        throw new Error(errorMsg)
      }

      config.onSuccess?.(response.file)
      return response.file
    } catch (err: any) {
      const errorMsg = err.data?.message || 'Upload failed'
      error.value = errorMsg
      config.onError?.(new Error(errorMsg))
      throw err
    } finally {
      if (manageState) {
        uploading.value = false
      }
    }
  }

  const uploadToServer = async (file: File): Promise<any> => {
    return uploadFile(file, { manageState: true })
  }

  const uploadMultipleFiles = async (files: FileList | File[]): Promise<any[]> => {
    const fileArray = Array.from(files)
    const results: any[] = []

    if (config.parallelUploads) {
      uploading.value = true
      progress.value = 0
      error.value = null
      let settled: Array<PromiseSettledResult<any>> | null = null
      try {
        settled = await Promise.allSettled(
          fileArray.map(file => uploadFile(file, { manageState: false }))
        )
        for (const result of settled) {
          if (result.status === 'fulfilled') {
            results.push(result.value)
          } else {
            const message = result.reason?.message || 'Upload failed'
            results.push({ error: message })
          }
        }
      } finally {
        uploading.value = false
        progress.value = 0
        if (settled) {
          const hasErrors = settled.some(result => result.status === 'rejected')
          error.value = hasErrors ? 'Some uploads failed' : null
        }
      }
      return results
    }

    for (const file of fileArray) {
      try {
        const result = await uploadToServer(file)
        results.push(result)
      } catch (err: any) {
        results.push({ error: err.message })
      }
    }

    return results
  }

  return {
    uploading: readonly(uploading),
    progress: readonly(progress),
    error: readonly(error),
    uploadToServer,
    uploadMultipleFiles
  }
}
