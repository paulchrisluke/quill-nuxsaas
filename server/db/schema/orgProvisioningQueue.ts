import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * Queue table for failed organization provisioning attempts that need to be retried.
 * This ensures users eventually get their default organization even if provisioning fails initially.
 */
export const orgProvisioningQueue = pgTable('org_provisioning_queue', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  error: text('error'), // Error message from the failed attempt
  retryCount: integer('retry_count').notNull().default(0),
  lastRetryAt: timestamp('last_retry_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at') // When provisioning succeeded
})
