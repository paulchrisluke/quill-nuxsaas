import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

/**
 * Queue table for failed audit log events that need to be retried.
 * This ensures we don't lose critical security audit trails.
 */
export const auditLogQueue = pgTable('audit_log_queue', {
  id: serial('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  category: text('category').notNull(), // e.g., 'auth', 'email', 'payment'
  action: text('action').notNull(), // e.g., 'login', 'register', 'verification'
  targetType: text('target_type'), // e.g., 'user', 'email'
  targetId: text('target_id'), // ID of the target entity
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  status: text('status').notNull().default('success'), // e.g., 'success', 'failure', 'pending'
  details: text('details'), // Additional details or error messages
  error: text('error'), // Error message from the failed attempt
  retryCount: integer('retry_count').notNull().default(0),
  lastRetryAt: timestamp('last_retry_at'),
  createdAt: timestamp('created_at').notNull().defaultNow()
})
