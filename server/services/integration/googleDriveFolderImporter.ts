import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import * as schema from '~~/server/db/schema'
import { FileService, useFileManagerConfig } from '~~/server/services/file/fileService'
import { optimizeImageInBackground } from '~~/server/services/file/imageOptimizer'
import { createStorageProvider } from '~~/server/services/file/storage/factory'
import { ensureGoogleAccessToken } from '~~/server/services/integration/googleAuth'
import { getWaitUntil } from '~~/server/utils/waitUntil'
import { formatFileSize } from '~~/shared/utils/format'

const PAGE_SIZE = 100
const MAX_FILES_PER_IMPORT = (() => {
  const envValue = Number.parseInt(process.env.NUXT_GOOGLE_DRIVE_FOLDER_IMPORT_LIMIT ?? '', 10)
  if (!Number.isFinite(envValue) || envValue <= 0) {
    return 200
  }
  return envValue
})()
export const DRIVE_FOLDER_IMPORT_LIMIT = MAX_FILES_PER_IMPORT

interface DriveFile {
  id: string
  name?: string | null
  mimeType?: string | null
  size?: string | null
}

interface ImportDriveFolderOptions {
  db: NodePgDatabase<typeof schema>
  organizationId: string
  userId: string
  folderId: string
  contentId?: string | null
}

export interface DriveFolderImportResult {
  folderId: string
  folderName: string | null
  totalImages: number
  importedCount: number
  failedFiles: Array<{ fileId: string, fileName: string, reason: string }>
  truncated: boolean
}

const fetchFolderFiles = async (accessToken: string, folderId: string): Promise<DriveFile[]> => {
  const files: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const response = await $fetch<{
      files?: DriveFile[]
      nextPageToken?: string
    }>('https://www.googleapis.com/drive/v3/files', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      query: {
        pageSize: PAGE_SIZE,
        pageToken,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,mimeType,size),nextPageToken',
        q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }
    }).catch((error: any) => {
      console.error('[google-drive] Failed to fetch folder files', { folderId, error })
      throw createError({
        statusCode: 502,
        statusMessage: 'Unable to fetch files from Google Drive.'
      })
    })

    if (response.files && response.files.length > 0) {
      files.push(...response.files)
    }

    if (files.length >= MAX_FILES_PER_IMPORT) {
      break
    }

    pageToken = response.nextPageToken
  } while (pageToken)

  return files.slice(0, MAX_FILES_PER_IMPORT)
}

const fetchFolderName = async (accessToken: string, folderId: string): Promise<string | null> => {
  try {
    const response = await $fetch<{ name?: string }>(`https://www.googleapis.com/drive/v3/files/${folderId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      query: {
        fields: 'name',
        supportsAllDrives: true
      }
    })
    return response.name ?? null
  } catch (error) {
    console.warn('[google-drive] Failed to fetch folder metadata', { folderId, error })
    return null
  }
}

export async function importGoogleDriveFolder(options: ImportDriveFolderOptions): Promise<DriveFolderImportResult> {
  const { db, organizationId, userId, folderId, contentId } = options

  const integration = await db.query.integration.findFirst({
    where: and(
      eq(schema.integration.organizationId, organizationId),
      eq(schema.integration.type, 'google_drive'),
      eq(schema.integration.isActive, true)
    )
  })

  if (!integration?.accountId) {
    throw createError({
      statusCode: 412,
      statusMessage: 'Google Drive integration is not connected for this organization.'
    })
  }

  const [account] = await db
    .select()
    .from(schema.account)
    .where(eq(schema.account.id, integration.accountId))
    .limit(1)

  if (!account) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Google Drive integration account not found.'
    })
  }

  let accessToken: string
  try {
    accessToken = await ensureGoogleAccessToken(db, account)
  } catch (error: any) {
    console.error('[google-drive] Failed to refresh access token', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to refresh Google Drive credentials.'
    })
  }

  const folderName = await fetchFolderName(accessToken, folderId)
  const config = useFileManagerConfig()
  const storageProvider = await createStorageProvider(config.storage)
  const fileService = new FileService(storageProvider)
  const waitUntil = await getWaitUntil()

  const driveFiles = await fetchFolderFiles(accessToken, folderId)
  if (!driveFiles.length) {
    return {
      folderId,
      folderName,
      totalImages: 0,
      importedCount: 0,
      failedFiles: [],
      truncated: false
    }
  }

  const result = {
    folderId,
    folderName,
    totalImages: driveFiles.length,
    importedCount: 0,
    failedFiles: [] as Array<{ fileId: string, fileName: string, reason: string }>,
    truncated: driveFiles.length >= MAX_FILES_PER_IMPORT
  }

  for (const fileEntry of driveFiles) {
    const fileId = fileEntry.id
    const fileName = fileEntry.name ?? `drive-file-${fileId}`
    const mimeType = fileEntry.mimeType ?? 'application/octet-stream'

    const fileSizeBytes = Number.parseInt(fileEntry.size ?? '', 10)
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      result.failedFiles.push({
        fileId,
        fileName,
        reason: 'File size information is missing or invalid.'
      })
      continue
    }

    if (config.maxFileSize && fileSizeBytes > config.maxFileSize) {
      result.failedFiles.push({
        fileId,
        fileName,
        reason: `File exceeds maximum allowed size of ${formatFileSize(config.maxFileSize)}.`
      })
      continue
    }

    let fileBuffer: Uint8Array | undefined
    try {
      const arrayBuffer = await $fetch<ArrayBuffer>(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        query: {
          alt: 'media',
          supportsAllDrives: true,
          acknowledgeAbuse: false
        },
        responseType: 'arrayBuffer'
      })
      const buffer = new Uint8Array(arrayBuffer)
      fileBuffer = buffer
    } catch (error: any) {
      console.error('[google-drive] Failed to download file content', { fileId, error })
      result.failedFiles.push({
        fileId,
        fileName,
        reason: 'Unable to download the selected Google Drive file.'
      })
      continue
    }
    if (!fileBuffer) {
      continue
    }

    try {
      const uploaded = await fileService.uploadFile(
        fileBuffer,
        fileName,
        mimeType,
        userId,
        undefined,
        undefined,
        {
          organizationId,
          contentId: contentId ?? undefined
        }
      )

      result.importedCount += 1

      const optimizePromise = optimizeImageInBackground(uploaded.id)
      if (waitUntil) {
        waitUntil(optimizePromise)
      } else {
        optimizePromise.catch((error) => {
          console.error('Image optimization failed:', error)
        })
      }
    } catch (error: any) {
      console.error('[google-drive] Failed to upload file', { fileId, error })
      result.failedFiles.push({
        fileId,
        fileName,
        reason: error instanceof Error ? error.message : 'Upload failed.'
      })
    }
  }

  return result
}
