import { relations } from 'drizzle-orm'
import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { v7 as uuidv7 } from 'uuid'
import { organization, user } from './auth'
import { content } from './content'

export const fileOptimizationStatusEnum = pgEnum('file_optimization_status', ['pending', 'processing', 'done', 'failed', 'skipped'])

export const file = pgTable('file', {
  id: uuid('id').primaryKey().$default(() => uuidv7()),
  originalName: text('original_name').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileType: text('file_type').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  blurDataUrl: text('blur_data_url'),
  variants: jsonb('variants').$type<Record<string, any> | null>(),
  optimizationStatus: fileOptimizationStatusEnum('optimization_status').default('pending').notNull(),
  optimizationError: text('optimization_error'),
  optimizedAt: timestamp('optimized_at', { withTimezone: true }),
  optimizationStartedAt: timestamp('optimization_started_at', { withTimezone: true }),
  path: text('path').notNull(),
  url: text('url'),
  storageProvider: text('storage_provider').notNull(),
  organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
  uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
  contentId: uuid('content_id').references(() => content.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, table => ({
  organizationIdx: index('file_organization_idx').on(table.organizationId),
  organizationActiveIdx: index('file_organization_active_idx').on(table.organizationId, table.isActive),
  optimizationStatusIdx: index('file_optimization_status_idx').on(table.optimizationStatus),
  optimizationStatusCreatedAtIdx: index('file_optimization_status_created_at_idx').on(table.optimizationStatus, table.createdAt)
}))

export const fileRelations = relations(file, ({ one }) => ({
  organization: one(organization, {
    fields: [file.organizationId],
    references: [organization.id]
  }),
  uploadedByUser: one(user, {
    fields: [file.uploadedBy],
    references: [user.id]
  }),
  content: one(content, {
    fields: [file.contentId],
    references: [content.id]
  })
}))
