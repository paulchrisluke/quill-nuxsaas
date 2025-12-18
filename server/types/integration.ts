import { z } from 'zod'

export const integrationCapabilitiesSchema = z.object({
  ingest: z.boolean().optional(),
  publish: z.boolean().optional(),
  sync: z.boolean().optional()
}).default({})

export const integrationAuthTypeSchema = z.enum(['oauth', 'api_key', 'webhook'])

export const integrationConfigSchema = z.record(z.any())

export const createIntegrationSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  authType: integrationAuthTypeSchema,
  accountId: z.string().optional(),
  baseUrl: z.string().url().optional(),
  config: integrationConfigSchema.optional(),
  capabilities: integrationCapabilitiesSchema.optional(),
  isActive: z.boolean().optional()
}).superRefine((value, ctx) => {
  if (value.authType === 'oauth' && !value.accountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'accountId is required for OAuth integrations',
      path: ['accountId']
    })
  }
})

export const updateIntegrationSchema = createIntegrationSchema.partial().extend({
  name: z.string().min(1).optional(),
  type: z.string().min(1).optional()
})

export const testIntegrationSchema = z.object({
  payload: z.record(z.any()).optional()
})

export type IntegrationCapabilities = z.infer<typeof integrationCapabilitiesSchema>
export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>
export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>
export type TestIntegrationInput = z.infer<typeof testIntegrationSchema>
