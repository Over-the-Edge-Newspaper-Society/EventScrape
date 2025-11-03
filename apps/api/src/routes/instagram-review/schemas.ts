import { z } from 'zod';

export const classifyPostSchema = z.object({
  isEventPoster: z.boolean(),
  classificationConfidence: z.number().min(0).max(1).optional(),
});

export const extractOptionsSchema = z.object({
  overwrite: z.boolean().optional().default(false),
  createEvents: z.boolean().optional().default(true),
});

export const bulkExtractSchema = z.object({
  accountId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  overwrite: z.boolean().optional().default(false),
});

export const bulkAiClassifySchema = z.object({
  accountId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export type ClassifyPostBody = z.infer<typeof classifyPostSchema>;
export type ExtractOptionsBody = z.infer<typeof extractOptionsSchema>;
export type BulkExtractBody = z.infer<typeof bulkExtractSchema>;
export type BulkAiClassifyBody = z.infer<typeof bulkAiClassifySchema>;
